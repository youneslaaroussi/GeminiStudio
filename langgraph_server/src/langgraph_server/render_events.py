from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.api_core.exceptions import NotFound
from google.cloud import pubsub_v1, storage
from google.cloud.pubsub_v1.subscriber.message import Message
from google.oauth2 import service_account
from langchain_core.messages import AIMessage, HumanMessage

from .agent import graph
from .config import Settings
from .firebase import fetch_chat_session, update_chat_session_messages, send_telegram_message, get_telegram_chat_id_for_user

logger = logging.getLogger(__name__)


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials specifically from the Google service account key."""
    key_path = settings.google_service_account_key
    if not key_path:
        return None

    path = Path(key_path).expanduser()
    if path.exists():
        return service_account.Credentials.from_service_account_file(str(path))

    try:
        key_data = json.loads(key_path)
        return service_account.Credentials.from_service_account_info(key_data)
    except json.JSONDecodeError:
        return None


def _generate_signed_download_url(gcs_uri: str, settings: Settings, expires_in_seconds: int = 604800) -> str | None:
    """Generate a signed download URL from a gs:// URI. Default expiry is 7 days."""
    if not gcs_uri.startswith("gs://"):
        return None

    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        return None

    bucket_name, object_name = parts
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_name)

        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expires_in_seconds),
            method="GET",
        )
        return url
    except Exception as e:
        logger.warning("Failed to generate signed download URL: %s", e)
        return None


