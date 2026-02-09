"""Gemini multimodal analysis pipeline step for comprehensive asset descriptions."""

from __future__ import annotations

import logging
import mimetypes
from typing import Any

import httpx

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state
from ...api_key_provider import (
    get_current_key,
    init_api_key_provider,
    is_quota_exhausted,
    keys_count,
    reset_key_index_to_zero,
    rotate_next_key,
)
from ...config import get_settings
from ...gemini import (
    upload_file_from_gcs,
    wait_for_file_active,
    delete_file,
    GeminiFilesApiError,
)

logger = logging.getLogger(__name__)


# Common media MIME types that Gemini supports
SUPPORTED_MIME_TYPES = {
    # Video
    "video/mp4", "video/mpeg", "video/mov", "video/avi", "video/x-flv",
    "video/mpg", "video/webm", "video/wmv", "video/3gpp", "video/quicktime",
    # Audio
    "audio/wav", "audio/mp3", "audio/mpeg", "audio/aiff", "audio/aac",
    "audio/ogg", "audio/flac", "audio/x-wav", "audio/x-m4a", "audio/mp4",
    # Image
    "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
    "image/gif", "image/bmp", "image/tiff",
}

# Extension to MIME type mapping for common media files
EXTENSION_MIME_MAP = {
    # Video
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
    ".m4v": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
    # Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".wma": "audio/x-ms-wma",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    # Image
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def _resolve_mime_type(mime_type: str, filename: str) -> str:
    """
    Resolve the correct MIME type for a file.
    
    If the MIME type is generic (application/octet-stream), try to infer
    from the file extension. Falls back to the original if we can't determine.
    """
    # If MIME type looks valid, use it
    if mime_type and mime_type != "application/octet-stream":
        return mime_type
    
    # Try to get MIME type from extension
    if filename:
        # Get extension (lowercase)
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        
        # Check our mapping first
        if ext in EXTENSION_MIME_MAP:
            resolved = EXTENSION_MIME_MAP[ext]
            logger.info(f"Resolved MIME type from extension {ext}: {resolved}")
            return resolved
        
        # Fall back to mimetypes module
        guessed, _ = mimetypes.guess_type(filename)
        if guessed:
            logger.info(f"Guessed MIME type for {filename}: {guessed}")
            return guessed
    
    # Return original if we can't resolve
    logger.warning(f"Could not resolve MIME type for {filename}, using: {mime_type}")
    return mime_type


def _get_media_category(mime_type: str) -> str:
    """Get media category from MIME type."""
    if mime_type.startswith("video/"):
        return "video"
    elif mime_type.startswith("audio/"):
        return "audio"
    elif mime_type.startswith("image/"):
        return "image"
    return "media"


def _build_analysis_prompt(category: str, asset_name: str) -> str:
    """Build comprehensive analysis prompt based on media type."""
    category_prompts = {
        "video": f"""You are analyzing a video named "{asset_name}". Provide an extremely thorough temporal analysis.

Your analysis MUST include:

1. **Overview**: Brief summary of the video content, purpose, and overall narrative/subject.

2. **Scene-by-Scene Breakdown**: For EACH distinct scene or segment:
   - Timestamp range (e.g., 0:00-0:15)
   - Detailed description of visual content
   - Camera movements/angles (pan, zoom, static, etc.)
   - Transitions between scenes (cut, fade, dissolve, etc.)
   - Any on-screen text, graphics, or overlays

3. **Visual Elements**:
   - Color palette and lighting (changes over time)
   - Composition and framing choices
   - Visual style (cinematic, documentary, amateur, etc.)
   - Special effects or post-processing visible

4. **Audio Elements** (describe what you can infer/hear):
   - Dialogue or narration (summarize key points)
   - Music (genre, mood, when it plays)
   - Sound effects and ambient audio
   - Audio transitions and emphasis

5. **Key Moments**: Highlight the most significant moments with timestamps.

6. **Technical Observations**:
   - Estimated quality/resolution
   - Aspect ratio
   - Frame rate characteristics (smooth, choppy, slow-mo)
   - Any visible artifacts or issues

7. **Content Tags**: List relevant tags for searchability (subjects, actions, settings, moods).

Be specific with timestamps and descriptions. This analysis will be used for video editing and searching.""",

        "audio": f"""You are analyzing an audio file named "{asset_name}". Provide an extremely thorough temporal analysis.

Your analysis MUST include:

1. **Overview**: Type of audio content (speech, music, sound effects, podcast, etc.) and general summary.

2. **Temporal Breakdown**: Segment-by-segment analysis:
   - Timestamp range for each segment
   - What's happening in each segment
   - Transitions between segments

3. **For Speech/Voice Content**:
   - Transcription of key sections
   - Speaker identification (if multiple speakers)
   - Tone, emotion, and delivery style
   - Topics discussed with timestamps

4. **For Music**:
   - Genre and style
   - Tempo and rhythm patterns
   - Instruments identified
   - Mood progression over time
   - Verse/chorus/bridge structure with timestamps

5. **Sound Design**:
   - Sound effects and their timestamps
   - Ambient sounds and background audio
   - Audio mixing characteristics (stereo width, dynamics)

6. **Technical Observations**:
   - Audio quality assessment
   - Volume levels and dynamics
   - Any artifacts, noise, or issues

7. **Content Tags**: Relevant searchable tags.

Be specific with timestamps. This analysis will be used for audio editing and searching.""",

        "image": f"""You are analyzing an image named "{asset_name}". Provide an extremely thorough analysis.

Your analysis MUST include:

1. **Overview**: Brief summary of what the image depicts and its likely purpose.

2. **Main Subject(s)**:
   - Detailed description of primary subjects
   - Position and scale within frame
   - Actions or poses (for people/animals)

3. **Composition**:
   - Framing and rule of thirds analysis
   - Leading lines and visual flow
   - Foreground, midground, background layers
   - Negative space usage

4. **Visual Style**:
   - Color palette (dominant colors, harmony)
   - Lighting (direction, quality, mood)
   - Contrast and exposure
   - Photographic or artistic style

5. **Background & Setting**:
   - Environment description
   - Time of day/season (if apparent)
   - Location context clues

6. **Text & Graphics** (if any):
   - Transcribe visible text
   - Describe graphics, logos, or overlays

7. **Technical Observations**:
   - Estimated resolution/quality
   - Focus and depth of field
   - Any visible artifacts or editing

8. **Mood & Emotion**: Overall feeling the image conveys.

9. **Content Tags**: Comprehensive list of searchable tags.

This analysis will be used for asset management and searching.""",
    }

    return category_prompts.get(
        category,
        f"""You are analyzing a media file named "{asset_name}". Provide a comprehensive analysis covering:
- What the content depicts or contains
- Notable features and details
- Quality assessment
- Relevant searchable tags

Be thorough and specific. This analysis will be used for asset management.""",
    )


async def _call_gemini_api(
    gcs_uri: str,
    mime_type: str,
    prompt: str,
    api_key: str,
    asset_name: str,
    model_id: str = "gemini-3-pro-preview",
) -> dict[str, Any]:
    """
    Call Gemini API with the asset for analysis.

    This uploads the file to the Gemini Files API first, waits for processing,
    then uses the file URI in the generateContent request.
    """
    gemini_file = None

    try:
        # Step 1: Upload file to Gemini Files API
        logger.info(f"Uploading {gcs_uri} to Gemini Files API...")
        gemini_file = await upload_file_from_gcs(
            gcs_uri=gcs_uri,
            mime_type=mime_type,
            display_name=asset_name,
        )
        logger.info(f"Uploaded as {gemini_file.name}, waiting for processing...")

        # Step 2: Wait for file to be ready
        gemini_file = await wait_for_file_active(
            gemini_file.name,
            max_wait_seconds=120.0,
        )
        logger.info(f"File {gemini_file.name} is ready, calling generateContent...")

        # Step 3: Build request with Gemini Files API URI
        parts = [
            {
                "fileData": {
                    "fileUri": gemini_file.uri,
                    "mimeType": mime_type,
                },
            },
            {"text": prompt},
        ]

        request_body = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0.2,  # Lower temperature for factual analysis
                "maxOutputTokens": 8192,
            },
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"

        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                url,
                json=request_body,
                headers={"Content-Type": "application/json"},
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Gemini API error: {response.status_code} - {error_text}")
                raise RuntimeError(f"Gemini API error: {response.status_code}")

            payload = response.json()

        # Extract analysis text
        candidates = payload.get("candidates", [])
        analysis_text = "\n\n".join(
            part.get("text", "")
            for candidate in candidates
            for part in candidate.get("content", {}).get("parts", [])
            if part.get("text")
        )

        usage = payload.get("usageMetadata", {})

        return {
            "analysis": analysis_text,
            "promptTokens": usage.get("promptTokenCount"),
            "completionTokens": usage.get("candidatesTokenCount"),
            "totalTokens": usage.get("totalTokenCount"),
            "geminiFileUri": gemini_file.uri,
        }

    finally:
        # Clean up: delete the temporary file from Gemini Files API
        # (files auto-expire after 48h, but good practice to clean up)
        if gemini_file:
            try:
                await delete_file(gemini_file.name)
                logger.info(f"Cleaned up temporary file {gemini_file.name}")
            except Exception as e:
                logger.warning(f"Failed to clean up file {gemini_file.name}: {e}")


