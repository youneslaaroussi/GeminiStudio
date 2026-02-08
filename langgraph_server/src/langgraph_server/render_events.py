from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from google.api_core.exceptions import NotFound
from google.cloud import pubsub_v1, storage
from google.cloud.pubsub_v1.subscriber.message import Message
from google.oauth2 import service_account

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
        self._processed_jobs: set[str] = set()

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
        # Ack immediately to prevent Pub/Sub redelivery.
        # The previous approach acked only after _dispatch_event completed,
        # but graph.ainvoke() could take 30+ seconds, exceeding the ack
        # deadline and causing the same message to be delivered (and processed)
        # multiple times.
        message.ack()

        try:
            raw = message.data.decode("utf-8")
        except Exception:
            logger.warning("Received non-text render event payload.")
            return

        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Discarded malformed render event payload: %s", raw[:120])
            return

        try:
            await self._dispatch_event(event)
        except Exception:
            logger.exception("Failed to process render event.")

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
                "Skipping render event for preview job (previewTimeline/internal). job_id=%s",
                job_id,
            )
            return

        # Deduplicate by job_id — even with immediate ack, Pub/Sub has
        # at-least-once delivery semantics so duplicates are possible.
        if job_id:
            if job_id in self._processed_jobs:
                logger.info("Skipping already-processed render event for job_id=%s", job_id)
                return
            self._processed_jobs.add(job_id)
            # Keep the set bounded
            if len(self._processed_jobs) > 1000:
                to_remove = list(self._processed_jobs)[:500]
                self._processed_jobs -= set(to_remove)

        project_id = agent_meta.get("projectId")
        user_id = agent_meta.get("userId")

        notification_text = self._build_notification_text(event_type, event)
        if not notification_text:
            return

        logger.info(
            "Processing render event: job_id=%s, type=%s, user_id=%s",
            job_id, event_type, user_id,
        )

        # Generate signed download URL for completed renders
        render_download_url: Optional[str] = None
        if event_type == "render.completed":
            ev_result = event.get("result") or {}
            gcs_path = ev_result.get("gcsPath")
            if gcs_path:
                render_download_url = _generate_signed_download_url(
                    gcs_path, self._settings
                )

        # ── Write notification to Firebase chat session ──────────────
        if user_id:
            try:
                session = await asyncio.to_thread(
                    fetch_chat_session, thread_id, self._settings
                )
                current_messages = list(session.get("messages", [])) if session else []

                new_message: Dict[str, Any] = {
                    "id": f"msg-{int(time.time() * 1000)}-render",
                    "role": "assistant",
                    "parts": [{"type": "text", "text": notification_text}],
                    "createdAt": datetime.utcnow().isoformat() + "Z",
                }
                # Embed video attachment in Firebase chat for the web UI
                if event_type == "render.completed" and render_download_url:
                    project_name = (extra_meta.get("projectName") or "Render")[:60]
                    new_message["metadata"] = {
                        "attachments": [
                            {
                                "id": f"render-{int(time.time() * 1000)}",
                                "name": f"Render: {project_name}",
                                "mimeType": "video/mp4",
                                "size": 0,
                                "category": "video",
                                "signedUrl": render_download_url,
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
            except Exception:
                logger.exception("Failed to write render notification to Firebase")

        # ── Send notification to Telegram ────────────────────────────
        telegram_chat_id = None
        if thread_id.startswith("telegram-"):
            telegram_chat_id = thread_id.replace("telegram-", "")
        elif user_id:
            telegram_chat_id = await asyncio.to_thread(
                get_telegram_chat_id_for_user, user_id, self._settings
            )

        if telegram_chat_id:
            try:
                if render_download_url:
                    # Send video so user gets the file directly
                    await send_telegram_message(
                        telegram_chat_id,
                        notification_text,
                        self._settings,
                        attachments=[
                            {
                                "url": render_download_url,
                                "type": "video",
                                "caption": notification_text,
                            },
                        ],
                    )
                else:
                    await send_telegram_message(
                        telegram_chat_id, notification_text, self._settings
                    )
                logger.info("Sent render notification to Telegram chat %s", telegram_chat_id)
            except Exception as e:
                logger.warning("Failed to send render notification to Telegram: %s", e)

    def _build_notification_text(
        self, event_type: str | None, event: Dict[str, Any]
    ) -> str | None:
        """Build a human-readable notification for the render event."""
        metadata = event.get("metadata") or {}
        extra_meta = metadata.get("extra") or {}
        project_name = extra_meta.get("projectName")

        if event_type == "render.completed":
            if project_name:
                return f"Your render for '{project_name}' is ready."
            return "Your render is ready."
        elif event_type == "render.failed":
            failed_reason = (
                event.get("failedReason")
                or event.get("error")
                or "Unknown error"
            )
            if project_name:
                return f"Render for '{project_name}' failed: {failed_reason}"
            return f"Render failed: {failed_reason}"
        else:
            logger.debug("Ignoring unsupported render event type: %s", event_type)
            return None
