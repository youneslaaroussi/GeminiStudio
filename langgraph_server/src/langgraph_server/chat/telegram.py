from __future__ import annotations

import logging
import re
from typing import Callable, Iterable, Optional

import httpx

from ..config import Settings
from ..firebase import (
    lookup_email_by_phone,
    verify_telegram_link_code,
    get_user_by_telegram_chat_id,
    get_or_create_telegram_chat_session,
    fetch_user_projects,
    update_chat_session_messages,
    create_project,
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

    def _extract_link_code(self, text: str) -> str | None:
        """Extract a link code from /link command."""
        # Match /link followed by a 6-character alphanumeric code
        match = re.match(r"^/link\s+([A-Z0-9]{6})$", text.strip(), re.IGNORECASE)
        if match:
            return match.group(1).upper()
        return None

    async def parse_update(self, payload: dict) -> Iterable[IncomingMessage]:
        message = payload.get("message") or payload.get("edited_message")
        if not message:
            return []
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id"))
        text = message.get("text")

        # Check for document/photo/video/audio uploads
        document = message.get("document")
        photo = message.get("photo")
        video = message.get("video")
        audio = message.get("audio")
        voice = message.get("voice")
        video_note = message.get("video_note")

        file_info = None
        if document:
            file_info = {
                "type": "document",
                "file_id": document.get("file_id"),
                "file_name": document.get("file_name", "document"),
                "mime_type": document.get("mime_type", "application/octet-stream"),
                "file_size": document.get("file_size"),
            }
        elif photo:
            # Get the largest photo
            largest = max(photo, key=lambda p: p.get("file_size", 0))
            file_info = {
                "type": "photo",
                "file_id": largest.get("file_id"),
                "file_name": "photo.jpg",
                "mime_type": "image/jpeg",
                "file_size": largest.get("file_size"),
            }
        elif video:
            file_info = {
                "type": "video",
                "file_id": video.get("file_id"),
                "file_name": video.get("file_name", "video.mp4"),
                "mime_type": video.get("mime_type", "video/mp4"),
                "file_size": video.get("file_size"),
            }
        elif audio:
            file_info = {
                "type": "audio",
                "file_id": audio.get("file_id"),
                "file_name": audio.get("file_name", "audio.mp3"),
                "mime_type": audio.get("mime_type", "audio/mpeg"),
                "file_size": audio.get("file_size"),
            }
        elif voice:
            file_info = {
                "type": "voice",
                "file_id": voice.get("file_id"),
                "file_name": "voice.ogg",
                "mime_type": voice.get("mime_type", "audio/ogg"),
                "file_size": voice.get("file_size"),
            }
        elif video_note:
            file_info = {
                "type": "video_note",
                "file_id": video_note.get("file_id"),
                "file_name": "video_note.mp4",
                "mime_type": "video/mp4",
                "file_size": video_note.get("file_size"),
            }

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
        async with httpx.AsyncClient(base_url=f"{self.api_base_url}/bot{self.bot_token}") as client:
            for message in messages:
                payload = {
                    "chat_id": message.recipient_id,
                    "text": message.text,
                }
                response = await client.post("/sendMessage", json=payload, timeout=10.0)
                response.raise_for_status()

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
            # Caption is the user's message text (for media, Telegram sends it as caption)
            user_text = (caption or "").strip()
            if user_text.lower() == "/upload":
                # Explicit /upload command: current behavior — upload, show summary, stop
                return await self._handle_file_upload(user_info, chat_id, file_info, caption)
            # Default: upload silently, then feed media + text to agent (multimodal)
            return await self._upload_and_invoke_agent(user_info, chat_id, file_info, user_text or "")

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
        user_info = get_user_by_telegram_chat_id(chat_id, self.settings)
        if user_info:
            return (
                f"Welcome back, {user_info.get('userEmail')}!\n\n"
                "Your Telegram is linked to Gemini Studio. "
                "Send me a message to interact with your projects.\n\n"
                "Commands:\n"
                "/status - Check your account status\n"
                "/help - Show available commands"
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
        base_help = (
            "Gemini Studio Bot Commands:\n\n"
            "/start - Start the bot\n"
            "/status - Check your account status\n"
            "/help - Show this help message"
        )
        if user_info:
            return (
                base_help + "\n"
                "/project - List and select projects\n"
                "/newproject <name> - Create a new project\n"
                "/newchat - Start a fresh conversation\n\n"
                "Send any message to interact with your active project.\n"
                "Send photos/videos (with or without text): they're uploaded and sent to the agent.\n"
                "Use /upload as caption to only upload and get a summary (no agent)."
            )
        return (
            base_help + "\n"
            "/link <CODE> - Link your Gemini Studio account"
        )

    async def _do_upload(
        self, user_info: dict, chat_id: str, file_info: dict
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

                files = {"file": (file_name, file_content, mime_type)}
                data = {"source": "telegram", "run_pipeline": "true"}

                upload_response = await client.post(
                    f"{asset_service_url}/api/assets/{user_id}/{active_project_id}/upload",
                    files=files,
                    data=data,
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

    async def _handle_file_upload(self, user_info: dict, chat_id: str, file_info: dict, caption: str | None) -> str:
        """Upload-only path: upload asset, return summary message, do not invoke agent. Used for /upload command."""
        err, _content, _mime, result = await self._do_upload(user_info, chat_id, file_info)
        if err:
            return err
        asset = result.get("asset", {})
        file_name = file_info.get("file_name", "upload")
        asset_name = asset.get("name", file_name)
        asset_type = asset.get("type", "unknown")
        pipeline_started = result.get("pipelineStarted", False)
        response_lines = [f"Uploaded: {asset_name} ({asset_type})"]
        if asset.get("duration"):
            response_lines.append(f"Duration: {asset['duration']:.1f}s")
        if asset.get("width") and asset.get("height"):
            response_lines.append(f"Resolution: {asset['width']}x{asset['height']}")
        if pipeline_started:
            response_lines.append("Processing pipeline started.")
        if caption:
            response_lines.append(f"\nCaption: {caption}")
        return "\n".join(response_lines)

    async def _upload_and_invoke_agent(
        self, user_info: dict, chat_id: str, file_info: dict, user_text: str
    ) -> str:
        """Upload asset silently (no feedback), then feed media + text to the agent (multimodal)."""
        err, file_content, mime_type, _result = await self._do_upload(user_info, chat_id, file_info)
        if err:
            return err
        inline_media = [(file_content, mime_type)] if file_content and mime_type else None
        return await self._invoke_agent(user_info, chat_id, user_text, inline_media=inline_media)

    def _handle_newchat_command(self, user_info: dict, chat_id: str) -> str:
        """Handle /newchat command to start a fresh conversation."""
        user_id = user_info.get("userId")
        if not user_id:
            return "Error: Could not identify user."

        from ..firebase import get_firestore_client
        db = get_firestore_client(self.settings)

        session_id = f"telegram-{chat_id}"
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)

        # Clear messages but keep activeProjectId
        session_ref.update({"messages": []})

        return "Conversation cleared. Send a message to start fresh."

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

        # Set as active project
        from ..firebase import get_firestore_client
        db = get_firestore_client(self.settings)
        session_id = f"telegram-{chat_id}"
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)

        # Ensure session exists
        get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        session_ref.update({"activeProjectId": project["id"]})

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

            # Update session with active project
            from ..firebase import get_firestore_client
            db = get_firestore_client(self.settings)
            session_id = f"telegram-{chat_id}"
            session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)
            session_ref.update({"activeProjectId": proj_id})

            return f"Active project set to: {proj_name}"

        except ValueError:
            return "Usage: /project or /project <number>"

    async def _invoke_agent(
        self,
        user_info: dict,
        chat_id: str,
        text: str,
        *,
        inline_media: list[tuple[bytes, str]] | None = None,
    ) -> str:
        """Invoke the agent with the user's message and return the response.
        inline_media: optional list of (bytes, mime_type) for the current turn (multimodal).
        """
        import base64
        import time
        from datetime import datetime
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        from ..agent import graph

        user_id = user_info.get("userId")
        if not user_id:
            return "Error: Could not identify user."

        # Get or create chat session
        session = get_or_create_telegram_chat_session(user_id, chat_id, self.settings)
        session_id = session.get("id")

        # Get current messages
        current_messages = list(session.get("messages", []))

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
                    # Multimodal: text + image/video as data URLs for Gemini
                    parts: list = [{"type": "text", "text": text or "(no text)"}]
                    for data, mime in inline_media:
                        if mime.startswith("image/") or mime.startswith("video/"):
                            b64 = base64.b64encode(data).decode("utf-8")
                            parts.append(
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
                            )
                    langchain_messages.append(HumanMessage(content=parts))
                else:
                    langchain_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                langchain_messages.append(AIMessage(content=content))

        # Build project context
        project_context = None
        active_project_id = session.get("activeProjectId")
        selected_project = None

        try:
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
Resolution: {resolution.get('width', '?')}x{resolution.get('height', '?')} @ {project_data.get('fps', '?')}fps
Tracks: {len(layers)}
Assets: {len(assets_info)}"""
        except Exception as e:
            logger.warning(f"Could not fetch projects: {e}")

        if project_context:
            langchain_messages.insert(0, SystemMessage(content=f"[Project Context]\n{project_context}"))

        # Invoke agent
        config = {
            "configurable": {
                "thread_id": session_id,
                "user_id": user_id,
                "project_id": active_project_id,
            }
        }
        
        agent_context = {
            "thread_id": session_id,
            "user_id": user_id,
            "project_id": active_project_id,
        }
        
        logger.info("Invoking agent for Telegram: user_id=%s, project_id=%s, thread_id=%s", user_id, active_project_id, session_id)

        try:
            last_response = None
            for event in graph.stream({"messages": langchain_messages}, config=config, stream_mode="values", context=agent_context):
                messages = event.get("messages", [])
                if not messages:
                    continue

                last_msg = messages[-1]
                if isinstance(last_msg, AIMessage):
                    if not (hasattr(last_msg, 'tool_calls') and last_msg.tool_calls):
                        content = last_msg.content
                        if isinstance(content, str):
                            last_response = content
                        elif isinstance(content, list):
                            text_parts = []
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "text":
                                    text_parts.append(block.get("text", ""))
                            last_response = "\n".join(text_parts)

            if last_response:
                # Add assistant message to session
                assistant_message = {
                    "id": f"msg-{int(time.time() * 1000)}-assistant",
                    "role": "assistant",
                    "parts": [{"type": "text", "text": last_response}],
                    "createdAt": datetime.utcnow().isoformat() + "Z",
                }
                current_messages.append(assistant_message)
                update_chat_session_messages(user_id, session_id, current_messages, self.settings)

                return last_response

            return "I processed your message but have no response."

        except Exception as e:
            logger.exception("Agent invocation failed")
            return f"Error: {str(e)}"
