"""Veo video generation event poller and dispatcher.

This module polls pending Veo operations and dispatches completion events
to the agent conversation, similar to how RenderEventSubscriber handles
render completion events.

Jobs are persisted to Firestore for shared state between Python (LLM tool)
and Node.js (frontend polling via /api/veo).
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
from langchain_core.messages import AIMessage, HumanMessage

from .config import Settings
from .firebase import get_firestore_client
from .hmac_auth import get_asset_service_upload_headers

logger = logging.getLogger(__name__)

# Firestore collection name (must match Node.js veo-store.ts)
VEO_JOBS_COLLECTION = "veoJobs"

# In-memory store for pending operations (for polling loop)
_pending_operations: Dict[str, Dict[str, Any]] = {}
_lock = asyncio.Lock()


def _save_veo_job_to_firestore(
    job_id: str,
    operation_name: str,
    metadata: Dict[str, Any],
    settings: Settings,
) -> None:
    """Save a new Veo job to Firestore."""
    agent_meta = metadata.get("agent", {})
    extra_meta = metadata.get("extra", {})

    now = datetime.now(timezone.utc).isoformat()

    # Build params to match Node.js VeoJobParams structure
    params = {
        "prompt": extra_meta.get("prompt", ""),
        "durationSeconds": extra_meta.get("durationSeconds", 8),
        "aspectRatio": extra_meta.get("aspectRatio", "16:9"),
        "resolution": extra_meta.get("resolution", "720p"),
        "generateAudio": True,
        "projectId": agent_meta.get("projectId"),
        "userId": agent_meta.get("userId"),
    }

    job_doc = {
        "id": job_id,
        "status": "running",
        "params": params,
        "operationName": operation_name,
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        db = get_firestore_client(settings)
        db.collection(VEO_JOBS_COLLECTION).document(job_id).set(job_doc)
        logger.info("[VEO_EVENTS] Saved Veo job to Firestore: %s", job_id)
    except Exception as e:
        logger.exception("[VEO_EVENTS] Failed to save Veo job to Firestore: %s", e)


def _update_veo_job_in_firestore(
    job_id: str,
    updates: Dict[str, Any],
    settings: Settings,
) -> None:
    """Update a Veo job in Firestore."""
    updates["updatedAt"] = datetime.now(timezone.utc).isoformat()

    try:
        db = get_firestore_client(settings)
        db.collection(VEO_JOBS_COLLECTION).document(job_id).update(updates)
        logger.info("[VEO_EVENTS] Updated Veo job in Firestore: %s -> %s", job_id, updates.get("status", "?"))
    except Exception as e:
        logger.exception("[VEO_EVENTS] Failed to update Veo job in Firestore: %s", e)


def register_pending_operation(
    operation_name: str,
    metadata: Dict[str, Any],
    settings: Settings,
) -> None:
    """Register an operation to be polled for completion."""
    # Extract job ID from metadata (requestId from the tool)
    agent_meta = metadata.get("agent", {})
    job_id = agent_meta.get("requestId", operation_name[:32])

    # Save to Firestore for frontend visibility
    _save_veo_job_to_firestore(job_id, operation_name, metadata, settings)

    # Also keep in memory for polling loop
    _pending_operations[operation_name] = {
        "job_id": job_id,
        "metadata": metadata,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "poll_count": 0,
    }
    logger.info("[VEO_EVENTS] Registered pending operation: %s (job_id=%s)", operation_name, job_id)


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials from service account key."""
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


