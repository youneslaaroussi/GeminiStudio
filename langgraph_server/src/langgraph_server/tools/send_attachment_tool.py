"""Tool to send media attachments directly to the user."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Literal, Optional

import httpx
from langchain_core.tools import tool, InjectedToolArg

logger = logging.getLogger(__name__)


@tool
def sendAttachment(
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

    if not settings.telegram_bot_token:
        return {
            "status": "error",
            "message": "Telegram bot token not configured.",
            "reason": "no_token",
        }

    telegram_base_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}"

    # Map type to Telegram endpoint and payload key
    if type == "video":
        endpoint = f"{telegram_base_url}/sendVideo"
        media_key = "video"
    elif type == "image":
        endpoint = f"{telegram_base_url}/sendPhoto"
        media_key = "photo"
    elif type == "audio":
        endpoint = f"{telegram_base_url}/sendAudio"
        media_key = "audio"
    else:
        endpoint = f"{telegram_base_url}/sendVideo"
        media_key = "video"

    payload = {
        "chat_id": telegram_chat_id,
        media_key: url.strip(),
    }
    if caption:
        payload["caption"] = caption[:1024]

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(endpoint, json=payload)

            if response.status_code == 200:
                result = response.json().get("result", {})
                message_id = result.get("message_id")
                logger.info(
                    "[SEND_ATTACHMENT] Sent %s to %s, message_id=%s",
                    type,
                    telegram_chat_id,
                    message_id,
                )
                return {
                    "status": "success",
                    "type": type,
                    "message_id": message_id,
                    "message": f"Sent {type} to user.",
                }
            else:
                error_text = response.text[:200]
                logger.warning(
                    "[SEND_ATTACHMENT] Failed to send %s (status=%d): %s",
                    type,
                    response.status_code,
                    error_text,
                )
                return {
                    "status": "error",
                    "message": f"Telegram rejected the {type}. Status: {response.status_code}",
                    "reason": "telegram_error",
                    "details": error_text,
                }

    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Error sending attachment")
        return {
            "status": "error",
            "message": f"Error sending attachment: {str(e)}",
            "reason": "exception",
        }
