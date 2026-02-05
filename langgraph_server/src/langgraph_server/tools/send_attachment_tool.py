"""Tool to send media attachments directly to the user."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Dict, Literal, Optional

import httpx
from langchain_core.tools import tool, InjectedToolArg

from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)


@tool
def sendAttachment(
    asset_id: str,
    type: Literal["video", "image", "audio"],
    caption: Optional[str] = None,
    _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
    """Send a media attachment directly to the user.

    Use this to send media files (videos, images, audio) to the user immediately.
    The media will be sent as a separate message in the chat.

    Args:
        asset_id: The ID of the asset to send.
        type: The type of media - "video", "image", or "audio".
        caption: Optional caption to display with the media.

    Returns:
        Status dict indicating success or failure.
    """
    from ..config import get_settings

    context = _agent_context or {}
    thread_id = context.get("thread_id")
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not thread_id:
        return {"status": "error", "message": "No conversation thread.", "reason": "missing_thread"}

    if not user_id or not project_id:
        return {"status": "error", "message": "No user/project context.", "reason": "missing_context"}

    if not asset_id or not asset_id.strip():
        return {"status": "error", "message": "Please provide an asset_id.", "reason": "invalid_asset_id"}

    if type not in ("video", "image", "audio"):
        return {"status": "error", "message": f"Invalid type '{type}'.", "reason": "invalid_type"}

    if not thread_id.startswith("telegram-"):
        return {"status": "error", "message": "Only works for Telegram chats.", "reason": "not_telegram"}

    telegram_chat_id = thread_id.replace("telegram-", "")
    settings = get_settings()

    if not settings.telegram_bot_token:
        return {"status": "error", "message": "Telegram bot token not configured.", "reason": "no_token"}

    # Fetch asset to get signed URL
    if not settings.asset_service_url:
        return {"status": "error", "message": "Asset service not configured.", "reason": "no_asset_service"}

    try:
        endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id.strip()}"
        headers = get_asset_service_headers("")
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(endpoint, headers=headers)
            if resp.status_code != 200:
                logger.warning("[SEND_ATTACHMENT] Asset fetch failed: %d %s", resp.status_code, resp.text[:200])
                return {"status": "error", "message": f"Asset not found: {asset_id}", "reason": "asset_not_found"}
            asset = resp.json()
    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Failed to fetch asset")
        return {"status": "error", "message": f"Failed to fetch asset: {e}", "reason": "fetch_failed"}

    signed_url = asset.get("signedUrl")
    if not signed_url:
        return {"status": "error", "message": "Asset has no signed URL.", "reason": "no_url"}

    asset_name = asset.get("name", asset_id)

    # Map type to Telegram endpoint
    telegram_base_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}"
    if type == "video":
        endpoint = f"{telegram_base_url}/sendVideo"
        media_key = "video"
    elif type == "image":
        endpoint = f"{telegram_base_url}/sendPhoto"
        media_key = "photo"
    else:  # audio - use document for any format
        endpoint = f"{telegram_base_url}/sendDocument"
        media_key = "document"

    payload = {
        "chat_id": telegram_chat_id,
        media_key: signed_url,
    }
    if caption:
        payload["caption"] = caption[:1024]

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(endpoint, json=payload)

            if response.status_code == 200:
                result = response.json().get("result", {})
                message_id = result.get("message_id")
                logger.info("[SEND_ATTACHMENT] Sent %s '%s' to %s", type, asset_name, telegram_chat_id)
                return {"status": "success", "type": type, "asset_name": asset_name, "message": f"Sent {asset_name}."}
            else:
                error_text = response.text[:300]
                logger.warning("[SEND_ATTACHMENT] Failed (status=%d): %s", response.status_code, error_text)
                return {"status": "error", "message": f"Telegram rejected: {error_text[:100]}", "reason": "telegram_error"}

    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Error sending")
        return {"status": "error", "message": f"Error: {str(e)}", "reason": "exception"}
