"""Tool to digest (analyze) an asset using Gemini's multimodal capabilities."""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..gemini_files import upload_file_sync
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)

# Map common MIME variations to Gemini-accepted types
_MIME_NORMALIZE = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
}

_DEPTH_INSTRUCTIONS = {
    "quick": "Provide a brief, focused summary (2-3 sentences).",
    "detailed": "Provide a comprehensive analysis covering key aspects, notable details, and any relevant observations.",
    "exhaustive": (
        "Provide an extremely thorough analysis. For videos: describe scene by scene, note all visual elements, "
        "audio, dialogue, transitions. For images: describe every detail, composition, colors, subjects, "
        "background elements. For audio: transcribe speech, describe sounds, note timing and patterns."
    ),
}


def _get_media_category(mime_type: str) -> str:
    """Determine media category from MIME type."""
    m = (mime_type or "").lower()
    if m.startswith("video/"):
        return "video"
    if m.startswith("image/"):
        return "image"
    if m.startswith("audio/"):
        return "audio"
    if m.startswith("text/") or "pdf" in m:
        return "document"
    return "unknown"


def _normalize_mime_type(mime_type: str) -> str:
    """Normalize MIME type for Gemini."""
    m = (mime_type or "").lower().strip()
    return _MIME_NORMALIZE.get(m, m)


def _build_system_prompt(
    category: str,
    asset_name: str | None,
    depth: Literal["quick", "detailed", "exhaustive"],
) -> str:
    """Build the analysis system prompt for Gemini."""
    depth_inst = _DEPTH_INSTRUCTIONS.get(depth, _DEPTH_INSTRUCTIONS["detailed"])
    name_part = f' named "{asset_name}"' if asset_name else ""

    prompts = {
        "video": f"""You are analyzing a video{name_part}. {depth_inst}

Cover these aspects as relevant:
- Overall content and subject matter
- Visual style, cinematography, and composition
- Key scenes or moments with timestamps
- Audio elements (dialogue, music, sound effects)
- Technical quality and notable production elements
- Any text, graphics, or overlays visible""",
        "image": f"""You are analyzing an image{name_part}. {depth_inst}

Cover these aspects as relevant:
- Main subject and composition
- Visual style, colors, and lighting
- Background elements and setting
- Any text or graphics visible
- Technical quality and notable details
- Emotional tone or mood conveyed""",
        "audio": f"""You are analyzing an audio file{name_part}. {depth_inst}

Cover these aspects as relevant:
- Type of audio content (speech, music, sound effects, etc.)
- For speech: transcribe key parts, identify speakers if possible
- For music: genre, instruments, tempo, mood
- Sound quality and notable production elements
- Timestamps for key moments or transitions""",
        "document": f"""You are analyzing a document{name_part}. {depth_inst}

Cover these aspects as relevant:
- Document type and purpose
- Main content and key points
- Structure and organization
- Any notable formatting or visual elements""",
    }
    return prompts.get(
        category,
        f"You are analyzing a media file{name_part}. {depth_inst} Describe its content, notable features, and any relevant details.",
    )


