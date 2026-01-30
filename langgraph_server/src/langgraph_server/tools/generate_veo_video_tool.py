"""Tool to generate videos using Google's Veo model."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, Optional
from uuid import uuid4

from langchain_core.tools import tool, InjectedToolArg

from ..config import get_settings
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError

logger = logging.getLogger(__name__)

_ASPECT_RATIO_CHOICES = {"16:9", "9:16"}
_RESOLUTION_CHOICES = {"720p", "1080p"}
_DURATION_CHOICES = {4, 6, 8}


def _get_veo_client():
    """Get Google GenAI client for Veo."""
    from google import genai
    
    settings = get_settings()
    return genai.Client(api_key=settings.google_api_key)


@tool
def generateVeoVideo(
    prompt: str,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    duration_seconds: int = 8,
    negative_prompt: str | None = None,
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Generate a video using Google's Veo AI model from a text prompt.

    This queues video generation and notifies you when it completes. Veo generates
    8-second 720p or 1080p videos with realistic motion and natively generated audio.

    Args:
        prompt: Detailed description of the video to generate. Include subject, action,
            style, camera motion, and ambiance for best results. Use quotes for dialogue.
        aspect_ratio: Video aspect ratio - "16:9" (landscape) or "9:16" (portrait).
        resolution: Output resolution - "720p" or "1080p" (1080p only for 8s videos).
        duration_seconds: Video length - 4, 6, or 8 seconds.
        negative_prompt: What NOT to include in the video (e.g. "cartoon, blurry").
        project_id: Project ID (injected by agent).
        user_id: User ID (injected by agent).
        branch_id: Branch ID (injected by agent).

    Returns:
        Status dict with operation info or error message.
    """
    from google.genai import types
    
    context = _agent_context or {}
    settings = get_settings()

    effective_user_id = user_id or context.get("user_id")
    if not effective_user_id:
        return {
            "status": "error",
            "message": "Unable to generate video because no user context is available.",
            "reason": "missing_user",
        }

    thread_id = context.get("thread_id")
    if not thread_id:
        return {
            "status": "error",
            "message": (
                "Video generation could not be started because no conversation thread is associated. "
                "Please make the request from within an active chat session."
            ),
            "reason": "missing_thread",
        }

    # Validate parameters
    if aspect_ratio not in _ASPECT_RATIO_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid aspect_ratio '{aspect_ratio}'. Choose from {sorted(_ASPECT_RATIO_CHOICES)}.",
            "reason": "invalid_aspect_ratio",
        }

    if resolution not in _RESOLUTION_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid resolution '{resolution}'. Choose from {sorted(_RESOLUTION_CHOICES)}.",
            "reason": "invalid_resolution",
        }

    if duration_seconds not in _DURATION_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid duration_seconds '{duration_seconds}'. Choose from {sorted(_DURATION_CHOICES)}.",
            "reason": "invalid_duration",
        }

    # 1080p only available for 8s duration
    if resolution == "1080p" and duration_seconds != 8:
        return {
            "status": "error",
            "message": "1080p resolution is only available for 8-second videos.",
            "reason": "invalid_resolution_duration",
        }

    if not prompt or len(prompt.strip()) < 10:
        return {
            "status": "error",
            "message": "Please provide a more detailed prompt (at least 10 characters).",
            "reason": "invalid_prompt",
        }

    # Deduct credits before generation (cost varies by resolution)
    cost = get_credits_for_action("veo_generation", resolution)
    try:
        deduct_credits(effective_user_id, cost, "veo_generation", settings)
    except InsufficientCreditsError as e:
        logger.warning("[VEO] Insufficient credits for user %s", effective_user_id)
        return {
            "status": "error",
            "message": f"Insufficient credits. You need {e.required} R‑Credits for {resolution} video generation. Add credits in Gemini Studio Settings to continue.",
            "reason": "insufficient_credits",
            "required": e.required,
            "current": e.current,
        }

    request_id = uuid4().hex
    effective_project_id = project_id or context.get("project_id")

    try:
        client = _get_veo_client()
        
        # Build generation config
        config_kwargs = {
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "duration_seconds": duration_seconds,
        }
        if negative_prompt:
            config_kwargs["negative_prompt"] = negative_prompt
        
        config = types.GenerateVideosConfig(**config_kwargs)
        
        # Start video generation (async operation)
        operation = client.models.generate_videos(
            model=settings.veo_model,
            prompt=prompt,
            config=config,
        )
        
        operation_name = operation.name
        logger.info(
            "[VEO] Started video generation: operation=%s, prompt=%s..., user=%s",
            operation_name,
            prompt[:50],
            effective_user_id,
        )

    except Exception as exc:
        logger.exception("[VEO] Failed to start video generation")
        return {
            "status": "error",
            "message": f"Failed to start video generation: {exc}",
            "reason": "veo_api_error",
        }

    # Store pending operation for polling
    from ..veo_events import register_pending_operation
    
    agent_metadata = {
        "threadId": thread_id,
        "projectId": effective_project_id,
        "userId": effective_user_id,
        "requestId": request_id,
        "branchId": branch_id or context.get("branch_id"),
    }
    
    metadata = {
        "tags": ["gemini-agent", "generateVeoVideo"],
        "extra": {
            "requestedAt": datetime.now(timezone.utc).isoformat(),
            "prompt": prompt[:200],  # Store truncated prompt for reference
            "aspectRatio": aspect_ratio,
            "resolution": resolution,
            "durationSeconds": duration_seconds,
        },
        "agent": agent_metadata,
    }
    
    register_pending_operation(
        operation_name=operation_name,
        metadata=metadata,
        settings=settings,
    )

    return {
        "status": "queued",
        "operationName": operation_name,
        "requestId": request_id,
        "eventTopic": settings.veo_event_topic,
        "message": (
            f"Video generation started (operation: {operation_name[:20]}...). "
            "I'll notify you once Veo completes the video (typically 1-3 minutes)."
        ),
        "metadata": metadata,
    }
