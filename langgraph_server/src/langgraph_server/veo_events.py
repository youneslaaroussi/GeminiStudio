"""Veo video generation event poller and dispatcher.

This module polls pending Veo operations and dispatches completion events
to the agent conversation, similar to how RenderEventSubscriber handles
render completion events.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.oauth2 import service_account
from google.cloud import storage
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from .config import Settings

logger = logging.getLogger(__name__)

# In-memory store for pending operations
# In production, consider using Redis or Firestore for persistence
_pending_operations: Dict[str, Dict[str, Any]] = {}
_lock = asyncio.Lock()


def register_pending_operation(
    operation_name: str,
    metadata: Dict[str, Any],
    settings: Settings,
) -> None:
    """Register an operation to be polled for completion."""
    _pending_operations[operation_name] = {
        "metadata": metadata,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "poll_count": 0,
    }
    logger.info("[VEO_EVENTS] Registered pending operation: %s", operation_name)


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials from service account key."""
    key_path = settings.firebase_service_account_key
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


def _upload_to_asset_service(
    video_bytes: bytes,
    filename: str,
    user_id: str,
    project_id: str,
    settings: Settings,
) -> Dict[str, Any] | None:
    """Upload video to asset service and return asset data with proxy URL."""
    if not settings.asset_service_url:
        logger.warning("[VEO_EVENTS] Asset service URL not configured")
        return None

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/upload"
    
    try:
        import httpx
        
        files = {"file": (filename, video_bytes, "video/mp4")}
        data = {"source": "veo", "run_pipeline": "true"}
        
        response = httpx.post(endpoint, files=files, data=data, timeout=120.0)
        
        if response.status_code not in (200, 201):
            logger.error("[VEO_EVENTS] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[VEO_EVENTS] Asset service did not return asset ID")
            return None
        
        # Get filename from asset for proper extension in proxy URL
        asset_filename = asset.get("fileName", filename)
        
        # Build proxy URL for CORS-safe access (include filename for proper extension)
        proxy_url = f"/api/assets/{asset_id}/file/{asset_filename}?projectId={project_id}&userId={user_id}"
        
        logger.info("[VEO_EVENTS] Uploaded video to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
            "proxyUrl": proxy_url,
            "gcsUri": asset.get("gcsUri"),
            "signedUrl": asset.get("signedUrl"),
        }
    except Exception as e:
        logger.exception("[VEO_EVENTS] Failed to upload to asset service: %s", e)
        return None


def _upload_video_to_gcs(
    video_bytes: bytes,
    object_name: str,
    settings: Settings,
) -> str | None:
    """Upload video bytes to GCS and return the gs:// URI (fallback)."""
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        logger.warning("No GCS credentials available for video upload")
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(settings.google_cloud_storage_bucket)
        blob = bucket.blob(object_name)
        
        blob.upload_from_string(video_bytes, content_type="video/mp4")
        gcs_uri = f"gs://{settings.google_cloud_storage_bucket}/{object_name}"
        logger.info("[VEO_EVENTS] Uploaded video to %s", gcs_uri)
        return gcs_uri
    except Exception as e:
        logger.exception("[VEO_EVENTS] Failed to upload video to GCS: %s", e)
        return None


def _generate_signed_download_url(
    gcs_uri: str,
    settings: Settings,
    expires_in_seconds: int = 604800,
) -> str | None:
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
        logger.warning("[VEO_EVENTS] Failed to generate signed download URL: %s", e)
        return None


