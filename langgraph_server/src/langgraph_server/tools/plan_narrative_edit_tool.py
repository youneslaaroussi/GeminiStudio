"""Tool to create a structured edit plan for narrative/vlog from raw clips."""

from __future__ import annotations

import json
import logging
from typing import Optional

import httpx
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from ..api_key_provider import (
    get_current_key,
    is_quota_exhausted,
    keys_count,
    rotate_next_key,
)
from ..config import get_settings
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)


class PlanSegment(BaseModel):
    """A single segment to place on the timeline from a source asset."""

    asset_id: str = Field(description="ID of the source asset")
    offset: float = Field(description="Start time in seconds within the source asset")
    duration: float = Field(description="Duration in seconds to use from the source")
    timeline_start: float = Field(description="Position in seconds on the output timeline")
    role: Optional[str] = Field(
        default=None,
        description="Optional role: intro, main, outro, broll, etc.",
    )


class EditPlan(BaseModel):
    """Structured edit plan: ordered segments and optional voiceover script."""

    segments: list[PlanSegment] = Field(
        description="Ordered list of segments to add to the timeline"
    )
    voiceover_script: Optional[str] = Field(
        default=None,
        description="Optional short voiceover/narration script to generate and place on audio layer",
    )


def _fetch_pipeline_state(
    user_id: str, project_id: str, asset_id: str, settings
) -> dict | None:
    """Fetch pipeline state for an asset from the asset service."""
    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/pipeline/{user_id}/{project_id}/{asset_id}"
    try:
        headers = get_asset_service_headers("")
        response = httpx.get(endpoint, headers=headers, timeout=15.0)
        if response.status_code != 200:
            logger.warning("Pipeline fetch failed for %s: %s", asset_id, response.status_code)
            return None
        return response.json()
    except Exception as e:
        logger.warning("Failed to fetch pipeline for %s: %s", asset_id, e)
        return None


def _build_asset_context(asset_id: str, pipeline_state: dict) -> str:
    """Build a concise context string for one asset from pipeline steps."""
    parts = [f"Asset: {asset_id}"]
    steps = pipeline_state.get("steps", [])
    for step in steps:
        if step.get("status") != "succeeded":
            continue
        meta = step.get("metadata", {})
        step_id = step.get("id", "")
        if step_id == "metadata":
            duration = meta.get("duration")
            if duration is not None:
                parts.append(f"  duration_seconds: {duration}")
        elif step_id == "transcription":
            transcript = (meta.get("transcript") or "")[:1500]
            if transcript:
                parts.append(f"  transcript: {transcript}...")
            segs = meta.get("segments", [])
            if segs:
                # First/last few segment timings for trimming
                sample = segs[:5] + segs[-3:] if len(segs) > 8 else segs
                seg_strs = []
                for s in sample:
                    start_ms = s.get("start", 0)
                    start_sec = start_ms / 1000.0 if isinstance(start_ms, (int, float)) else 0
                    speech = (s.get("speech") or "")[:15]
                    seg_strs.append(f"{start_sec:.1f}s '{speech}'")
                parts.append("  segments_sample: " + ", ".join(seg_strs))
        elif step_id == "shot-detection":
            shots = meta.get("shots", [])
            if shots:
                ranges = [f"{s.get('start', 0):.1f}-{s.get('end', 0):.1f}s" for s in shots[:12]]
                parts.append("  shots: " + ", ".join(ranges))
        elif step_id == "gemini-analysis":
            analysis = (meta.get("analysis") or "")[:2000]
            if analysis:
                parts.append(f"  analysis: {analysis}...")
        elif step_id == "description":
            desc = meta.get("description") or meta.get("shortDescription") or ""
            if desc:
                parts.append(f"  description: {desc}")
    return "\n".join(parts)


