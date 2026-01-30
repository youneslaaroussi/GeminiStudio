"""Gemini multimodal analysis pipeline step for comprehensive asset descriptions."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state
from ...config import get_settings

logger = logging.getLogger(__name__)


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
    model_id: str = "gemini-3-pro-preview",
) -> dict[str, Any]:
    """Call Gemini API with the asset for analysis."""
    # Build content parts - media first, then text (Gemini best practice)
    parts = [
        {
            "fileData": {
                "fileUri": gcs_uri,
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
    }


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

    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY not configured, skipping Gemini analysis")
        return PipelineResult(
            status=StepStatus.FAILED,
            error="GEMINI_API_KEY is not configured",
        )

    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before Gemini analysis")

    # Determine media category
    category = _get_media_category(context.asset.mime_type)

    # Build analysis prompt
    prompt = _build_analysis_prompt(category, context.asset.name)

    # Call Gemini API
    logger.info(f"Starting Gemini analysis for asset {context.asset.id} ({category})")

    result = await _call_gemini_api(
        gcs_uri=gcs_uri,
        mime_type=context.asset.mime_type,
        prompt=prompt,
        api_key=settings.gemini_api_key,
        model_id=settings.gemini_model_id,
    )

    if not result.get("analysis"):
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