class VeoEventPoller:
    """Polls pending Veo operations and dispatches completion events to agent."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._poll_interval = 10  # seconds between polls
        self._max_poll_count = 60  # Max polls before giving up (~10 minutes)

    async def start(self) -> None:
        """Start the background polling task."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("[VEO_EVENTS] VeoEventPoller started")

    async def stop(self) -> None:
        """Stop the background polling task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("[VEO_EVENTS] VeoEventPoller stopped")

    async def _poll_loop(self) -> None:
        """Main polling loop."""
        while self._running:
            try:
                await self._poll_pending_operations()
            except Exception:
                logger.exception("[VEO_EVENTS] Error in poll loop")
            
            await asyncio.sleep(self._poll_interval)

    async def _poll_pending_operations(self) -> None:
        """Check all pending operations for completion."""
        if not _pending_operations:
            return

        # Get list of operations to check (copy to avoid mutation during iteration)
        async with _lock:
            operations_to_check = list(_pending_operations.items())

        from google import genai
        from google.genai import types
        
        client = genai.Client(api_key=self._settings.google_api_key)

        for operation_name, op_data in operations_to_check:
            try:
                # Reconstruct operation object from name
                operation = types.GenerateVideosOperation(name=operation_name)
                operation = client.operations.get(operation)
                
                op_data["poll_count"] = op_data.get("poll_count", 0) + 1
                
                if operation.done:
                    logger.info("[VEO_EVENTS] Operation completed: %s", operation_name)
                    await self._handle_completion(operation_name, operation, op_data)
                    async with _lock:
                        _pending_operations.pop(operation_name, None)
                elif op_data["poll_count"] >= self._max_poll_count:
                    logger.warning(
                        "[VEO_EVENTS] Operation timed out after %d polls: %s",
                        op_data["poll_count"],
                        operation_name,
                    )
                    await self._handle_timeout(operation_name, op_data)
                    async with _lock:
                        _pending_operations.pop(operation_name, None)
                else:
                    logger.debug(
                        "[VEO_EVENTS] Operation still pending (poll %d): %s",
                        op_data["poll_count"],
                        operation_name,
                    )
            except Exception as exc:
                logger.exception(
                    "[VEO_EVENTS] Error polling operation %s: %s",
                    operation_name,
                    exc,
                )
                # After too many errors, give up
                op_data["error_count"] = op_data.get("error_count", 0) + 1
                if op_data["error_count"] >= 5:
                    await self._handle_error(operation_name, op_data, str(exc))
                    async with _lock:
                        _pending_operations.pop(operation_name, None)

    async def _handle_completion(
        self,
        operation_name: str,
        operation: Any,
        op_data: Dict[str, Any],
    ) -> None:
        """Handle a completed Veo operation."""
        from google import genai
        
        metadata = op_data.get("metadata", {})
        agent_meta = metadata.get("agent", {})
        extra_meta = metadata.get("extra", {})
        
        thread_id = agent_meta.get("threadId")
        if not thread_id:
            logger.warning("[VEO_EVENTS] No thread_id for completed operation: %s", operation_name)
            return

        try:
            # Get the generated video
            response = operation.response
            if not response or not response.generated_videos:
                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.failed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    error="No video was generated",
                )
                return

            generated_video = response.generated_videos[0]
            video = generated_video.video
            
            # Download the video
            client = genai.Client(api_key=self._settings.google_api_key)
            client.files.download(file=video)
            
            video_bytes = video.video_bytes
            if not video_bytes:
                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.failed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    error="Failed to download generated video",
                )
                return

            # Upload to asset service (preferred) or fall back to GCS
            user_id = agent_meta.get("userId", "unknown")
            project_id = agent_meta.get("projectId", "unknown")
            request_id = agent_meta.get("requestId", operation_name[:16])
            prompt_slug = (extra_meta.get("prompt") or "veo")[:30].replace(" ", "-").lower()
            filename = f"veo-{prompt_slug}-{request_id[:8]}.mp4"
            
            asset_data = _upload_to_asset_service(
                video_bytes, filename, user_id, project_id, self._settings
            )
            
            if asset_data:
                # Use asset service proxy URL (CORS-safe)
                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.completed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    gcs_uri=asset_data.get("gcsUri"),
                    download_url=asset_data.get("proxyUrl"),
                    asset_id=asset_data.get("assetId"),
                )
            else:
                # Fallback to direct GCS upload
                gcs_object_name = f"veo/{user_id}/{project_id}/{request_id}.mp4"
                gcs_uri = _upload_video_to_gcs(video_bytes, gcs_object_name, self._settings)
                
                download_url = None
                if gcs_uri:
                    download_url = _generate_signed_download_url(gcs_uri, self._settings)

                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.completed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    gcs_uri=gcs_uri,
                    download_url=download_url,
                )

        except Exception as exc:
            logger.exception("[VEO_EVENTS] Error handling completion: %s", exc)
            await self._dispatch_event(
                thread_id=thread_id,
                event_type="veo.failed",
                agent_meta=agent_meta,
                extra_meta=extra_meta,
                error=str(exc),
            )

    async def _handle_timeout(
        self,
        operation_name: str,
        op_data: Dict[str, Any],
    ) -> None:
        """Handle a timed-out operation."""
        metadata = op_data.get("metadata", {})
        agent_meta = metadata.get("agent", {})
        extra_meta = metadata.get("extra", {})
        thread_id = agent_meta.get("threadId")

        if thread_id:
            await self._dispatch_event(
                thread_id=thread_id,
                event_type="veo.failed",
                agent_meta=agent_meta,
                extra_meta=extra_meta,
                error="Video generation timed out after 10 minutes",
            )

    async def _handle_error(
        self,
        operation_name: str,
        op_data: Dict[str, Any],
        error: str,
    ) -> None:
        """Handle repeated errors polling an operation."""
        metadata = op_data.get("metadata", {})
        agent_meta = metadata.get("agent", {})
        extra_meta = metadata.get("extra", {})
        thread_id = agent_meta.get("threadId")

        if thread_id:
            await self._dispatch_event(
                thread_id=thread_id,
                event_type="veo.failed",
                agent_meta=agent_meta,
                extra_meta=extra_meta,
                error=f"Failed to check video generation status: {error}",
            )

    async def _dispatch_event(
        self,
        thread_id: str,
        event_type: str,
        agent_meta: Dict[str, Any],
        extra_meta: Dict[str, Any],
        gcs_uri: str | None = None,
        download_url: str | None = None,
        asset_id: str | None = None,
        error: str | None = None,
    ) -> None:
        """Dispatch completion/failure event to the agent conversation."""
        from .agent import graph
        from .firebase import (
            fetch_chat_session,
            update_chat_session_messages,
            send_telegram_message,
            get_telegram_chat_id_for_user,
        )

        configurable: Dict[str, str] = {"thread_id": thread_id}
        project_id = agent_meta.get("projectId")
        user_id = agent_meta.get("userId")
        if project_id:
            configurable["project_id"] = project_id
        if user_id:
            configurable["user_id"] = user_id

        messages = self._build_messages(
            event_type=event_type,
            extra_meta=extra_meta,
            gcs_uri=gcs_uri,
            download_url=download_url,
            asset_id=asset_id,
            error=error,
        )
        if not messages:
            return

        try:
            result = await graph.ainvoke(
                {"messages": messages},
                config={"configurable": configurable},
            )
            logger.info(
                "[VEO_EVENTS] Dispatched %s event to agent for thread %s",
                event_type,
                thread_id,
            )

            # Extract AI response and write to Firebase
            if user_id and result.get("messages"):
                ai_response = None
                for msg in reversed(result["messages"]):
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

                if ai_response:
                    # Fetch current messages and append
                    session = await asyncio.to_thread(
                        fetch_chat_session, thread_id, self._settings
                    )
                    current_messages = list(session.get("messages", [])) if session else []

                    new_message = {
                        "id": f"msg-{int(time.time() * 1000)}-veo",
                        "role": "assistant",
                        "parts": [{"type": "text", "text": ai_response}],
                        "createdAt": datetime.utcnow().isoformat() + "Z",
                    }
                    # Embed video in chat when we have a download URL
                    if event_type == "veo.completed" and download_url:
                        prompt_label = (extra_meta.get("prompt") or "Veo video")[:80]
                        attachment = {
                            "id": asset_id or f"veo-{int(time.time() * 1000)}",
                            "name": f"Veo: {prompt_label}...",
                            "mimeType": "video/mp4",
                            "size": 0,
                            "category": "video",
                            "uploadedAt": datetime.utcnow().isoformat() + "Z",
                        }
                        # Use localUrl for proxy URLs (starts with /api/), signedUrl for GCS URLs
                        if download_url.startswith("/api/"):
                            attachment["localUrl"] = download_url
                        else:
                            attachment["signedUrl"] = download_url
                        new_message["metadata"] = {"attachments": [attachment]}
                    current_messages.append(new_message)

                    await asyncio.to_thread(
                        update_chat_session_messages,
                        user_id,
                        thread_id,
                        current_messages,
                        self._settings,
                    )
                    logger.info(
                        "[VEO_EVENTS] Wrote Veo notification to Firebase for thread %s",
                        thread_id,
                    )

                    # Send to Telegram if applicable
                    if thread_id.startswith("telegram-"):
                        telegram_chat_id = thread_id.replace("telegram-", "")
                        try:
                            await send_telegram_message(
                                telegram_chat_id, ai_response, self._settings
                            )
                            logger.info(
                                "[VEO_EVENTS] Sent Veo notification to Telegram chat %s",
                                telegram_chat_id,
                            )
                        except Exception as e:
                            logger.warning("[VEO_EVENTS] Failed to send to Telegram: %s", e)
                    else:
                        # Check if user has Telegram linked
                        telegram_chat_id = await asyncio.to_thread(
                            get_telegram_chat_id_for_user, user_id, self._settings
                        )
                        if telegram_chat_id:
                            try:
                                await send_telegram_message(
                                    telegram_chat_id, ai_response, self._settings
                                )
                                logger.info(
                                    "[VEO_EVENTS] Sent Veo notification to linked Telegram %s",
                                    telegram_chat_id,
                                )
                            except Exception as e:
                                logger.warning("[VEO_EVENTS] Failed to send to Telegram: %s", e)

        except Exception:
            logger.exception(
                "[VEO_EVENTS] Failed to inject Veo event into agent flow for thread %s",
                thread_id,
            )

    def _build_messages(
        self,
        event_type: str,
        extra_meta: Dict[str, Any],
        gcs_uri: str | None = None,
        download_url: str | None = None,
        asset_id: str | None = None,
        error: str | None = None,
    ) -> List:
        """Build messages for the agent based on event type."""
        prompt = extra_meta.get("prompt", "")
        aspect_ratio = extra_meta.get("aspectRatio", "16:9")
        resolution = extra_meta.get("resolution", "720p")
        duration = extra_meta.get("durationSeconds", 8)

        if event_type == "veo.completed":
            details = [
                "Status: completed",
                f"Prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Prompt: {prompt}",
                f"Settings: {resolution}, {aspect_ratio}, {duration}s",
            ]
            if asset_id:
                details.append(f"Asset ID: {asset_id}")
            if download_url:
                details.append(f"Video URL: {download_url}")
            elif gcs_uri:
                details.append(f"GCS Path: {gcs_uri}")

            body = "Veo video generation completed:\n" + "\n".join(f"- {item}" for item in details)

        elif event_type == "veo.failed":
            details = [
                "Status: failed",
                f"Reason: {error}",
                f"Prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Prompt: {prompt}",
            ]
            body = "Veo video generation failed:\n" + "\n".join(f"- {item}" for item in details)

        else:
            logger.debug("[VEO_EVENTS] Ignoring unsupported event type: %s", event_type)
            return []

        system_prompt = (
            "Veo video generation status update received. Craft a concise message for the user "
            "summarizing the outcome. If successful, include the download link and suggest they "
            "can add it to their project timeline. If failed, explain the issue briefly."
        )

        return [
            SystemMessage(content=system_prompt),
            HumanMessage(content=body),
        ]
