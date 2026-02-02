from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from collections import deque
from typing import Callable, Iterable, Optional


import httpx

from ..config import Settings
from ..gemini_files import upload_file as upload_to_gemini
from ..firebase import (
    lookup_email_by_phone,
    verify_telegram_link_code,
    get_user_by_telegram_chat_id,
    get_or_create_telegram_chat_session,
    fetch_user_projects,
    update_chat_session_messages,
    create_project,
    send_telegram_message,
    save_message_feedback,
)
from ..phone import extract_phone_number
from .base import ChatProvider
from .types import IncomingMessage, OutgoingMessage

logger = logging.getLogger(__name__)


class TelegramProvider(ChatProvider):
    def __init__(
        self,
        settings: Settings,
        *,
        api_base_url: str | None = None,
        email_lookup: Callable[[str], Optional[str]] | None = None,
    ) -> None:
        super().__init__("telegram")
        self.settings = settings
        self.bot_token = settings.telegram_bot_token
        self.secret_token = settings.telegram_webhook_secret
        self.api_base_url = api_base_url or "https://api.telegram.org"
        self.email_lookup = email_lookup or (lambda phone: lookup_email_by_phone(phone, settings))
        if not self.bot_token:
            raise ValueError("Telegram bot token is not configured.")
        # Deduplication: Telegram retries webhooks if response is slow; skip already-processed update_ids
        self._processed_update_ids: set[int] = set()
        self._processed_update_ids_order: deque[int] = deque(maxlen=10_000)
        # Media-group (album) buffering: buffer updates, reset timer on each new item
        self._mg_buf: dict[tuple[str, str], list[dict]] = {}
        self._mg_events: dict[tuple[str, str], asyncio.Event] = {}
        self._mg_tasks: dict[tuple[str, str], asyncio.Task] = {}
        self._mg_lock = asyncio.Lock()
        # Per-chat agent run: cancel previous run when user sends another message
        self._agent_tasks: dict[str, asyncio.Task] = {}
        self._agent_lock = asyncio.Lock()

    async def send_typing_indicator(self, chat_id: str) -> None:
        """Send typing indicator to show the bot is processing."""
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{self.api_base_url}/bot{self.bot_token}/sendChatAction",
                    json={"chat_id": chat_id, "action": "typing"},
                    timeout=5.0,
                )
        except Exception as e:
            logger.debug("Failed to send typing indicator: %s", e)

    def _extract_link_code(self, text: str) -> str | None:
        """Extract a link code from /link command."""
        # Match /link followed by a 6-character alphanumeric code
        match = re.match(r"^/link\s+([A-Z0-9]{6})$", text.strip(), re.IGNORECASE)
        if match:
            return match.group(1).upper()
        return None

    def _parse_upload_command(self, caption: str | None) -> tuple[bool, str | None]:
        """
        Check if caption is /upload command and extract user caption if any.
        Returns (is_upload_command, effective_caption).
        - ("/upload") -> (True, None)  # generate random caption
        - ("/upload my cat") -> (True, "my cat")
        - ("hello") -> (False, None)
        """
        c = (caption or "").strip()
        lower = c.lower()
        if lower == "/upload":
            return (True, None)
        if lower.startswith("/upload "):
            rest = c[7:].strip()  # after "/upload "
            return (True, rest if rest else None)
        return (False, None)

    def _upload_filename(
        self,
        file_info: dict,
        effective_caption: str | None,
        batch_index: int | None = None,
    ) -> str:
        """Compute filename for upload: user caption (sanitized) + ext, or type-UUID + ext.
        batch_index: when uploading multiple assets (e.g. album), use caption-N to avoid duplicates.
        """
        raw = file_info.get("file_name", "upload")
        ext = ""
        if "." in raw:
            idx = raw.rfind(".")
            ext = raw[idx:]  # include dot
        if effective_caption is not None:
            sane = re.sub(r"[^\w\s\-\.]", "", effective_caption)
            sane = re.sub(r"\s+", "-", sane).strip("-") or "caption"
            sane = sane[:80]
            base = f"{sane}-{batch_index}" if batch_index is not None else sane
            return f"{base}{ext}" if ext else base
        # Generate: type-UUID
        t = file_info.get("type", "asset")
        uid = uuid.uuid4().hex[:12]
        return f"{t}-{uid}{ext}" if ext else f"{t}-{uid}"

    def _file_info_from_message(self, message: dict) -> dict | None:
        """Extract file_info dict from a Telegram message, or None if no file."""
        document = message.get("document")
        photo = message.get("photo")
        video = message.get("video")
        audio = message.get("audio")
        voice = message.get("voice")
        video_note = message.get("video_note")
        if document:
            return {
                "type": "document",
                "file_id": document.get("file_id"),
                "file_name": document.get("file_name", "document"),
                "mime_type": document.get("mime_type", "application/octet-stream"),
                "file_size": document.get("file_size"),
            }
        if photo:
            largest = max(photo, key=lambda p: p.get("file_size", 0))
            return {
                "type": "photo",
                "file_id": largest.get("file_id"),
                "file_name": "photo.jpg",
                "mime_type": "image/jpeg",
                "file_size": largest.get("file_size"),
            }
        if video:
            return {
                "type": "video",
                "file_id": video.get("file_id"),
                "file_name": video.get("file_name", "video.mp4"),
                "mime_type": video.get("mime_type", "video/mp4"),
                "file_size": video.get("file_size"),
            }
        if audio:
            return {
                "type": "audio",
                "file_id": audio.get("file_id"),
                "file_name": audio.get("file_name", "audio.mp3"),
                "mime_type": audio.get("mime_type", "audio/mpeg"),
                "file_size": audio.get("file_size"),
            }
        if voice:
            return {
                "type": "voice",
                "file_id": voice.get("file_id"),
                "file_name": "voice.ogg",
                "mime_type": voice.get("mime_type", "audio/ogg"),
                "file_size": voice.get("file_size"),
            }
        if video_note:
            return {
                "type": "video_note",
                "file_id": video_note.get("file_id"),
                "file_name": "video_note.mp4",
                "mime_type": "video/mp4",
                "file_size": video_note.get("file_size"),
            }
        return None

    def _parse_file_from_payload(self, payload: dict) -> tuple[dict, str | None, str] | None:
        """Extract (file_info, caption, chat_id) from a Telegram update, or None if no file."""
        message = payload.get("message") or payload.get("edited_message")
        if not message:
            return None
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id"))
        file_info = self._file_info_from_message(message)
        if not file_info:
            return None
        caption = message.get("caption")
        return (file_info, caption, chat_id)

    async def _buffer_media_group(self, payload: dict) -> bool:
        """If update is a media-group (album) file, append to buffer and schedule drain. Return True if buffered."""
        parsed = self._parse_file_from_payload(payload)
        if not parsed:
            logger.debug("[MG] _buffer_media_group: no file in payload")
            return False
        message = payload.get("message") or payload.get("edited_message")
        mgid = message.get("media_group_id") if message else None
        if not mgid:
            logger.debug("[MG] _buffer_media_group: no media_group_id, processing as single file")
            return False
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id"))
        key = (chat_id, mgid)
        async with self._mg_lock:
            self._mg_buf.setdefault(key, []).append(payload)
            buf_size = len(self._mg_buf[key])
            if key in self._mg_events:
                # Signal drain task to reset its timer
                self._mg_events[key].set()
                logger.info("[MG] Buffered item %d for media_group_id=%s, reset timer", buf_size, mgid)
            else:
                # First item: create event and start drain task
                event = asyncio.Event()
                self._mg_events[key] = event
                t = asyncio.create_task(self._drain_media_group(chat_id, mgid, event))
                self._mg_tasks[key] = t
                logger.info("[MG] First item for media_group_id=%s, started drain task", mgid)
        return True

    async def _drain_media_group(self, chat_id: str, media_group_id: str, reset_event: asyncio.Event) -> None:
        """Wait for silence (no new items for 1.5s), then process all buffered updates."""
        silence_timeout = 1.5  # seconds of no new items before processing
        max_wait = 10.0  # maximum total wait time
        start = time.monotonic()
        logger.info("[MG] Drain task started for media_group_id=%s", media_group_id)
        while (time.monotonic() - start) < max_wait:
            reset_event.clear()
            try:
                await asyncio.wait_for(reset_event.wait(), timeout=silence_timeout)
                logger.info("[MG] Drain timer reset for media_group_id=%s (new item arrived)", media_group_id)
            except asyncio.TimeoutError:
                logger.info("[MG] Silence timeout reached for media_group_id=%s, processing", media_group_id)
                break
        key = (chat_id, media_group_id)
        async with self._mg_lock:
            updates = self._mg_buf.pop(key, [])
            self._mg_tasks.pop(key, None)
            self._mg_events.pop(key, None)
        logger.info("[MG] Draining media_group_id=%s with %d updates", media_group_id, len(updates))
        if not updates:
            return
        updates.sort(key=lambda p: p.get("update_id", 0))
        items: list[tuple[dict, str | None, str]] = []
        for p in updates:
            x = self._parse_file_from_payload(p)
            if x:
                items.append(x)
        if not items:
            return
        caption = None
        for _fi, cap, _cid in items:
            s = (cap or "").strip()
            if s:
                caption = s
                break
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if not user_info:
            await self.dispatch_responses([
                OutgoingMessage(provider=self.name, recipient_id=chat_id, text="Link your account first with /link <CODE> before uploading files.")
            ])
            return
        await self.send_typing_indicator(chat_id)
        is_upload, effective_caption = self._parse_upload_command(caption)
        if is_upload:
            lines: list[str] = []
            ok = 0
            for i, (fi, _cap, _cid) in enumerate(items):
                idx = i + 1 if effective_caption is not None and len(items) > 1 else None
                custom = self._upload_filename(fi, effective_caption, batch_index=idx)
                err, _c, _m, res = await self._do_upload(user_info, chat_id, fi, custom_filename=custom)
                if err:
                    lines.append(f"• {fi.get('file_name', '?')}: {err}")
                    continue
                ok += 1
                a = (res or {}).get("asset", {})
                name = a.get("name", custom)
                typ = a.get("type", "unknown")
                line = f"• {name} ({typ})"
                if a.get("duration"):
                    line += f", {a['duration']:.1f}s"
                if res.get("pipelineStarted"):
                    line += " — processing"
                lines.append(line)
            if effective_caption is not None:
                lines.append(f"\nCaption: {effective_caption}")
            head = f"Uploaded {ok} of {len(items)} asset(s):" if ok < len(items) else f"Uploaded {len(items)} asset(s):"
            text = head + "\n" + "\n".join(lines)
            await self.dispatch_responses([OutgoingMessage(provider=self.name, recipient_id=chat_id, text=text)])
        else:
            # inline_media: list of (bytes, mime_type, upload_result_dict)
            inline_media: list[tuple[bytes, str, dict | None]] = []
            for fi, _cap, _cid in items:
                err, content, mime, res = await self._do_upload(user_info, chat_id, fi)
                if err:
                    await self.dispatch_responses([
                        OutgoingMessage(provider=self.name, recipient_id=chat_id, text=err)
                    ])
                    return
                if content and mime:
                    inline_media.append((content, mime, res))
            reply = await self._invoke_agent(user_info, chat_id, (caption or "").strip(), inline_media=inline_media or None)
            await self.dispatch_responses([OutgoingMessage(provider=self.name, recipient_id=chat_id, text=reply)])

    async def parse_update(self, payload: dict) -> Iterable[IncomingMessage]:
        message = payload.get("message") or payload.get("edited_message")
        if not message:
            return []
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id"))
        text = message.get("text")
        file_info = self._file_info_from_message(message)
        metadata = {
            "username": chat.get("username"),
            "first_name": chat.get("first_name"),
            "last_name": chat.get("last_name"),
            "file_info": file_info,
            "caption": message.get("caption"),
        }
        return [
            IncomingMessage(
                provider=self.name,
                sender_id=chat_id,
                text=text,
                metadata=metadata,
            )
        ]

    async def handle_update(self, payload: dict) -> Iterable[OutgoingMessage]:
        # Deduplicate: Telegram retries webhooks when response is slow; skip duplicate update_ids
        update_id = payload.get("update_id")
        if update_id is not None:
            if update_id in self._processed_update_ids:
                logger.info("[TELEGRAM] Skipping duplicate update_id=%s", update_id)
                return []
            # Evict oldest if at capacity (deque has maxlen; keep set in sync)
            if len(self._processed_update_ids_order) == self._processed_update_ids_order.maxlen:
                old = self._processed_update_ids_order[0]
                self._processed_update_ids.discard(old)
            self._processed_update_ids.add(update_id)
            self._processed_update_ids_order.append(update_id)

        # Check if this is a message_reaction update
        if payload.get("message_reaction"):
            await self.handle_reaction(payload)
            return []
        
        buffered = await self._buffer_media_group(payload)
        if buffered:
            logger.info("[MG] Update buffered for media group, returning early")
            return []
        messages = await self.parse_update(payload)
        responses: list[OutgoingMessage] = []
        for message in messages:
            response_text = await self._build_response(message)
            responses.append(
                OutgoingMessage(
                    provider=self.name,
                    recipient_id=message.sender_id,
                    text=response_text,
                )
            )
        await self.dispatch_responses(responses)
        return responses

    async def dispatch_responses(self, messages: Iterable[OutgoingMessage]) -> None:
        """Send responses via the centralized send_telegram_message (handles MarkdownV2 conversion)."""
        for message in messages:
            result = await send_telegram_message(
                message.recipient_id,
                message.text,
                self.settings,
            )
            if not result:
                logger.warning(f"Failed to send message to {message.recipient_id}")
            elif isinstance(result, dict) and result.get("message_id"):
                telegram_message_id = result["message_id"]
                message.metadata["telegram_message_id"] = telegram_message_id
                # Store telegram_message_id on the last assistant message in the session
                await self._link_telegram_message_id(message.recipient_id, telegram_message_id)

    async def _link_telegram_message_id(self, chat_id: str, telegram_message_id: int) -> None:
        """Link the telegram message_id to the last assistant message in the session."""
        try:
            user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
            if not user_info:
                return
            
            user_id = user_info.get("userId")
            if not user_id:
                return
            
            session_id = f"telegram-{chat_id}"
            
            from ..firebase import get_firestore_client
            db = get_firestore_client(self.settings)
            session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)
            session_doc = session_ref.get()
            
            if not session_doc.exists:
                return
            
            session_data = session_doc.to_dict()
            messages = session_data.get("messages", [])
            
            # Find the last assistant message and add telegramMessageId
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "assistant":
                    messages[i]["telegramMessageId"] = telegram_message_id
                    session_ref.update({"messages": messages})
                    logger.debug(f"[TELEGRAM] Linked telegram_message_id {telegram_message_id} to message {messages[i].get('id')}")
                    break
        except Exception as e:
            logger.warning(f"[TELEGRAM] Failed to link telegram_message_id: {e}")

    async def _build_response(self, message: IncomingMessage) -> str:
        text = (message.text or "").strip()
        chat_id = message.sender_id
        username = message.metadata.get("username") if message.metadata else None
        file_info = message.metadata.get("file_info") if message.metadata else None
        caption = message.metadata.get("caption") if message.metadata else None

        # Handle file uploads: /upload = upload-only with summary; else upload silently and feed to agent
        if file_info:
            user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
            if not user_info:
                return "Link your account first with /link <CODE> before uploading files."
            # Show typing indicator for file processing
            await self.send_typing_indicator(chat_id)
            # Caption is the user's message text (for media, Telegram sends it as caption)
            user_text = (caption or "").strip()
            is_upload, effective_caption = self._parse_upload_command(user_text or None)
            if is_upload:
                # /upload or /upload <caption>: upload-only, show summary, do not invoke agent
                return await self._handle_file_upload(
                    user_info, chat_id, file_info, effective_caption
                )
            # Default: upload silently, then feed media + text to agent (multimodal)
            return await self._upload_and_invoke_agent(
                user_info, chat_id, file_info, user_text or ""
            )

        if not text:
            return self._get_help_message(chat_id)

        # Handle /link command
        link_code = self._extract_link_code(text)
        if link_code:
            return self._handle_link_command(chat_id, username, link_code)

        # Handle /start command
        if text.startswith("/start"):
            return self._get_welcome_message(chat_id)

        # Handle /status command
        if text.startswith("/status"):
            return self._get_status_message(chat_id)

        # Handle /help command
        if text.startswith("/help"):
            return self._get_help_message(chat_id)

        # Handle /project command
        if text.startswith("/project"):
            user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
            if not user_info:
                return "Link your account first with /link <CODE>"
            return self._handle_project_command(user_info, chat_id, text)

        # Handle /newproject command
        if text.startswith("/newproject"):
            user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
            if not user_info:
                return "Link your account first with /link <CODE>"
            return self._handle_newproject_command(user_info, chat_id, text)

        # Handle /newchat command
        if text.startswith("/newchat"):
            user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
            if not user_info:
                return "Link your account first with /link <CODE>"
            return self._handle_newchat_command(user_info, chat_id)

        # Check if user is linked
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if not user_info:
            return (
                "Your Telegram account is not linked to Gemini Studio.\n\n"
                "To link your account:\n"
                "1. Go to Settings in Gemini Studio\n"
                "2. Click 'Link Telegram Account'\n"
                "3. Send me the code using: /link <CODE>"
            )

        # Show typing indicator before agent processing
        await self.send_typing_indicator(chat_id)

        # User is linked - invoke the agent
        return await self._invoke_agent(user_info, chat_id, text)

    def _handle_link_command(self, chat_id: str, username: str | None, code: str) -> str:
        """Handle the /link command to link a Telegram account."""
        # Check if already linked
        existing_user = get_user_by_telegram_chat_id(chat_id, self.settings)
        if existing_user:
            return (
                f"Your Telegram is already linked to {existing_user.get('userEmail')}.\n\n"
                "To link to a different account, first unlink in Gemini Studio Settings."
            )

        # Try to verify the code and create the link
        result = verify_telegram_link_code(code, chat_id, username, self.settings)
        if not result:
            return (
                "Invalid or expired link code.\n\n"
                "Please generate a new code in Gemini Studio Settings and try again."
            )

        return (
            f"Successfully linked to {result.get('userEmail')}!\n\n"
            "You can now interact with your Gemini Studio projects from Telegram."
        )

    def _get_welcome_message(self, chat_id: str) -> str:
        """Get welcome message for /start command."""
        feedback_note = "\n\n💡 Tip: React with an emoji to any bot message to give feedback!"
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if user_info:
            return (
                f"Welcome back, {user_info.get('userEmail')}!\n\n"
                "Your Telegram is linked to Gemini Studio. "
                "Send me a message to interact with your projects.\n\n"
                "Commands:\n"
                "/status - Check your account status\n"
                "/help - Show available commands"
                + feedback_note
            )
        return (
            "Welcome to Gemini Studio Bot!\n\n"
            "To get started, link your Gemini Studio account:\n"
            "1. Go to Settings in Gemini Studio\n"
            "2. Click 'Link Telegram Account'\n"
            "3. Send me the code using: /link <CODE>\n\n"
            "Commands:\n"
            "/link <CODE> - Link your account\n"
            "/status - Check your account status\n"
            "/help - Show available commands"
            + feedback_note
        )

    def _get_status_message(self, chat_id: str) -> str:
        """Get status message for /status command."""
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if user_info:
            return (
                "Account Status: Linked\n"
                f"Email: {user_info.get('userEmail')}\n"
                f"User ID: {user_info.get('userId')}"
            )
        return (
            "Account Status: Not Linked\n\n"
            "Link your account in Gemini Studio Settings."
        )

    def _get_help_message(self, chat_id: str) -> str:
        """Get help message listing available commands."""
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        feedback_note = "\n\n💡 Tip: React with an emoji to any bot message to give feedback!"
        base_help = (
            "Gemini Studio Bot Commands:\n\n"
            "/start - Start the bot\n"
            "/status - Check your account status\n"
            "/help - Show this help message"
        )
        if user_info:
            return (
                base_help + "\n\n"
                "/project - List and select projects\n"
                "/newproject <name> - Create a new project\n"
                "/newchat - Start a fresh conversation\n\n"
                "Send any message to interact with your active project.\n\n"
                "Send photos/videos/voice messages (with or without text): they're uploaded and sent to the agent.\n\n"
                "Use /upload or /upload <caption> as caption to only upload and get a summary (no agent)."
                + feedback_note
            )
        return (
            base_help + "\n\n"
            "/link <CODE> - Link your Gemini Studio account"
            + feedback_note
        )

    async def _wait_for_transcoded_file(
        self,
        user_id: str,
        project_id: str,
        asset_id: str,
        timeout: float = 120.0,
        poll_interval: float = 3.0,
        job_creation_timeout: float = 15.0,
    ) -> tuple[bytes | None, str | None]:
        """
        Wait for transcode to complete and fetch the transcoded file.
        
        Returns (file_bytes, mime_type) or (None, None) if failed/timeout.
        """
        from ..firebase import get_firestore_client
        
        db = get_firestore_client(self.settings)
        jobs_ref = (
            db.collection("users")
            .document(user_id)
            .collection("projects")
            .document(project_id)
            .collection("transcodeJobs")
        )
        
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            # Find the latest transcode job for this asset
            query = (
                jobs_ref.where("assetId", "==", asset_id)
                .order_by("createdAt", direction="DESCENDING")
                .limit(1)
            )
            docs = list(query.stream())
            
            if not docs:
                elapsed = time.time() - start_time
                # If no job found after job_creation_timeout, give up early
                if elapsed > job_creation_timeout:
                    logger.warning(
                        "[TELEGRAM] No transcode job found for asset %s after %.1fs, giving up",
                        asset_id,
                        elapsed,
                    )
                    return None, None
                logger.info("[TELEGRAM] Waiting for transcode job to appear for asset %s (%.1fs)", asset_id, elapsed)
                await asyncio.sleep(poll_interval)
                continue
            
            job_data = docs[0].to_dict()
            status = job_data.get("status", "pending")
            
            if status == "completed":
                # Get the transcoded file URL
                signed_url = job_data.get("outputSignedUrl")
                if not signed_url:
                    logger.error("[TELEGRAM] Transcode completed but no outputSignedUrl")
                    return None, None
                
                # Download the transcoded file
                logger.info("[TELEGRAM] Transcode completed, downloading transcoded file")
                try:
                    async with httpx.AsyncClient() as client:
                        response = await client.get(signed_url, timeout=120.0)
                        response.raise_for_status()
                        file_bytes = response.content
                        mime_type = response.headers.get("content-type", "video/mp4")
                        logger.info(
                            "[TELEGRAM] Downloaded transcoded file: %d bytes, %s",
                            len(file_bytes),
                            mime_type,
                        )
                        return file_bytes, mime_type
                except Exception as e:
                    logger.exception("[TELEGRAM] Failed to download transcoded file: %s", e)
                    return None, None
            
            elif status == "error":
                error_msg = job_data.get("error", "Unknown error")
                logger.error("[TELEGRAM] Transcode failed: %s", error_msg)
                return None, None
            
            else:
                # Still processing
                elapsed = time.time() - start_time
                logger.info(
                    "[TELEGRAM] Waiting for transcode (status=%s, elapsed=%.1fs)",
                    status,
                    elapsed,
                )
                await asyncio.sleep(poll_interval)
        
        logger.warning("[TELEGRAM] Transcode timeout after %.1fs", timeout)
        return None, None

    async def _do_upload(
        self,
        user_info: dict,
        chat_id: str,
        file_info: dict,
        custom_filename: str | None = None,
    ) -> tuple[str | None, bytes | None, str | None, dict | None]:
        """
        Download file from Telegram and upload to asset service.
        Returns (error_message, file_content, mime_type, upload_result).
        On success: error_message is None, file_content and mime_type are set, upload_result is the API response.
        On failure: error_message is set, others are None.
        """
        user_id = user_info.get("userId")
        if not user_id:
            return ("Error: Could not identify user.", None, None, None)

        session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        active_project_id = session.get("activeProjectId")

        if not active_project_id:
            projects = fetch_user_projects(user_id, self.settings)
            if not projects:
                return ("Create a project first using /newproject <name>", None, None, None)
            if len(projects) == 1:
                active_project_id = projects[0].get("id")
            else:
                return ("Select a project first with /project", None, None, None)

        file_id = file_info.get("file_id")
        file_name = file_info.get("file_name", "upload")
        mime_type = file_info.get("mime_type", "application/octet-stream")

        try:
            async with httpx.AsyncClient() as client:
                file_response = await client.get(
                    f"{self.api_base_url}/bot{self.bot_token}/getFile",
                    params={"file_id": file_id},
                    timeout=30.0,
                )
                file_response.raise_for_status()
                file_data = file_response.json()

                file_path = file_data.get("result", {}).get("file_path")
                if not file_path:
                    return ("Failed to get file from Telegram.", None, None, None)

                download_url = f"{self.api_base_url}/file/bot{self.bot_token}/{file_path}"
                file_content_response = await client.get(download_url, timeout=120.0)
                file_content_response.raise_for_status()
                file_content = file_content_response.content

                asset_service_url = self.settings.asset_service_url
                if not asset_service_url:
                    return ("Asset service is not configured.", None, None, None)

                upload_name = custom_filename or file_name
                files = {"file": (upload_name, file_content, mime_type)}
                # Include thread_id so pipeline can notify when done
                thread_id = f"telegram-{chat_id}"
                data: dict[str, str] = {
                    "source": "telegram",
                    "run_pipeline": "true",
                    "thread_id": thread_id,
                }

                is_video = mime_type.startswith("video/") or file_info.get("type") in ("video", "video_note")
                if is_video and self.settings.transcode_enabled:
                    import json
                    transcode_opts = {"preset": self.settings.transcode_preset}
                    data["transcodeOptions"] = json.dumps(transcode_opts)
                    logger.info(f"[TELEGRAM] Adding transcode options for video: {transcode_opts}")

                # Sign request for asset service authentication with file hash
                from ..hmac_auth import get_asset_service_upload_headers
                auth_headers = get_asset_service_upload_headers(file_content)
                
                upload_response = await client.post(
                    f"{asset_service_url}/api/assets/{user_id}/{active_project_id}/upload",
                    files=files,
                    data=data,
                    headers=auth_headers,
                    timeout=300.0,
                )
                upload_response.raise_for_status()
                result = upload_response.json()
                return (None, file_content, mime_type, result)

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error during upload: {e}")
            return (f"Upload failed: {e.response.status_code}", None, None, None)
        except Exception as e:
            logger.exception("Failed to handle file upload")
            return (f"Upload failed: {str(e)}", None, None, None)

    async def _handle_file_upload(
        self,
        user_info: dict,
        chat_id: str,
        file_info: dict,
        effective_caption: str | None,
    ) -> str:
        """
        Upload-only path: upload asset, return summary, do not invoke agent.
        effective_caption: None = generate type-UUID filename; str = use as asset name (sanitized).
        """
        custom_filename = self._upload_filename(file_info, effective_caption)
        err, _content, _mime, result = await self._do_upload(
            user_info, chat_id, file_info, custom_filename=custom_filename
        )
        if err:
            return err
        asset = result.get("asset", {})
        asset_name = asset.get("name", custom_filename)
        asset_type = asset.get("type", "unknown")
        pipeline_started = result.get("pipelineStarted", False)
        response_lines = [f"Uploaded: {asset_name} ({asset_type})"]
        if asset.get("duration"):
            response_lines.append(f"Duration: {asset['duration']:.1f}s")
        if asset.get("width") and asset.get("height"):
            response_lines.append(f"Resolution: {asset['width']}x{asset['height']}")
        if pipeline_started:
            response_lines.append("Processing pipeline started.")
        if effective_caption is not None:
            response_lines.append(f"\nCaption: {effective_caption}")
        return "\n".join(response_lines)

    async def _upload_and_invoke_agent(
        self, user_info: dict, chat_id: str, file_info: dict, user_text: str
    ) -> str:
        """Upload asset silently (no feedback), then feed media + text to the agent (multimodal)."""
        err, file_content, mime_type, result = await self._do_upload(user_info, chat_id, file_info)
        if err:
            return err
        inline_media = [(file_content, mime_type, result)] if file_content and mime_type else None
        return await self._invoke_agent(user_info, chat_id, user_text, inline_media=inline_media)

    def _handle_newchat_command(self, user_info: dict, chat_id: str) -> str:
        """Handle /newchat command to start a fresh conversation."""
        user_id = user_info.get("userId")
        if not user_id:
            return "Error: Could not identify user."

        from ..firebase import get_firestore_client
        from google.cloud.firestore import DELETE_FIELD
        db = get_firestore_client(self.settings)

        session_id = f"telegram-{chat_id}"
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)

        # Clear messages and branchId so a new branch is created on next message
        # Keep activeProjectId so user stays on the same project
        session_ref.update({
            "messages": [],
            "branchId": DELETE_FIELD,
        })

        return "Conversation cleared. A new branch will be created on your next message."

    def _handle_newproject_command(self, user_info: dict, chat_id: str, text: str) -> str:
        """Handle /newproject command to create a new project."""
        user_id = user_info.get("userId")
        if not user_id:
            return "Error: Could not identify user."

        # Parse: /newproject <name>
        parts = text.strip().split(maxsplit=1)
        if len(parts) < 2:
            return "Usage: /newproject <project name>"

        name = parts[1].strip()
        if not name:
            return "Please provide a project name."

        project = create_project(user_id, name, self.settings)

        # Set as active project and clear branchId (branch is project-specific)
        from ..firebase import get_firestore_client
        from google.cloud.firestore import DELETE_FIELD
        db = get_firestore_client(self.settings)
        session_id = f"telegram-{chat_id}"
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)

        # Ensure session exists
        get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        # Clear branchId and messages since we're switching to a new project
        session_ref.update({
            "activeProjectId": project["id"],
            "branchId": DELETE_FIELD,
            "messages": [],
        })

        return f"Created project: {name}\nIt's now your active project."

    def _handle_project_command(self, user_info: dict, chat_id: str, text: str) -> str:
        """Handle /project command to list or select projects."""
        user_id = user_info.get("userId")
        if not user_id:
            return "Error: Could not identify user."

        projects = fetch_user_projects(user_id, self.settings)
        if not projects:
            return "You don't have any projects yet. Create one in Gemini Studio first."

        # Parse command: /project or /project <number>
        parts = text.strip().split()
        if len(parts) == 1:
            # List projects
            session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
            active_id = session.get("activeProjectId")

            lines = ["Your projects:\n"]
            for i, proj in enumerate(projects, 1):
                name = proj.get("name", "Untitled")
                proj_id = proj.get("id", "")
                marker = " (active)" if proj_id == active_id else ""
                lines.append(f"{i}. {name}{marker}")

            lines.append("\nUse /project <number> to select one.")
            return "\n".join(lines)

        # Select project by number
        try:
            num = int(parts[1])
            if num < 1 or num > len(projects):
                return f"Invalid number. Choose 1-{len(projects)}."

            selected = projects[num - 1]
            proj_id = selected.get("id")
            proj_name = selected.get("name", "Untitled")

            # Check if we're switching to a different project
            session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
            current_project = session.get("activeProjectId")

            # Update session with active project
            from ..firebase import get_firestore_client
            from google.cloud.firestore import DELETE_FIELD
            db = get_firestore_client(self.settings)
            session_id = f"telegram-{chat_id}"
            session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)

            if current_project != proj_id:
                # Switching projects - clear branchId and messages (branch is project-specific)
                session_ref.update({
                    "activeProjectId": proj_id,
                    "branchId": DELETE_FIELD,
                    "messages": [],
                })
                return f"Active project set to: {proj_name}\nConversation cleared for new project."
            else:
                return f"Already on project: {proj_name}"

        except ValueError:
            return "Usage: /project or /project <number>"

    async def _invoke_agent(
        self,
        user_info: dict,
        chat_id: str,
        text: str,
        *,
        inline_media: list[tuple[bytes, str, dict | None]] | None = None,
    ) -> str:
        """Invoke the agent with the user's message and return the response.
        inline_media: optional list of (bytes, mime_type, asset_result) for the current turn (multimodal).
        """
        import base64
        import time
        from datetime import datetime
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        from ..agent import graph
        from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError

        user_id = user_info.get("userId")
        if not user_id:
            logger.error("[TELEGRAM] No user_id in user_info")
            return "Error: Could not identify user."

        logger.info("[TELEGRAM] === New message from user %s ===", user_id)
        logger.info("[TELEGRAM] Chat ID: %s", chat_id)
        logger.info("[TELEGRAM] Message: %s", text[:200] if text else "(empty)")

        cost = get_credits_for_action("chat")
        try:
            deduct_credits(user_id, cost, "chat", self.settings)
        except InsufficientCreditsError as e:
            logger.warning("[TELEGRAM] Insufficient credits for user %s", user_id)
            return (
                f"Insufficient credits. You need {e.required} R‑Credits for this message. "
                "Add credits in Gemini Studio Settings to continue."
            )

        # Get or create chat session
        session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        session_id = session.get("id")
        logger.info("[TELEGRAM] Session ID: %s", session_id)

        # Get current messages
        current_messages = list(session.get("messages", []))
        logger.info("[TELEGRAM] Existing messages in session: %d", len(current_messages))
        
        # Track message count for feedback reminders
        bot_message_count = session.get("botMessageCount", 0)

        # Add user message to session
        user_message = {
            "id": f"msg-{int(time.time() * 1000)}-user",
            "role": "user",
            "parts": [{"type": "text", "text": text}],
            "createdAt": datetime.utcnow().isoformat() + "Z",
        }
        current_messages.append(user_message)

        # Update Firebase with user message
        update_chat_session_messages(user_id, session_id, current_messages, self.settings)

        # Get active project from session (needed for transcode lookup)
        session_project_id = session.get("activeProjectId")

        # Convert to LangChain messages (last user message may have inline_media for multimodal)
        langchain_messages = []
        for i, msg in enumerate(current_messages):
            role = msg.get("role", "user")
            text_parts = []
            for part in msg.get("parts", []):
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
            content = "\n".join(text_parts) if text_parts else ""

            if role == "user":
                is_last_user = i == len(current_messages) - 1
                if is_last_user and inline_media:
                    # Multimodal: upload media to Gemini File API and reference by URI
                    parts: list = [{"type": "text", "text": text or "(no text)"}]
                    for data, mime, asset_result in inline_media:
                        if mime.startswith("image/") or mime.startswith("video/") or mime.startswith("audio/"):
                            try:
                                file_bytes = data
                                file_mime = mime
                                
                                # For videos with transcode, wait for and use transcoded file
                                # Skip waiting for MP4 - it's already in a compatible format for Gemini
                                is_video = mime.startswith("video/")
                                is_mp4 = mime == "video/mp4"
                                transcode_started = asset_result and asset_result.get("transcodeStarted", False)
                                
                                if is_video and transcode_started and not is_mp4:
                                    asset_data = asset_result.get("asset", {})
                                    asset_id = asset_data.get("id")
                                    if asset_id:
                                        logger.info(
                                            "[TELEGRAM] Video transcode started, waiting for transcoded file (asset_id=%s)",
                                            asset_id,
                                        )
                                        transcoded_bytes, transcoded_mime = await self._wait_for_transcoded_file(
                                            user_id=user_id,
                                            project_id=session_project_id,
                                            asset_id=asset_id,
                                            timeout=180.0,  # 3 minutes for transcode
                                        )
                                        if transcoded_bytes and transcoded_mime:
                                            logger.info(
                                                "[TELEGRAM] Using transcoded file: %d bytes, %s",
                                                len(transcoded_bytes),
                                                transcoded_mime,
                                            )
                                            file_bytes = transcoded_bytes
                                            file_mime = transcoded_mime
                                        else:
                                            logger.warning("[TELEGRAM] Transcode failed, cannot process video")
                                            parts.append({
                                                "type": "text",
                                                "text": "\n[Note: Video transcoding failed. Please try again or upload a different format.]",
                                            })
                                            continue
                                elif is_mp4 and transcode_started:
                                    logger.info(
                                        "[TELEGRAM] Skipping transcode wait for MP4 file, using original"
                                    )
                                
                                # Upload to Gemini File API
                                logger.info("[TELEGRAM] Uploading media to Gemini File API (%d bytes, %s)", len(file_bytes), file_mime)
                                uploaded = await upload_to_gemini(
                                    file_bytes,
                                    file_mime,
                                    display_name=f"telegram-{chat_id}-{int(time.time())}",
                                    settings=self.settings,
                                )
                                logger.info("[TELEGRAM] Uploaded to Gemini: %s", uploaded.uri)
                                parts.append({
                                    "type": "file",
                                    "file_id": uploaded.uri,
                                    "mime_type": file_mime,
                                })
                            except Exception as e:
                                logger.exception("[TELEGRAM] Failed to upload media to Gemini File API: %s", e)
                                parts.append({
                                    "type": "text",
                                    "text": f"\n[Note: A {mime} file was attached but could not be processed. Error: {e}]",
                                })
                    langchain_messages.append(HumanMessage(content=parts))
                else:
                    langchain_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                langchain_messages.append(AIMessage(content=content))

        # Build project context
        project_context = None
        active_project_id = session.get("activeProjectId")
        branch_id = session.get("branchId")
        selected_project = None

        try:
            # First fetch without branch to find projects
            projects = fetch_user_projects(user_id, self.settings)
            if projects:
                # Use active project if set, otherwise prompt user
                if active_project_id:
                    selected_project = next((p for p in projects if p.get("id") == active_project_id), None)

                if not selected_project:
                    # No active project set - prompt user
                    if len(projects) == 1:
                        selected_project = projects[0]
                        active_project_id = selected_project.get("id")
                    else:
                        return "You have multiple projects. Use /project to select one first."

                # Create branch for this Telegram session if not exists
                if not branch_id and active_project_id:
                    try:
                        from ..firebase import create_branch_for_chat, update_chat_session_branch, get_firestore_client
                        branch_id = create_branch_for_chat(user_id, active_project_id, session_id, self.settings)
                        # Update session with branchId
                        db = get_firestore_client(self.settings)
                        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)
                        session_ref.update({"branchId": branch_id})
                        logger.info("[TELEGRAM] Created branch %s for session %s", branch_id, session_id)
                    except Exception as e:
                        logger.warning("[TELEGRAM] Could not create branch: %s, using main", e)
                        branch_id = "main"

                # Re-fetch project with branch to get branch-specific data
                if branch_id and active_project_id:
                    projects = fetch_user_projects(user_id, self.settings, branch_id=branch_id, project_id=active_project_id)
                    if projects:
                        selected_project = projects[0]

                logger.info("[TELEGRAM] Using branch: %s for project: %s", branch_id, active_project_id)

                project_data = selected_project.get("_projectData", {})

                if project_data:
                    layers = project_data.get("layers", [])
                    resolution = project_data.get("resolution", {})

                    assets_info = []
                    for layer in layers:
                        for clip in layer.get("clips", []):
                            asset_name = clip.get('name', 'Untitled')
                            asset_type = clip.get('type', 'unknown')
                            duration = clip.get('duration', 0)
                            assets_info.append(f"- {asset_name} ({asset_type}, {duration}s)")

                    project_context = f"""Current Project: {selected_project.get('name', 'Untitled')}
Project ID: {active_project_id}
Branch: {branch_id or 'main'}
Resolution: {resolution.get('width', '?')}x{resolution.get('height', '?')} @ {project_data.get('fps', '?')}fps
Tracks: {len(layers)}
Assets: {len(assets_info)}"""
        except Exception as e:
            logger.warning(f"Could not fetch projects: {e}")

        if project_context:
            langchain_messages.insert(0, SystemMessage(content=f"[Project Context]\n{project_context}"))
            logger.info("[TELEGRAM] Project context: %s", project_context[:200])

        # Invoke agent
        config = {
            "configurable": {
                "thread_id": session_id,
                "user_id": user_id,
                "project_id": active_project_id,
                "branch_id": branch_id,
            }
        }
        
        agent_context = {
            "thread_id": session_id,
            "user_id": user_id,
            "project_id": active_project_id,
            "branch_id": branch_id,
        }
        
        logger.info("[TELEGRAM] === Invoking agent ===")
        logger.info("[TELEGRAM] user_id=%s, project_id=%s, branch_id=%s, thread_id=%s", user_id, active_project_id, branch_id, session_id)
        logger.info("[TELEGRAM] Total messages to agent: %d", len(langchain_messages))

        # Show typing indicator and send first status so user sees progress (fire-and-forget so agent starts immediately)
        await self.send_typing_indicator(chat_id)

        async def _send_thinking_status() -> None:
            try:
                from ..status_generator import generate_status_message
                msg = await generate_status_message("thinking", for_telegram=True, settings=self.settings)
                if msg:
                    await send_telegram_message(chat_id, msg, self.settings, italic=True)
            except Exception as e:
                logger.debug("Failed to send Thinking status to Telegram: %s", e)

        asyncio.create_task(_send_thinking_status())

        async def run_agent() -> str:
            nonlocal bot_message_count
            try:
                last_response = None
                tool_calls_made = []
                from langchain_core.messages import ToolMessage

                async for event in graph.astream({"messages": langchain_messages}, config=config, stream_mode="values", context=agent_context):
                    messages = event.get("messages", [])
                    if not messages:
                        continue
                    last_msg = messages[-1]
                    if isinstance(last_msg, ToolMessage):
                        logger.info("[TELEGRAM] Tool result for %s: %s", last_msg.name if hasattr(last_msg, 'name') else 'unknown', str(last_msg.content)[:500])
                    if isinstance(last_msg, AIMessage):
                        if hasattr(last_msg, 'tool_calls') and last_msg.tool_calls:
                            for tc in last_msg.tool_calls:
                                tool_name = tc.get("name", "unknown")
                                tool_args = tc.get("args", {})
                                logger.info("[TELEGRAM] Tool call: %s(%s)", tool_name, str(tool_args)[:200])
                                tool_calls_made.append(tool_name)
                                async def _send_tool_status() -> None:
                                    try:
                                        from ..status_generator import generate_status_message
                                        msg = await generate_status_message("tool", tool_name=tool_name, for_telegram=True, settings=self.settings)
                                        if msg:
                                            await send_telegram_message(chat_id, msg, self.settings, italic=True)
                                    except Exception as e:
                                        logger.debug("Failed to send tool status to Telegram: %s", e)
                                asyncio.create_task(_send_tool_status())
                        else:
                            content = last_msg.content
                            if isinstance(content, str):
                                last_response = content
                            elif isinstance(content, list):
                                text_parts = []
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        text_parts.append(block.get("text", ""))
                                last_response = "\n".join(text_parts)

                logger.info("[TELEGRAM] Tool calls made: %s", tool_calls_made if tool_calls_made else "none")
                logger.info("[TELEGRAM] Response length: %d chars", len(last_response) if last_response else 0)
                if last_response:
                    logger.info("[TELEGRAM] Response preview: %s", last_response[:300])

                if last_response:
                    assistant_message = {
                        "id": f"msg-{int(time.time() * 1000)}-assistant",
                        "role": "assistant",
                        "parts": [{"type": "text", "text": last_response}],
                        "createdAt": datetime.utcnow().isoformat() + "Z",
                    }
                    current_messages.append(assistant_message)
                    update_chat_session_messages(user_id, session_id, current_messages, self.settings)
                    bot_message_count += 1
                    from ..firebase import get_firestore_client
                    db = get_firestore_client(self.settings)
                    session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)
                    session_ref.update({"botMessageCount": bot_message_count})
                    FEEDBACK_REMINDER_INTERVAL = 10
                    if bot_message_count == 1 or bot_message_count % FEEDBACK_REMINDER_INTERVAL == 0:
                        reminder = "\n\n💡 React with an emoji to give feedback on this response!"
                        return last_response + reminder
                    return last_response

                logger.warning("[TELEGRAM] No response from agent")
                return "I processed your message but have no response."
            except asyncio.CancelledError:
                logger.info("[TELEGRAM] Agent run cancelled for chat_id=%s", chat_id)
                raise
            except Exception as e:
                logger.exception("[TELEGRAM] Agent invocation failed: %s", str(e))
                return f"Error: {str(e)}"

        async with self._agent_lock:
            if chat_id in self._agent_tasks:
                old_task = self._agent_tasks[chat_id]
                old_task.cancel()
                try:
                    await old_task
                except asyncio.CancelledError:
                    pass
            task = asyncio.create_task(run_agent())
            self._agent_tasks[chat_id] = task

        try:
            return await task
        except asyncio.CancelledError:
            return "Run cancelled (new message sent)."
        finally:
            async with self._agent_lock:
                if self._agent_tasks.get(chat_id) is task:
                    del self._agent_tasks[chat_id]

    async def handle_reaction(self, payload: dict) -> None:
        """Handle emoji reactions to bot messages."""
        import httpx
        
        message_reaction = payload.get("message_reaction")
        if not message_reaction:
            return
        
        chat = message_reaction.get("chat", {})
        chat_id = str(chat.get("id"))
        message_id = message_reaction.get("message_id")
        new_reaction = message_reaction.get("new_reaction", [])
        
        if not message_id:
            return
        
        # Get user info first
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if not user_info:
            logger.debug(f"[TELEGRAM] Reaction from unlinked user {chat_id}, ignoring")
            return
        
        user_id = user_info.get("userId")
        if not user_id:
            return
        
        # Verify the message is from the bot by fetching it
        # For private chats, we can be more lenient, but let's verify for accuracy
        try:
            async with httpx.AsyncClient() as client:
                # Get bot info
                bot_info_response = await client.get(
                    f"{self.api_base_url}/bot{self.bot_token}/getMe",
                    timeout=5.0,
                )
                if bot_info_response.status_code != 200:
                    logger.warning("[TELEGRAM] Failed to get bot info for reaction check")
                    return
                
                bot_info = bot_info_response.json().get("result", {})
                bot_id = bot_info.get("id")
                
                # Try to get chat member info to determine chat type
                # For private chats, reactions are likely to bot messages
                # For groups/channels, we'd need to track sent message IDs
                chat_type = chat.get("type", "")
                is_private = chat_type == "private"
                
                # For private chats, assume reactions are to bot messages
                # For groups, we could track message IDs, but for now we'll save all reactions
                # and filter in analytics if needed
                if not is_private:
                    logger.debug(f"[TELEGRAM] Reaction in {chat_type} chat, saving feedback")
                
        except Exception as e:
            logger.warning(f"[TELEGRAM] Error checking bot message for reaction: {e}")
            # Continue - we'll save the feedback anyway
        
        # Get session for context
        session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        session_id = session.get("id")
        
        # Process new reactions (user added emojis)
        for reaction_obj in new_reaction:
            if isinstance(reaction_obj, dict):
                emoji = reaction_obj.get("emoji")
                if emoji:
                    save_message_feedback(
                        user_id=user_id,
                        provider=self.name,
                        message_id=str(message_id),
                        reaction=emoji,
                        session_id=session_id,
                        settings=self.settings,
                    )
                    logger.info(f"[TELEGRAM] Saved feedback: user={user_id}, reaction={emoji}, message={message_id}")
        
        # Note: We could also track old_reaction removals, but for feedback purposes,
        # we mainly care about positive reactions (emojis added)
