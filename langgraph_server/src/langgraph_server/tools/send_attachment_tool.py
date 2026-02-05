"""Tool to send media attachments directly to the user."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Literal, Optional

from langchain_core.tools import tool, InjectedToolArg

logger = logging.getLogger(__name__)


@tool
async def sendAttachment(
    url: str,
    type: Literal["video", "image", "audio"],
    caption: Optional[str] = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Send a media attachment directly to the user.

    Use this to send media files (videos, images, audio) to the user immediately.
    The media will be sent as a separate message in the chat.

    Args:
        url: The URL of the media file. Can be a signed GCS URL or absolute URL.
        type: The type of media - "video", "image", or "audio".
        caption: Optional caption to display with the media.

    Returns:
        Status dict indicating success or failure.
    """
    from ..config import get_settings
    from ..firebase import send_telegram_message

    context = _agent_context or {}
    thread_id = context.get("thread_id")

    if not thread_id:
        return {
            "status": "error",
            "message": "No conversation thread available.",
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

    # Only works for Telegram sessions
    if not thread_id.startswith("telegram-"):
        return {
            "status": "error",
            "message": "Direct attachment sending only works for Telegram chats.",
            "reason": "not_telegram",
        }

    telegram_chat_id = thread_id.replace("telegram-", "")
    settings = get_settings()

    # Build attachment in the format send_telegram_message expects
    attachment = {
        "url": url.strip(),
        "type": type,
        "caption": caption,
    }

    try:
        result = await send_telegram_message(
            telegram_chat_id,
            caption or "",  # Text/caption
            settings,
            attachments=[attachment],
        )

        if result:
            logger.info(
                "[SEND_ATTACHMENT] Sent %s to %s: %s",
                type,
                telegram_chat_id,
                url[:60],
            )
            return {
                "status": "success",
                "type": type,
                "message": f"Sent {type} to user.",
            }
        else:
            logger.warning(
                "[SEND_ATTACHMENT] Failed to send %s to %s",
                type,
                telegram_chat_id,
            )
            return {
                "status": "error",
                "message": f"Failed to send {type}. Telegram may have rejected the URL.",
                "reason": "send_failed",
            }

    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Error sending attachment")
        return {
            "status": "error",
            "message": f"Error sending attachment: {str(e)}",
            "reason": "exception",
        }
