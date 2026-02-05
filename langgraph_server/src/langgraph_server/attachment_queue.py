"""Thread-safe queue for attachments to be bundled with agent responses.

The agent can call the queueAttachment tool to queue media (video, image, audio)
that should be sent with its next text response. When the response handler sends
the message, it pops the queued attachments and bundles them together.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Literal

logger = logging.getLogger(__name__)

# Registry of queued attachments keyed by thread_id
_queued_attachments: Dict[str, List[Dict[str, Any]]] = {}
_queue_lock = asyncio.Lock()


async def queue_attachment(
    thread_id: str,
    url: str,
    media_type: Literal["video", "image", "audio"],
    caption: str | None = None,
    name: str | None = None,
) -> None:
    """Queue an attachment to be sent with the next response for this thread.

    Args:
        thread_id: The conversation thread ID (e.g., "telegram-123456")
        url: The media URL (signed GCS URL or absolute URL)
        media_type: Type of media - "video", "image", or "audio"
        caption: Optional caption for the attachment
        name: Optional display name for the attachment
    """
    attachment = {
        "url": url,
        "type": media_type,
        "caption": caption,
        "name": name,
        "queuedAt": datetime.utcnow().isoformat() + "Z",
    }

    async with _queue_lock:
        if thread_id not in _queued_attachments:
            _queued_attachments[thread_id] = []
        _queued_attachments[thread_id].append(attachment)
        logger.info(
            "[ATTACHMENT_QUEUE] Queued %s attachment for thread %s (total: %d)",
            media_type,
            thread_id,
            len(_queued_attachments[thread_id]),
        )


async def pop_attachments(thread_id: str) -> List[Dict[str, Any]]:
    """Pop and return all queued attachments for a thread.

    This clears the queue for the thread, so attachments are only sent once.

    Args:
        thread_id: The conversation thread ID

    Returns:
        List of attachment dicts, or empty list if none queued
    """
    async with _queue_lock:
        attachments = _queued_attachments.pop(thread_id, [])
        if attachments:
            logger.info(
                "[ATTACHMENT_QUEUE] Popped %d attachment(s) for thread %s",
                len(attachments),
                thread_id,
            )
        return attachments


async def peek_attachments(thread_id: str) -> List[Dict[str, Any]]:
    """Peek at queued attachments without removing them.

    Args:
        thread_id: The conversation thread ID

    Returns:
        List of attachment dicts, or empty list if none queued
    """
    async with _queue_lock:
        return list(_queued_attachments.get(thread_id, []))


async def clear_attachments(thread_id: str) -> int:
    """Clear all queued attachments for a thread without returning them.

    Args:
        thread_id: The conversation thread ID

    Returns:
        Number of attachments that were cleared
    """
    async with _queue_lock:
        attachments = _queued_attachments.pop(thread_id, [])
        if attachments:
            logger.info(
                "[ATTACHMENT_QUEUE] Cleared %d attachment(s) for thread %s",
                len(attachments),
                thread_id,
            )
        return len(attachments)


def queue_attachment_sync(
    thread_id: str,
    url: str,
    media_type: Literal["video", "image", "audio"],
    caption: str | None = None,
    name: str | None = None,
) -> None:
    """Synchronous version of queue_attachment for use in sync tool functions.

    Note: This is not thread-safe for concurrent access. Use the async version
    when possible.
    """
    attachment = {
        "url": url,
        "type": media_type,
        "caption": caption,
        "name": name,
        "queuedAt": datetime.utcnow().isoformat() + "Z",
    }

    if thread_id not in _queued_attachments:
        _queued_attachments[thread_id] = []
    _queued_attachments[thread_id].append(attachment)
    logger.info(
        "[ATTACHMENT_QUEUE] Queued %s attachment for thread %s (total: %d, sync)",
        media_type,
        thread_id,
        len(_queued_attachments[thread_id]),
    )