def _upload_to_asset_service(
    video_bytes: bytes,
    filename: str,
    user_id: str,
    project_id: str,
    settings: Settings,
) -> Dict[str, Any] | None:
    """Upload video to asset service and return asset data with signed URL."""
    if not settings.asset_service_url:
        logger.warning("[VEO_EVENTS] Asset service URL not configured")
        return None

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/upload"
    
    try:
        import httpx

        files = {"file": (filename, video_bytes, "video/mp4")}
        data = {"source": "veo", "run_pipeline": "true"}
        headers = get_asset_service_upload_headers(video_bytes)

        response = httpx.post(endpoint, files=files, data=data, headers=headers, timeout=120.0)
        
        if response.status_code not in (200, 201):
            logger.error("[VEO_EVENTS] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[VEO_EVENTS] Asset service did not return asset ID")
            return None

        logger.info("[VEO_EVENTS] Uploaded video to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
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
        job_id = op_data.get("job_id")
        
        thread_id = agent_meta.get("threadId")
        if not thread_id:
            logger.warning("[VEO_EVENTS] No thread_id for completed operation: %s", operation_name)
            return

        try:
            # Get the generated video
            response = operation.response
            if not response or not response.generated_videos:
                error_msg = "No video was generated"
                if job_id:
                    _update_veo_job_in_firestore(job_id, {"status": "error", "error": error_msg}, self._settings)
                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.failed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    error=error_msg,
                )
                return

            generated_video = response.generated_videos[0]
            video = generated_video.video

            # Download the video
            client = genai.Client(api_key=self._settings.google_api_key)
            client.files.download(file=video)

            video_bytes = video.video_bytes
            if not video_bytes:
                error_msg = "Failed to download generated video"
                if job_id:
                    _update_veo_job_in_firestore(job_id, {"status": "error", "error": error_msg}, self._settings)
                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.failed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    error=error_msg,
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
                # Prefer signedUrl for external clients (Telegram) - it's a full https:// URL
                download_url = asset_data.get("signedUrl")

                # Update Firestore with completion status
                if job_id:
                    _update_veo_job_in_firestore(job_id, {
                        "status": "completed",
                        "resultAssetId": asset_data.get("assetId"),
                        "resultAssetUrl": download_url,
                    }, self._settings)

                await self._dispatch_event(
                    thread_id=thread_id,
                    event_type="veo.completed",
                    agent_meta=agent_meta,
                    extra_meta=extra_meta,
                    gcs_uri=asset_data.get("gcsUri"),
                    download_url=download_url,
                    asset_id=asset_data.get("assetId"),
                )
            else:
                # Fallback to direct GCS upload
                gcs_object_name = f"veo/{user_id}/{project_id}/{request_id}.mp4"
                gcs_uri = _upload_video_to_gcs(video_bytes, gcs_object_name, self._settings)

                download_url = None
                if gcs_uri:
                    download_url = _generate_signed_download_url(gcs_uri, self._settings)

                # Update Firestore with completion status
                if job_id:
                    _update_veo_job_in_firestore(job_id, {
                        "status": "completed",
                        "resultAssetUrl": download_url,
                    }, self._settings)

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
            # Update Firestore with error status
            if job_id:
                _update_veo_job_in_firestore(job_id, {
                    "status": "error",
                    "error": str(exc),
                }, self._settings)
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
        job_id = op_data.get("job_id")
        error_msg = "Video generation timed out after 10 minutes"

        # Update Firestore with error status
        if job_id:
            _update_veo_job_in_firestore(job_id, {"status": "error", "error": error_msg}, self._settings)

        if thread_id:
            await self._dispatch_event(
                thread_id=thread_id,
                event_type="veo.failed",
                agent_meta=agent_meta,
                extra_meta=extra_meta,
                error=error_msg,
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
        job_id = op_data.get("job_id")
        error_msg = f"Failed to check video generation status: {error}"

        # Update Firestore with error status
        if job_id:
            _update_veo_job_in_firestore(job_id, {"status": "error", "error": error_msg}, self._settings)

        if thread_id:
            await self._dispatch_event(
                thread_id=thread_id,
                event_type="veo.failed",
                agent_meta=agent_meta,
                extra_meta=extra_meta,
                error=error_msg,
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
        branch_id = agent_meta.get("branchId")
        if project_id:
            configurable["project_id"] = project_id
        if user_id:
            configurable["user_id"] = user_id
        if branch_id:
            configurable["branch_id"] = branch_id

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
                        if download_url:
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

        # Just inject the event as information - let the agent decide what to do
        # based on its system prompt and conversation context
        return [HumanMessage(content=body)]