class RenderEventSubscriber:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._subscriber: Optional[pubsub_v1.SubscriberClient] = None
        self._streaming_future: Optional[pubsub_v1.subscriber.futures.StreamingPullFuture] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    async def start(self) -> None:
        if self._streaming_future and not self._streaming_future.done():
            return

        subscription_name = self._settings.render_event_subscription
        project_id = self._settings.google_project_id

        self._subscriber = pubsub_v1.SubscriberClient()
        subscription_path = self._subscriber.subscription_path(project_id, subscription_name)
        self._loop = asyncio.get_running_loop()

        def callback(message: Message) -> None:
            assert self._loop is not None
            asyncio.run_coroutine_threadsafe(self._handle_message(message), self._loop)

        try:
            self._streaming_future = self._subscriber.subscribe(subscription_path, callback)
        except NotFound:
            logger.error(
                "Render event subscription '%s' not found in project '%s'.",
                subscription_name,
                project_id,
            )
            await self._cleanup()
            return

        logger.info(
            "Subscribed to render events on %s (topic: %s)",
            subscription_path,
            self._settings.render_event_topic,
        )

    async def stop(self) -> None:
        if self._streaming_future:
            self._streaming_future.cancel()
            try:
                self._streaming_future.result(timeout=5)
            except Exception:
                pass
            self._streaming_future = None
        await self._cleanup()

    async def _cleanup(self) -> None:
        if self._subscriber:
            await asyncio.to_thread(self._subscriber.close)
            self._subscriber = None

    async def _handle_message(self, message: Message) -> None:
        try:
            raw = message.data.decode("utf-8")
        except Exception:
            logger.warning("Received non-text render event payload; acking.")
            message.ack()
            return

        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Discarded malformed render event payload: %s", raw[:120])
            message.ack()
            return

        try:
            await self._dispatch_event(event)
            message.ack()
        except Exception:
            logger.exception("Failed to process render event; acking to avoid retry.")
            message.ack()

    async def _dispatch_event(self, event: Dict[str, Any]) -> None:
        event_type = event.get("type")
        job_id = event.get("jobId")
        metadata = event.get("metadata") or {}
        agent_meta = metadata.get("agent") or {}

        tags = metadata.get("tags") or []
        extra_meta = metadata.get("extra") or {}
        is_preview_job = "preview" in tags or extra_meta.get("previewMode")
        thread_id = agent_meta.get("threadId")
        if not thread_id:
            logger.debug("Skipping render event without thread context: job_id=%s", job_id)
            return
        if is_preview_job:
            logger.info(
                "Skipping render event for preview job (watchVideo/internal). job_id=%s",
                job_id,
            )
            return

        configurable: Dict[str, str] = {"thread_id": thread_id}
        project_id = agent_meta.get("projectId")
        user_id = agent_meta.get("userId")
        branch_id = agent_meta.get("branchId")
        if project_id:
            configurable["project_id"] = project_id
        if user_id:
            configurable["user_id"] = user_id
        if branch_id:
            configurable["branch_id"] = branch_id

        messages = self._build_messages(event_type, event)
        if not messages:
            return

        try:
            result = await graph.ainvoke({"messages": messages}, config={"configurable": configurable})
            logger.info("Dispatched render event to agent", extra={"job_id": job_id, "type": event_type})

            # Extract AI response and write to Firebase
            logger.info("user_id=%s, result keys=%s", user_id, list(result.keys()) if result else None)
            if user_id and result.get("messages"):
                ai_response = None
                for msg in reversed(result["messages"]):
                    logger.info("Checking message type: %s", type(msg).__name__)
                    if isinstance(msg, AIMessage):
                        content = msg.content
                        if isinstance(content, str):
                            ai_response = content
                        elif isinstance(content, list):
                            ai_response = "".join(
                                block.get("text", "") if isinstance(block, dict) else str(block)
                                for block in content
                            )
                        break

                logger.info("Extracted ai_response: %s", ai_response[:100] if ai_response else None)
                if ai_response:
                    # Fetch current messages and append
                    session = await asyncio.to_thread(fetch_chat_session, thread_id, self._settings)
                    current_messages = list(session.get("messages", [])) if session else []

                    new_message = {
                        "id": f"msg-{int(time.time() * 1000)}-render",
                        "role": "assistant",
                        "parts": [{"type": "text", "text": ai_response}],
                        "createdAt": datetime.utcnow().isoformat() + "Z",
                    }
                    # Embed video in chat when we have a signed download URL
                    if event_type == "render.completed":
                        result = event.get("result") or {}
                        gcs_path = result.get("gcsPath")
                        if gcs_path:
                            download_url = _generate_signed_download_url(
                                gcs_path, self._settings
                            )
                            if download_url:
                                extra_meta = metadata.get("extra") or {}
                                project_name = (extra_meta.get("projectName") or "Render")[:60]
                                new_message["metadata"] = {
                                    "attachments": [
                                        {
                                            "id": f"render-{int(time.time() * 1000)}",
                                            "name": f"Render: {project_name}",
                                            "mimeType": "video/mp4",
                                            "size": 0,
                                            "category": "video",
                                            "signedUrl": download_url,
                                            "uploadedAt": datetime.utcnow().isoformat() + "Z",
                                        }
                                    ]
                                }
                    current_messages.append(new_message)
                    
                    await asyncio.to_thread(
                        update_chat_session_messages,
                        user_id,
                        thread_id,
                        current_messages,
                        self._settings,
                    )
                    logger.info("Wrote render notification to Firebase for thread %s", thread_id)
                    
                    # Send to Telegram if this is a Telegram session
                    if thread_id.startswith("telegram-"):
                        telegram_chat_id = thread_id.replace("telegram-", "")
                        try:
                            await send_telegram_message(telegram_chat_id, ai_response, self._settings)
                            logger.info("Sent render notification to Telegram chat %s", telegram_chat_id)
                        except Exception as e:
                            logger.warning("Failed to send to Telegram: %s", e)
                    else:
                        # Check if user has Telegram linked for non-Telegram sessions
                        telegram_chat_id = await asyncio.to_thread(
                            get_telegram_chat_id_for_user, user_id, self._settings
                        )
                        if telegram_chat_id:
                            try:
                                await send_telegram_message(telegram_chat_id, ai_response, self._settings)
                                logger.info("Sent render notification to linked Telegram chat %s", telegram_chat_id)
                            except Exception as e:
                                logger.warning("Failed to send to Telegram: %s", e)
            else:
                logger.warning("Skipping Firebase write: user_id=%s, has_messages=%s", user_id, bool(result.get("messages")))

        except Exception:
            logger.exception("Failed to inject render event into agent flow", extra={"job_id": job_id})

    def _build_messages(self, event_type: str | None, event: Dict[str, Any]) -> List:
        job_id = event.get("jobId")
        metadata = event.get("metadata") or {}
        extra_meta = metadata.get("extra") or {}
        project_name = extra_meta.get("projectName")
        timestamp = event.get("timestamp")
        asset_id = event.get("assetId")

        if event_type == "render.completed":
            result = event.get("result") or {}
            gcs_path = result.get("gcsPath")
            output_path = result.get("outputPath")
            details = [
                f"Job ID: {job_id}",
                "Status: completed",
            ]
            if project_name:
                details.append(f"Project: {project_name}")

            # Generate signed download URL if we have a GCS path
            if gcs_path:
                download_url = _generate_signed_download_url(gcs_path, self._settings)
                if download_url:
                    details.append(f"Download URL: {download_url}")
                else:
                    details.append(f"GCS Path: {gcs_path}")
            elif output_path:
                details.append(f"Output path: {output_path}")

            # Include asset ID for agent iteration
            if asset_id:
                details.append(f"Asset ID: {asset_id}")
                details.append("You can use getAssetMetadata with this asset ID to review the rendered video and iterate if needed.")

            if timestamp:
                details.append(f"Completed at: {timestamp}")

            body = "Render job finished successfully:\n" + "\n".join(f"- {item}" for item in details)
        elif event_type == "render.failed":
            failed_reason = event.get("failedReason") or event.get("error") or "Renderer reported an unknown error."
            details = [
                f"Job ID: {job_id}",
                "Status: failed",
                f"Reason: {failed_reason}",
            ]
            if project_name:
                details.append(f"Project: {project_name}")
            if timestamp:
                details.append(f"Reported at: {timestamp}")

            body = "Render job failed:\n" + "\n".join(f"- {item}" for item in details)
        else:
            logger.debug("Ignoring unsupported render event type: %s", event_type)
            return []

        # Just inject the event as information - let the agent decide what to do
        # based on its system prompt and conversation context
        return [HumanMessage(content=body)]
