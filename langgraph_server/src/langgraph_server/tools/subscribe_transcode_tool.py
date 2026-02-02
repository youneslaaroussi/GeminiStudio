"""Tool to subscribe to asset transcode completion notifications."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Optional

from langchain_core.tools import tool, InjectedToolArg

from ..config import get_settings

logger = logging.getLogger(__name__)


@tool
async def subscribeToAssetTranscode(
    asset_id: str,
    asset_name: str | None = None,
    project_id: str | None = None,
    user_id: str | None = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Subscribe to receive a notification when an asset's transcode completes.

    Use this when a user uploads a video file (especially MOV, MKV, or other formats
    that need transcoding) and you want to be notified when the transcoded version
    is ready. This happens BEFORE the full analysis pipeline runs.

    The notification will be sent to the current chat when transcoding finishes,
    allowing you to respond to the user quickly without waiting for full analysis.

    Args:
        asset_id: The ID of the asset to watch.
        asset_name: Optional name of the asset for display purposes.
        project_id: Project ID (injected by agent if not provided).
        user_id: User ID (injected by agent if not provided).

    Returns:
        Status dict confirming the subscription.
    """
    from ..pipeline_events import subscribe_to_asset_transcode

    context = _agent_context or {}
    settings = get_settings()

    effective_user_id = user_id or context.get("user_id")
    if not effective_user_id:
        return {
            "status": "error",
            "message": "Unable to subscribe because no user context is available.",
            "reason": "missing_user",
        }

    thread_id = context.get("thread_id")
    if not thread_id:
        return {
            "status": "error",
            "message": (
                "Unable to subscribe because no conversation thread is associated. "
                "Please make the request from within an active chat session."
            ),
            "reason": "missing_thread",
        }

    if not asset_id or not asset_id.strip():
        return {
            "status": "error",
            "message": "Please provide a valid asset_id to subscribe to.",
            "reason": "invalid_asset_id",
        }

    effective_project_id = project_id or context.get("project_id")
    effective_branch_id = context.get("branch_id")

    # Register the subscription
    await subscribe_to_asset_transcode(
        asset_id=asset_id.strip(),
        thread_id=thread_id,
        user_id=effective_user_id,
        project_id=effective_project_id or "",
        asset_name=asset_name,
        branch_id=effective_branch_id,
    )

    display_name = asset_name or asset_id[:16]
    logger.info(
        "[SUBSCRIBE_TRANSCODE] Subscribed to asset %s for thread %s",
        asset_id,
        thread_id,
    )

    return {
        "status": "subscribed",
        "assetId": asset_id,
        "assetName": asset_name,
        "message": (
            f"I'm now watching asset '{display_name}' for transcode completion. "
            "I'll notify you when the video is ready."
        ),
    }
