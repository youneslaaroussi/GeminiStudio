"""Tool to load an asset for multimodal viewing by the agent.

Returns the media directly to the agent so it can analyze with full conversation context.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

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


def _normalize_mime_type(mime_type: str) -> str:
    """Normalize MIME type for Gemini."""
    m = (mime_type or "").lower().strip()
    return _MIME_NORMALIZE.get(m, m)


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


@tool
def watchAsset(
    asset_id: str,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    _agent_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Load an asset (video, image, or audio) so you can see/hear it directly.

    Use start_time/end_time (in seconds) to focus on a specific segment of video.
    Use this when you need to analyze media with conversation context, compare to discussed styles,
    answer follow-up questions, or when the user wants you to "look at" or "watch" something.

    Args:
        asset_id: The ID of the asset to watch/view.
        start_time: Optional start time in seconds (e.g. '2.5' or '10') for video segment.
        end_time: Optional end time in seconds (e.g. '5.0' or '15') for video segment.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to watch an asset.",
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
            "message": "GOOGLE_API_KEY not configured.",
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
            "message": f"Asset type '{asset_type}' is not supported. Supported: {', '.join(supported_types)}.",
        }

    normalized_mime = _normalize_mime_type(mime_type)
    category = _get_media_category(normalized_mime)
    if category == "unknown":
        return {
            "status": "error",
            "message": f"Unsupported media type: {mime_type}",
        }

    # For GCS URIs, we need a signed URL
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

    logger.info("[watchAsset] Uploading asset to Gemini Files API (%d bytes)", len(file_bytes))

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
    logger.info("[watchAsset] Asset ready: %s (%s)", asset_name, file_uri)

    # Return text with _injectMedia flag - agent.py will inject media as HumanMessage
    time_range = f" ({start_time or '0'}s - {end_time or 'end'})" if start_time or end_time else ""
    return {
        "status": "success",
        "message": f"Asset '{asset_name}' loaded{time_range}. The {category} is now visible.",
        "_injectMedia": True,
        "fileUri": file_uri,
        "mimeType": normalized_mime,
        "startOffset": f"{start_time}s" if start_time else None,
        "endOffset": f"{end_time}s" if end_time else None,
        "assetId": asset_id,
        "assetName": asset_name,
        "assetType": asset_type,
        "category": category,
    }
