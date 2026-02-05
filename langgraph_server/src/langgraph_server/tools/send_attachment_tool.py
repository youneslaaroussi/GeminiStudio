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

    if not settings.asset_service_url:
        return {"status": "error", "message": "Asset service not configured.", "reason": "no_asset_service"}

    # Step 1: Fetch asset metadata
    try:
        endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id.strip()}"
        headers = get_asset_service_headers("")
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(endpoint, headers=headers)
            if resp.status_code != 200:
                logger.warning("[SEND_ATTACHMENT] Asset fetch failed: %d", resp.status_code)
                return {"status": "error", "message": f"Asset not found: {asset_id}", "reason": "asset_not_found"}
            asset = resp.json()
    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Failed to fetch asset metadata")
        return {"status": "error", "message": f"Failed to fetch asset: {e}", "reason": "fetch_failed"}

    signed_url = asset.get("signedUrl")
    if not signed_url:
        return {"status": "error", "message": "Asset has no signed URL.", "reason": "no_url"}

    asset_name = asset.get("name") or asset.get("fileName") or f"{asset_id}.bin"
    mime_type = asset.get("mimeType", "application/octet-stream")
    file_size = asset.get("size", 0)

    # Telegram bot upload limit is 50MB
    MAX_SIZE = 50 * 1024 * 1024  # 50MB
    if file_size > MAX_SIZE:
        size_mb = file_size / (1024 * 1024)
        return {
            "status": "error",
            "message": f"File too large ({size_mb:.1f}MB). Telegram limit is 50MB.",
            "reason": "file_too_large",
        }

    # Step 2: Download the file from GCS
    try:
        logger.info("[SEND_ATTACHMENT] Downloading %s (%s)", asset_name, mime_type)
        with httpx.Client(timeout=120.0) as client:
            resp = client.get(signed_url, follow_redirects=True)
            if resp.status_code != 200:
                logger.warning("[SEND_ATTACHMENT] GCS download failed: %d", resp.status_code)
                return {"status": "error", "message": "Failed to download file from storage.", "reason": "download_failed"}
            file_bytes = resp.content
            logger.info("[SEND_ATTACHMENT] Downloaded %d bytes", len(file_bytes))
    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Failed to download file")
        return {"status": "error", "message": f"Download failed: {e}", "reason": "download_failed"}

    # Step 3: Upload to Telegram
    telegram_base_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}"

    # Choose endpoint based on type
    if type == "video":
        endpoint = f"{telegram_base_url}/sendVideo"
        file_key = "video"
    elif type == "image":
        endpoint = f"{telegram_base_url}/sendPhoto"
        file_key = "photo"
    else:  # audio
        endpoint = f"{telegram_base_url}/sendDocument"
        file_key = "document"

    try:
        logger.info("[SEND_ATTACHMENT] Uploading to Telegram as %s", file_key)
        with httpx.Client(timeout=120.0) as client:
            files = {file_key: (asset_name, file_bytes, mime_type)}
            data = {"chat_id": telegram_chat_id}
            if caption:
                data["caption"] = caption[:1024]

            resp = client.post(endpoint, files=files, data=data)

            if resp.status_code == 200:
                result = resp.json().get("result", {})
                message_id = result.get("message_id")
                logger.info("[SEND_ATTACHMENT] Sent %s to %s, message_id=%s", asset_name, telegram_chat_id, message_id)
                return {"status": "success", "type": type, "asset_name": asset_name, "message": f"Sent {asset_name}."}
            else:
                error_text = resp.text[:200]
                logger.warning("[SEND_ATTACHMENT] Telegram upload failed: %d %s", resp.status_code, error_text)
                return {"status": "error", "message": f"Telegram rejected: {error_text[:80]}", "reason": "telegram_error"}

    except Exception as e:
        logger.exception("[SEND_ATTACHMENT] Failed to upload to Telegram")
        return {"status": "error", "message": f"Upload failed: {e}", "reason": "upload_failed"}
