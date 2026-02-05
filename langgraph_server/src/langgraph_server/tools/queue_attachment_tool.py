"""Tool to queue media attachments for the agent's response."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Literal, Optional

from langchain_core.tools import tool, InjectedToolArg

logger = logging.getLogger(__name__)


@tool
def queueAttachment(
    url: str,
    type: Literal["video", "image", "audio"],
    caption: Optional[str] = None,
    name: Optional[str] = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Queue a media attachment to be sent with your next text response.

    Use this to attach media files (videos, images, audio) to your response.
    The attachment will be sent to the user along with your text message.
    You can queue multiple attachments by calling this tool multiple times.

    IMPORTANT: After queueing attachments, you MUST still provide a text response.
    The attachments will be bundled with your text when sent to the user.

    Args:
        url: The URL of the media file. Can be a signed GCS URL or absolute URL.
        type: The type of media - "video", "image", or "audio".
        caption: Optional caption or description for the attachment.
        name: Optional display name for the attachment.

    Returns:
        Status dict confirming the attachment was queued.
    """
    from ..attachment_queue import queue_attachment_sync

    context = _agent_context or {}
    thread_id = context.get("thread_id")

    if not thread_id:
        return {
            "status": "error",
            "message": (
                "Unable to queue attachment because no conversation thread is available. "
                "Please make the request from within an active chat session."
            ),
            "reason": "missing_thread",
        }

    if not url or not url.strip():
        return {
            "status": "error",
            "message": "Please provide a valid URL for the attachment.",
            "reason": "invalid_url",
        }

    if type not in ("video", "image", "audio"):
        return {
            "status": "error",
            "message": f"Invalid attachment type '{type}'. Must be 'video', 'image', or 'audio'.",
            "reason": "invalid_type",
        }

    # Queue the attachment
    queue_attachment_sync(
        thread_id=thread_id,
        url=url.strip(),
        media_type=type,
        caption=caption,
        name=name,
    )

    display_name = name or type
    logger.info(
        "[QUEUE_ATTACHMENT] Queued %s attachment for thread %s: %s",
        type,
        thread_id,
        url[:80],
    )

    return {
        "status": "queued",
        "type": type,
        "url": url,
        "caption": caption,
        "name": name,
        "message": (
            f"Attachment '{display_name}' ({type}) queued. "
            "It will be sent with your next text response."
        ),
    }
