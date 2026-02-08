"""Tool to render a preview of the timeline and return it for the agent to view.

This triggers a fast low-res render, waits for completion, and returns the video
as multimodal content so the agent can analyze it with full conversation context.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

import httpx
from google.cloud import storage
from google.oauth2 import service_account
from langchain_core.tools import tool

from ..config import Settings, get_settings
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError
from ..gemini_files import upload_file_sync

logger = logging.getLogger(__name__)

# Preview render settings
PREVIEW_FPS = 10
PREVIEW_RESOLUTION_SCALE = 0.33  # 1080p -> ~360p
PREVIEW_QUALITY = "low"

# Polling settings
POLL_INTERVAL_SECONDS = 2
MAX_POLL_TIME_SECONDS = 300  # 5 minutes max


def _sign_renderer_request(body: str, timestamp: int, secret: str) -> str:
    """Sign a renderer request body with HMAC-SHA256."""
    payload = f"{timestamp}.{body}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


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


def _generate_signed_upload_url(
    object_name: str,
    content_type: str,
    settings: Settings,
    expires_in_seconds: int = 3600,
) -> str | None:
    """Generate a signed URL for uploading to GCS."""
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(settings.google_cloud_storage_bucket)
        blob = bucket.blob(object_name)

        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expires_in_seconds),
            method="PUT",
            content_type=content_type,
        )
        return url
    except Exception as e:
        logger.warning("Failed to generate signed upload URL: %s", e)
        return None


def _generate_signed_download_url(
    object_name: str,
    settings: Settings,
    expires_in_seconds: int = 3600,
) -> str | None:
    """Generate a signed URL for downloading from GCS."""
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(settings.google_cloud_storage_bucket)
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


def _poll_job_status(job_id: str, settings: Settings) -> dict[str, Any]:
    """Poll the renderer for job status until complete or timeout."""
    endpoint = f"{settings.renderer_base_url.rstrip('/')}/jobs/{job_id}"
    start_time = time.time()

    while time.time() - start_time < MAX_POLL_TIME_SECONDS:
        try:
            response = httpx.get(endpoint, timeout=10.0)
            if response.status_code == 200:
                status = response.json()
                state = status.get("state")

                if state == "completed":
                    return {"status": "completed", "data": status}
                elif state == "failed":
                    return {"status": "failed", "error": status.get("failedReason", "Unknown error")}
            elif response.status_code == 404:
                return {"status": "error", "error": "Job not found"}
        except httpx.HTTPError as e:
            logger.warning("Error polling job status: %s", e)

        time.sleep(POLL_INTERVAL_SECONDS)

    return {"status": "timeout", "error": "Preview render timed out after 5 minutes"}


@tool
def previewTimeline(
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict[str, Any]:
    """Render a preview of the current timeline and return it for viewing.

    Optionally pass start_time and end_time (in seconds) to render only a segment.
    This triggers a fast low-resolution render (360p, 10fps), waits for it to complete,
    then returns the video so you can see it directly.

    Use this to review your edits before finalizing. The video will be returned
    as multimodal content that you can perceive and analyze with full context
    of what you were trying to achieve.

    Takes 10-60 seconds depending on timeline length (or segment length if range used).
    """
    context = _agent_context or {}
    settings = get_settings()

    user_id = context.get("user_id")
    if not user_id:
        return {
            "status": "error",
            "message": "Unable to render preview: no user context available.",
        }

    project_id = context.get("project_id")
    branch_id = context.get("branch_id") or "main"

    if not project_id:
        return {
            "status": "error",
            "message": "No project ID available. Ask the user to open a project in Studio.",
        }

    # Deduct credits (reduced cost for preview)
    base_cost = get_credits_for_action("render")
    preview_cost = max(1, base_cost // 4)
    try:
        deduct_credits(user_id, preview_cost, "render_preview", settings)
    except InsufficientCreditsError as e:
        return {
            "status": "error",
            "message": f"Insufficient credits. Need {e.required} R-Credits for preview render.",
        }

    request_id = uuid4().hex

    # Generate signed upload URL for GCS
    gcs_object_name = f"previews/{user_id}/{project_id}/{request_id}.mp4"

    upload_url = _generate_signed_upload_url(gcs_object_name, "video/mp4", settings)
    if not upload_url:
        return {
            "status": "error",
            "message": "Failed to generate upload URL for preview.",
        }

    # Build output
    output_payload: Dict[str, Any] = {
        "format": "mp4",
        "fps": PREVIEW_FPS,
        "quality": PREVIEW_QUALITY,
        "includeAudio": True,
        "uploadUrl": upload_url,
    }

    if (
        start_time is not None
        and end_time is not None
        and end_time > start_time
    ):
        output_payload["range"] = [start_time, end_time]

    thread_id = context.get("thread_id")
    metadata: Dict[str, Any] = {
        "tags": ["gemini-agent", "previewTimeline", "preview"],
        "extra": {
            "requestedAt": datetime.now(timezone.utc).isoformat(),
            "previewMode": True,
        },
    }
    if thread_id:
        metadata["agent"] = {
            "threadId": thread_id,
            "projectId": project_id,
            "userId": user_id,
            "requestId": request_id,
            "branchId": branch_id,
        }

    # Minimal payload — renderer fetches project data, resolves URLs, etc.
    job_payload: Dict[str, Any] = {
        "userId": user_id,
        "projectId": project_id,
        "branchId": branch_id,
        "output": output_payload,
        "options": {
            "resolutionScale": PREVIEW_RESOLUTION_SCALE,
        },
        "metadata": metadata,
    }

    endpoint = settings.renderer_base_url.rstrip("/") + "/renders"

    logger.info(
        "[RENDER] previewTimeline calling renderer: endpoint=%s, userId=%s, projectId=%s, branchId=%s",
        endpoint, user_id, project_id, branch_id,
    )

    # Sign the request
    body = json.dumps(job_payload)
    request_headers: Dict[str, str] = {"Content-Type": "application/json"}

    if settings.renderer_shared_secret:
        timestamp = int(time.time() * 1000)
        signature = _sign_renderer_request(body, timestamp, settings.renderer_shared_secret)
        request_headers["X-Signature"] = signature
        request_headers["X-Timestamp"] = str(timestamp)

    # Queue the render
    try:
        response = httpx.post(endpoint, content=body, headers=request_headers, timeout=30.0)
    except httpx.HTTPError as exc:
        return {
            "status": "error",
            "message": f"Failed to contact renderer: {exc}",
        }

    if response.status_code != 202:
        return {
            "status": "error",
            "message": f"Renderer rejected request (HTTP {response.status_code}): {response.text[:200]}",
        }

    job_response = response.json()
    job_id = job_response.get("jobId")
    if not job_id:
        return {
            "status": "error",
            "message": "Renderer queued job but didn't return an ID.",
        }

    logger.info("[previewTimeline] Preview render queued: job_id=%s", job_id)

    # Poll for completion
    poll_result = _poll_job_status(job_id, settings)

    if poll_result["status"] == "timeout":
        return {
            "status": "error",
            "message": "Preview render timed out. The timeline may be too long or complex.",
        }

    if poll_result["status"] == "failed":
        return {
            "status": "error",
            "message": f"Preview render failed: {poll_result.get('error', 'Unknown error')}",
        }

    if poll_result["status"] == "error":
        return {
            "status": "error",
            "message": poll_result.get("error", "Unknown error"),
        }

    # Render completed - download the video
    download_url = _generate_signed_download_url(gcs_object_name, settings)
    if not download_url:
        return {
            "status": "error",
            "message": "Preview rendered but failed to generate download URL.",
        }

    logger.info("[previewTimeline] Downloading preview from GCS...")

    try:
        fetch_resp = httpx.get(download_url, timeout=300.0, follow_redirects=True)
        fetch_resp.raise_for_status()
        video_bytes = fetch_resp.content
    except httpx.HTTPError as exc:
        return {
            "status": "error",
            "message": f"Failed to download preview video: {exc}",
        }

    if not video_bytes:
        return {
            "status": "error",
            "message": "Preview video is empty.",
        }

    logger.info("[previewTimeline] Uploading preview to Gemini Files API (%d bytes)", len(video_bytes))

    # Upload to Gemini Files API
    try:
        uploaded = upload_file_sync(
            video_bytes,
            "video/mp4",
            display_name=f"Timeline Preview",
        )
    except Exception as exc:
        logger.exception("Failed to upload preview to Gemini Files API")
        return {
            "status": "error",
            "message": f"Failed to upload preview to Gemini: {exc}",
        }

    file_uri = uploaded.uri
    logger.info("[previewTimeline] Preview ready: %s", file_uri)

    range_note = ""
    if start_time is not None and end_time is not None and end_time > start_time:
        range_note = f" (segment {start_time}s–{end_time}s)"

    return {
        "status": "success",
        "message": f"Preview render{range_note} ready ({PREVIEW_FPS}fps, low quality). The video is now visible.",
        "_injectMedia": True,
        "fileUri": file_uri,
        "mimeType": "video/mp4",
        "jobId": job_id,
        "fps": PREVIEW_FPS,
    }