@tool
def digestAsset(
    asset_id: str,
    query: Optional[str] = None,
    depth: Literal["quick", "detailed", "exhaustive"] = "detailed",
    start_offset: Optional[str] = None,
    end_offset: Optional[str] = None,
    media_resolution: Optional[Literal["low", "medium", "high"]] = None,
    _agent_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """DEPRECATED: Use watchAsset instead for context-aware analysis.

    This tool analyzes media in isolation WITHOUT conversation context. Only use this
    if you specifically need isolated analysis without considering prior discussion.

    Prefer watchAsset which returns media directly so you can see it with full context.

    Args:
        asset_id: The ID of the asset to analyze.
        query: Optional specific question about the asset instead of general analysis.
        depth: Analysis depth - quick (2-3 sentences), detailed (comprehensive), exhaustive (scene-by-scene).
        start_offset: For videos: analyze from this timestamp (e.g. "30s", "1m30s").
        end_offset: For videos: stop analyzing at this timestamp (e.g. "60s", "2m").
        media_resolution: Low/medium/high - affects token usage. Low = fewer tokens for long videos.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to digest an asset.",
        }

    if not asset_id:
        return {
            "status": "error",
            "message": "asset_id is required.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    if not settings.google_api_key:
        return {
            "status": "error",
            "message": "GOOGLE_API_KEY not configured for Gemini digest.",
        }

    # Fetch asset from asset-service
    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id}"
    try:
        headers = get_asset_service_headers("")
        response = httpx.get(endpoint, headers=headers, timeout=30.0)
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code == 404:
        return {
            "status": "error",
            "message": f"Asset '{asset_id}' not found. Use listProjectAssets to see available assets.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        asset = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response from asset service: {exc}",
        }

    asset_url = asset.get("signedUrl") or asset.get("gcsUri")
    mime_type = asset.get("mimeType")
    asset_name = asset.get("name")
    asset_type = asset.get("type", "unknown")

    if not asset_url:
        return {
            "status": "error",
            "message": "Asset has no accessible URL (signedUrl or gcsUri).",
        }

    if not mime_type:
        return {
            "status": "error",
            "message": "Asset has no mimeType.",
        }

    supported_types = ("video", "audio", "image")
    if asset_type not in supported_types:
        return {
            "status": "error",
            "message": f"Asset type '{asset_type}' is not supported for analysis. Supported: {', '.join(supported_types)}.",
        }

    normalized_mime = _normalize_mime_type(mime_type)
    category = _get_media_category(normalized_mime)
    if category == "unknown":
        return {
            "status": "error",
            "message": f"Unsupported media type: {mime_type}",
        }

    # For GCS URIs, we need a signed URL - asset-service should provide signedUrl
    if asset_url.startswith("gs://"):
        return {
            "status": "error",
            "message": "GCS URIs require a signed URL. Ensure asset-service returns signedUrl.",
        }

    # Fetch file content and upload to Gemini Files API
    try:
        fetch_resp = httpx.get(asset_url, timeout=300.0, follow_redirects=True)
        fetch_resp.raise_for_status()
        file_bytes = fetch_resp.content
    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch asset from URL: %s", exc)
        return {
            "status": "error",
            "message": f"Could not fetch asset from URL: {exc}",
        }

    if not file_bytes:
        return {
            "status": "error",
            "message": "Asset URL returned empty content.",
        }

    logger.info("[digest] Uploading asset to Gemini Files API (%d bytes)", len(file_bytes))

    try:
        uploaded = upload_file_sync(
            file_bytes,
            normalized_mime,
            display_name=asset_name or f"asset-{asset_id}",
        )
    except Exception as exc:
        logger.exception("Failed to upload to Gemini Files API")
        return {
            "status": "error",
            "message": f"Failed to upload asset to Gemini: {exc}",
        }

    file_uri = uploaded.uri

    # Build Gemini generateContent request
    depth_val = depth or "detailed"
    system_prompt = _build_system_prompt(category, asset_name, depth_val)
    user_prompt = (
        f"{system_prompt}\n\nUser's specific question: {query.strip()}"
        if query and query.strip()
        else system_prompt
    )

    # Gemini REST API uses snake_case for parts
    file_part: dict[str, Any] = {
        "file_data": {
            "file_uri": file_uri,
        },
    }
    if category == "video" and (start_offset or end_offset):
        vid_meta: dict[str, Any] = {}
        if start_offset:
            vid_meta["start_offset"] = start_offset
        if end_offset:
            vid_meta["end_offset"] = end_offset
        file_part["video_metadata"] = vid_meta

    parts: list[dict[str, Any]] = [file_part, {"text": user_prompt}]

    max_tokens = 8192 if depth_val == "exhaustive" else (4096 if depth_val == "detailed" else 1024)
    generation_config: dict[str, Any] = {
        "temperature": 0.2,
        "max_output_tokens": max_tokens,
    }

    if media_resolution:
        res_map = {"low": "MEDIA_RESOLUTION_LOW", "medium": "MEDIA_RESOLUTION_MEDIUM", "high": "MEDIA_RESOLUTION_HIGH"}
        generation_config["media_resolution"] = res_map.get(media_resolution, "MEDIA_RESOLUTION_MEDIUM")

    request_body = {
        "contents": [{"role": "user", "parts": parts}],
        "generation_config": generation_config,
    }

    model_id = getattr(settings, "digest_model", None) or settings.gemini_model
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={settings.google_api_key}"

    logger.info("[digest] Calling Gemini generateContent with file_uri: %s", file_uri)

    try:
        gen_response = httpx.post(
            api_url,
            json=request_body,
            timeout=300.0,
            headers={"Content-Type": "application/json"},
        )
    except httpx.HTTPError as exc:
        return {
            "status": "error",
            "message": f"Failed to call Gemini API: {exc}",
        }

    if gen_response.status_code != 200:
        err_text = gen_response.text[:500]
        logger.warning("[digest] Gemini API error: %s", err_text)
        try:
            err_json = gen_response.json()
            err_msg = err_json.get("error", {}).get("message", err_text)
        except Exception:
            err_msg = err_text
        return {
            "status": "error",
            "message": f"Gemini API error: {err_msg}",
        }

    try:
        payload = gen_response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Failed to parse Gemini response: {exc}",
        }

    candidates = payload.get("candidates", [])
    analysis_parts = []
    for c in candidates:
        for p in c.get("content", {}).get("parts", []):
            if "text" in p:
                analysis_parts.append(p["text"])
    analysis_text = "\n\n".join(analysis_parts) if analysis_parts else ""

    if not analysis_text:
        return {
            "status": "error",
            "message": "No analysis generated by Gemini.",
        }

    usage = payload.get("usageMetadata", {})
    total_tokens = usage.get("totalTokenCount")

    outputs: list[dict[str, Any]] = [
        {"type": "text", "text": f'**Analysis of "{asset_name or asset_id}"** ({asset_type}, {depth_val} depth)\n\n{analysis_text}'},
    ]
    if total_tokens:
        outputs.append({"type": "text", "text": f"\n---\n_Tokens used: {total_tokens:,}_"})

    return {
        "status": "success",
        "outputs": outputs,
        "analysis": analysis_text,
        "assetId": asset_id,
        "assetName": asset_name,
        "assetType": asset_type,
        "category": category,
        "depth": depth_val,
        "tokensUsed": total_tokens,
    }