@tool
def createEditPlan(
    intent: str,
    asset_ids: list[str],
    target_duration_seconds: Optional[float] = None,
    _agent_context: Optional[dict] = None,
) -> dict:
    """Create a structured edit plan for a narrative/vlog from the given assets.

    Use this when the user wants a meaningful video (vlog, story, highlight reel) from
    raw clips. Call listProjectAssets first to get asset_ids, then call this with the
    user's intent (e.g. '2-min vlog', 'highlight reel', 'tutorial'). The plan can be
    executed by adding each segment with addClipToTimeline(asset_id, offset, duration,
    start=timeline_start), then adding voiceover/music if the plan includes a script.

    Args:
        intent: User intent, e.g. '2-min vlog', 'highlight reel', 'tutorial'.
        asset_ids: List of asset IDs to use (from listProjectAssets).
        target_duration_seconds: Optional target total duration in seconds.

    Returns:
        Plan with segments (asset_id, offset, duration, timeline_start, role) and
        optional voiceover_script. Execute with addClipToTimeline and generateSpeech.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "user_id and project_id are required (injected by agent).",
        }
    if not asset_ids:
        return {
            "status": "error",
            "message": "asset_ids is required. Call listProjectAssets first.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    # Fetch pipeline state for each asset and build context
    asset_contexts = []
    for aid in asset_ids[:20]:  # Cap to avoid huge context
        state = _fetch_pipeline_state(user_id, project_id, aid, settings)
        if state:
            asset_contexts.append(_build_asset_context(aid, state))
        else:
            asset_contexts.append(f"Asset: {aid} (no pipeline data or not ready)")

    context_block = "\n\n".join(asset_contexts)

    # Build planner prompt
    target_line = ""
    if target_duration_seconds is not None and target_duration_seconds > 0:
        target_line = f" Target total duration: {target_duration_seconds} seconds."

    prompt = f"""You are an expert video editor. Given the user's intent and the asset metadata below, produce a precise edit plan.

Intent: {intent}.{target_line}

Asset metadata (transcripts, shots, durations, descriptions):
{context_block}

Rules:
- Output segments in timeline order (timeline_start must increase).
- Use only the asset_ids listed above. For each segment use offset and duration to trim (offset = start in source in seconds, duration = length in seconds).
- Respect source durations: offset + duration must not exceed the asset's duration_seconds.
- If target_duration_seconds is set, keep total timeline duration close to it.
- Optionally include a short voiceover_script (1-3 sentences) that fits the intent and can be generated with TTS and placed on the audio layer.
- Prefer coherent segments (e.g. use shot boundaries, complete phrases from transcript).
"""

    n_keys = max(1, keys_count())
    last_exc: Exception | None = None
    for _ in range(n_keys):
        api_key = get_current_key()
        if not api_key:
            return {
                "status": "error",
                "message": "Gemini API key not configured.",
            }
        try:
            model = ChatGoogleGenerativeAI(
                model=settings.gemini_model,
                api_key=api_key,
                convert_system_message_to_human=True,
                timeout=90,
                max_retries=1,
            )
            structured_llm = model.with_structured_output(EditPlan)
            plan = structured_llm.invoke(prompt)
            break
        except Exception as e:
            last_exc = e
            if is_quota_exhausted(e) and keys_count() > 1:
                logger.warning("createEditPlan 429, rotating key: %s", e)
                rotate_next_key()
                continue
            logger.exception("createEditPlan LLM failed: %s", e)
            return {
                "status": "error",
                "message": f"Failed to generate plan: {e}",
            }
    else:
        return {
            "status": "error",
            "message": f"Failed to generate plan: {last_exc}",
        }

    # Serialize for the agent (Pydantic model -> dict)
    plan_dict = plan.model_dump()
    return {
        "status": "success",
        "message": f"Edit plan with {len(plan.segments)} segments. Execute with addClipToTimeline(asset_id, offset, duration, start=timeline_start) for each segment, then add voiceover/music if needed.",
        "plan": plan_dict,
    }
