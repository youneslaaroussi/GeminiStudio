"""Tool to subscribe to asset pipeline completion notifications."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Optional

from langchain_core.tools import tool, InjectedToolArg

from ..config import get_settings

logger = logging.getLogger(__name__)


@tool
async def subscribeToAssetPipeline(
    asset_id: str,
    asset_name: str | None = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Subscribe to receive a notification when an asset's processing pipeline completes.

    Use this when you've uploaded an asset or started a pipeline and want to be
    notified when processing finishes (e.g., transcription, metadata extraction).

    The notification will be sent to the current chat when the pipeline completes,
    including a summary of what was processed and any errors.

    Args:
        asset_id: The ID of the asset to watch.
        asset_name: Optional name of the asset for display purposes.

    Returns:
        Status dict confirming the subscription.
    """
    from ..pipeline_events import subscribe_to_asset_pipeline

    context = _agent_context or {}
    settings = get_settings()

    effective_user_id = context.get("user_id")
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

    effective_project_id = context.get("project_id")
    effective_branch_id = context.get("branch_id")

    # Register the subscription
    await subscribe_to_asset_pipeline(
        asset_id=asset_id.strip(),
        thread_id=thread_id,
        user_id=effective_user_id,
        project_id=effective_project_id or "",
        asset_name=asset_name,
        branch_id=effective_branch_id,
    )

    display_name = asset_name or asset_id[:16]
    logger.info(
        "[SUBSCRIBE_PIPELINE] Subscribed to asset %s for thread %s",
        asset_id,
        thread_id,
    )

    return {
        "status": "subscribed",
        "assetId": asset_id,
        "assetName": asset_name,
        "message": (
            f"I'm now watching asset '{display_name}' for pipeline completion. "
            "I'll notify you when processing finishes."
        ),
    }