@register_step(
    id="gemini-analysis",
    label="Gemini AI Analysis",
    description="Comprehensive multimodal analysis using Gemini AI for detailed asset descriptions.",
    auto_start=True,
    supported_types=[AssetType.VIDEO, AssetType.AUDIO, AssetType.IMAGE],
)
async def gemini_analysis_step(context: PipelineContext) -> PipelineResult:
    """Analyze asset using Gemini for comprehensive description."""
    settings = get_settings()
    init_api_key_provider(settings)

    if not get_current_key():
        logger.warning("GEMINI_API_KEY / GEMINI_API_KEYS not configured, skipping Gemini analysis")
        return PipelineResult(
            status=StepStatus.FAILED,
            error="GEMINI_API_KEY / GEMINI_API_KEYS is not configured",
        )

    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before Gemini analysis")

    # Resolve MIME type (handle application/octet-stream)
    resolved_mime_type = _resolve_mime_type(context.asset.mime_type, context.asset.name)
    
    # Determine media category
    category = _get_media_category(resolved_mime_type)

    # Build analysis prompt
    prompt = _build_analysis_prompt(category, context.asset.name)

    # Call Gemini API with key rotation on 429 and model priority list
    logger.info(f"Starting Gemini analysis for asset {context.asset.id} ({category}, mime: {resolved_mime_type})")
    n_keys = max(1, keys_count())
    analysis_model_ids = settings.analysis_model_ids
    last_exc: Exception | None = None
    result = None
    for model_id in analysis_model_ids:
        for _ in range(n_keys):
            api_key = get_current_key()
            if not api_key:
                return PipelineResult(
                    status=StepStatus.FAILED,
                    error="GEMINI_API_KEY / GEMINI_API_KEYS is not configured",
                )
            try:
                result = await _call_gemini_api(
                    gcs_uri=gcs_uri,
                    mime_type=resolved_mime_type,
                    prompt=prompt,
                    api_key=api_key,
                    asset_name=context.asset.name,
                    model_id=model_id,
                )
                break
            except Exception as e:
                last_exc = e
                if is_quota_exhausted(e) and keys_count() > 1:
                    logger.warning("Gemini analysis 429, rotating to next API key: %s", e)
                    rotate_next_key()
                    continue
                raise
        else:
            continue
        break
    else:
        reset_key_index_to_zero()
        if last_exc:
            raise last_exc
        return PipelineResult(status=StepStatus.FAILED, error="Gemini analysis failed")

    if not result or not result.get("analysis"):
        return PipelineResult(
            status=StepStatus.FAILED,
            error="No analysis generated by Gemini",
        )

    logger.info(
        f"Gemini analysis complete for asset {context.asset.id}, "
        f"tokens used: {result.get('totalTokens', 'unknown')}"
    )

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "analysis": result["analysis"],
            "category": category,
            "promptTokens": result.get("promptTokens"),
            "completionTokens": result.get("completionTokens"),
            "totalTokens": result.get("totalTokens"),
            "model": settings.gemini_model_id,
            "gcsUri": gcs_uri,
        },
    )
