"""Description generator pipeline step - creates a short description from Gemini analysis."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state, update_pipeline_step
from ...api_key_provider import (
    get_current_key,
    is_quota_exhausted,
    keys_count,
    reset_key_index_to_zero,
    rotate_next_key,
)
from ...config import get_settings
from ...storage.firestore import update_asset

logger = logging.getLogger(__name__)

# Prompt to generate a short description from the analysis
DESCRIPTION_PROMPT = """Based on the following analysis of a media asset, generate a SHORT description (1-2 sentences, max 100 characters) that captures the essence of what the content shows or contains.

The description should be:
- Concise and informative
- Written in a neutral, descriptive tone
- Useful for identifying the asset at a glance
- Focus on the main subject/action

Analysis:
{analysis}

Respond with ONLY the short description, nothing else. No quotes, no explanations."""


async def _generate_description(analysis: str, api_key: str, model_id: str) -> str:
    """Call Gemini to generate a short description from the analysis."""
    prompt = DESCRIPTION_PROMPT.format(analysis=analysis[:8000])  # Limit analysis length

    request_body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 100,
        },
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            json=request_body,
            headers={"Content-Type": "application/json"},
        )

        if response.status_code != 200:
            raise RuntimeError(f"Gemini API error: {response.status_code}")

        payload = response.json()

    # Extract description text
    candidates = payload.get("candidates", [])
    description = ""
    for candidate in candidates:
        for part in candidate.get("content", {}).get("parts", []):
            if part.get("text"):
                description = part["text"].strip()
                break
        if description:
            break

    # Clean up - remove quotes if present
    if description.startswith('"') and description.endswith('"'):
        description = description[1:-1]
    if description.startswith("'") and description.endswith("'"):
        description = description[1:-1]

    # Truncate if too long
    if len(description) > 150:
        description = description[:147] + "..."

    return description


@register_step(
    id="description",
    label="Generate Description",
    description="Generate a short description from Gemini analysis for easy asset identification.",
    auto_start=True,
    supported_types=[AssetType.VIDEO, AssetType.AUDIO, AssetType.IMAGE],
)
async def description_step(context: PipelineContext) -> PipelineResult:
    """Generate a short description from Gemini analysis."""
    settings = get_settings()

    if not get_current_key():
        return PipelineResult(
            status=StepStatus.FAILED,
            error="GEMINI_API_KEY / GEMINI_API_KEYS is not configured",
        )

    # Get the Gemini analysis from the pipeline state
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    gemini_step = next((s for s in state.get("steps", []) if s["id"] == "gemini-analysis"), None)

    if not gemini_step:
        return PipelineResult(
            status=StepStatus.WAITING,
            metadata={"message": "Waiting for Gemini analysis to complete"},
        )

    if gemini_step.get("status") != "succeeded":
        if gemini_step.get("status") == "failed":
            return PipelineResult(
                status=StepStatus.FAILED,
                error="Gemini analysis failed, cannot generate description",
            )
        return PipelineResult(
            status=StepStatus.WAITING,
            metadata={"message": "Waiting for Gemini analysis to complete"},
        )

    analysis = gemini_step.get("metadata", {}).get("analysis", "")
    if not analysis:
        return PipelineResult(
            status=StepStatus.FAILED,
            error="No analysis available from Gemini step",
        )

    # Generate short description with key rotation on 429 and model priority list
    logger.info(f"Generating description for asset {context.asset.id}")
    n_keys = max(1, keys_count())
    description_model_ids = settings.description_model_ids
    last_exc: Exception | None = None
    description = ""
    for model_id in description_model_ids:
        for _ in range(n_keys):
            api_key = get_current_key()
            if not api_key:
                return PipelineResult(
                    status=StepStatus.FAILED,
                    error="GEMINI_API_KEY / GEMINI_API_KEYS is not configured",
                )
            try:
                description = await _generate_description(
                    analysis=analysis,
                    api_key=api_key,
                    model_id=model_id,
                )
                break
            except Exception as e:
                last_exc = e
                if is_quota_exhausted(e) and keys_count() > 1:
                    logger.warning("Description step 429, rotating to next API key: %s", e)
                    rotate_next_key()
                    continue
                logger.exception(f"Failed to generate description: {e}")
                return PipelineResult(
                    status=StepStatus.FAILED,
                    error=f"Failed to generate description: {e}",
                )
        else:
            continue
        break
    else:
        reset_key_index_to_zero()
        logger.exception("Failed to generate description after key rotation: %s", last_exc)
        return PipelineResult(
            status=StepStatus.FAILED,
            error=f"Failed to generate description: {last_exc}",
        )

    if not description:
        return PipelineResult(
            status=StepStatus.FAILED,
            error="Empty description generated",
        )

    # Save description to asset metadata in Firestore
    try:
        update_asset(
            context.user_id,
            context.project_id,
            context.asset.id,
            {"description": description},
            settings,
        )
        logger.info(f"Saved description for asset {context.asset.id}: {description}")
    except Exception as e:
        logger.warning(f"Failed to save description to asset: {e}")
        # Don't fail the step, just log the warning

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "description": description,
            "analysisLength": len(analysis),
        },
    )
