from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, Optional
from uuid import uuid4

import httpx
from google.cloud import storage
from google.oauth2 import service_account
from langchain_core.tools import tool, InjectedToolArg

from ..config import Settings, get_settings
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError

logger = logging.getLogger(__name__)


def _sign_renderer_request(body: str, timestamp: int, secret: str) -> str:
    """Sign a renderer request body with HMAC-SHA256."""
    payload = f"{timestamp}.{body}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

_FORMAT_CHOICES = {"mp4", "webm", "gif"}
_QUALITY_CHOICES = {"low", "web", "social", "studio"}

_MIME_TYPES = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "gif": "image/gif",
}


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
        logger.warning("No GCS credentials available for signed URL generation")
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


@tool
def renderVideo(
  format: str = "mp4",
  fps: int | None = None,
  quality: str = "web",
  upload_url: str | None = None,
  include_audio: bool = True,
  range_start: float | None = None,
  range_end: float | None = None,
  _agent_context: Annotated[Optional[Dict[str, Any]], InjectedToolArg] = None,
) -> dict:
  """Queue a timeline render for the active project and notify when it completes.

  Args:
      format: Output format - 'mp4', 'webm', or 'gif'. Defaults to 'mp4'.
      fps: Frames per second. Use lower values (e.g., 15) for fast previews.
      quality: Quality preset - 'low', 'web', 'social', or 'studio'. Use 'low' for previews.
      upload_url: Optional custom upload URL.
      include_audio: Whether to include audio in the output.
      range_start: Start time in seconds for partial render. Use with range_end for previews.
      range_end: End time in seconds for partial render. Use with range_start for previews.
  """

  context = _agent_context or {}
  settings = get_settings()

  effective_user_id = context.get("user_id")
  if not effective_user_id:
    return {
      "status": "error",
      "message": "Unable to queue render because no user context is available.",
      "reason": "missing_user",
    }

  effective_project_id = context.get("project_id")
  effective_branch_id = context.get("branch_id") or "main"

  if not effective_project_id:
    return {
      "status": "error",
      "message": "No project ID available. Ask the user to open a project in Studio and try again.",
      "reason": "missing_project",
    }

  output_format = (format or "mp4").lower()
  if output_format not in _FORMAT_CHOICES:
    return {
      "status": "error",
      "message": f"Unsupported output format '{format}'. Choose from {sorted(_FORMAT_CHOICES)}.",
      "reason": "invalid_format",
    }

  output_quality = (quality or "web").lower()
  if output_quality not in _QUALITY_CHOICES:
    output_quality = "web"

  # Deduct credits before render
  cost = get_credits_for_action("render")
  try:
    deduct_credits(effective_user_id, cost, "render", settings)
  except InsufficientCreditsError as e:
    logger.warning("[RENDER] Insufficient credits for user %s", effective_user_id)
    return {
      "status": "error",
      "message": f"Insufficient credits. You need {e.required} R‑Credits to render. Add credits in Gemini Studio Settings to continue.",
      "reason": "insufficient_credits",
      "required": e.required,
      "current": e.current,
    }

  request_id = uuid4().hex

  # Generate signed upload URL for GCS
  gcs_object_name = f"renders/{effective_user_id}/{effective_project_id}/{request_id}.{output_format}"
  content_type = _MIME_TYPES.get(output_format, "application/octet-stream")
  
  effective_upload_url = upload_url or _generate_signed_upload_url(
      gcs_object_name, content_type, settings
  )

  if not effective_upload_url:
    return {
      "status": "error",
      "message": "Failed to generate upload URL for render.",
      "reason": "upload_url_failed",
    }

  # Build output
  output_payload: Dict[str, Any] = {
    "format": output_format,
    "quality": output_quality,
    "includeAudio": bool(include_audio),
    "uploadUrl": effective_upload_url,
  }

  if fps is not None:
    output_payload["fps"] = int(fps)

  if range_start is not None and range_end is not None:
    output_payload["range"] = [range_start, range_end]

  thread_id = context.get("thread_id")
  if not thread_id:
    return {
      "status": "error",
      "message": (
        "Render job could not be queued because no conversation thread is associated with this request. "
        "Please make the request from within an active chat session."
      ),
      "reason": "missing_thread",
    }

  agent_metadata = {
    key: value
    for key, value in {
      "threadId": thread_id,
      "projectId": effective_project_id,
      "userId": effective_user_id,
      "requestId": request_id,
      "branchId": effective_branch_id,
    }.items()
    if value is not None
  }

  metadata: Dict[str, Any] = {
    "tags": ["gemini-agent", "renderVideo"],
    "extra": {
      "requestedAt": datetime.now(timezone.utc).isoformat(),
      "eventTopic": settings.render_event_topic,
      "eventSubscription": settings.render_event_subscription,
    },
  }
  if agent_metadata:
    metadata["agent"] = agent_metadata

  # Minimal payload — renderer fetches project data, resolves URLs, etc.
  job_payload: Dict[str, Any] = {
    "userId": effective_user_id,
    "projectId": effective_project_id,
    "branchId": effective_branch_id,
    "output": output_payload,
    "metadata": metadata,
  }

  endpoint = settings.renderer_base_url.rstrip("/") + "/renders"

  logger.info(
    "[RENDER] renderVideo calling renderer: endpoint=%s, userId=%s, projectId=%s, branchId=%s",
    endpoint, effective_user_id, effective_project_id, effective_branch_id,
  )

  # Sign the request for renderer authentication
  body = json.dumps(job_payload)
  request_headers: Dict[str, str] = {"Content-Type": "application/json"}

  if settings.renderer_shared_secret:
    timestamp = int(time.time() * 1000)
    signature = _sign_renderer_request(body, timestamp, settings.renderer_shared_secret)
    request_headers["X-Signature"] = signature
    request_headers["X-Timestamp"] = str(timestamp)

  try:
    response = httpx.post(endpoint, content=body, headers=request_headers, timeout=30.0)
  except httpx.HTTPError as exc:
    return {
      "status": "error",
      "message": f"Failed to contact renderer: {exc}",
      "reason": "renderer_unreachable",
    }

  if response.status_code != 202:
    detail = response.text[:200]
    return {
      "status": "error",
      "message": f"Renderer rejected the request (HTTP {response.status_code}). {detail}",
      "reason": "renderer_error",
    }

  body = response.json()
  job_id = body.get("jobId")
  if not job_id:
    return {
      "status": "error",
      "message": "Renderer queued the job but did not return an ID.",
      "reason": "missing_job_id",
    }

  return {
    "status": "queued",
    "jobId": job_id,
    "projectId": effective_project_id,
    "eventTopic": settings.render_event_topic,
    "eventSubscription": settings.render_event_subscription,
    "message": (
      f"Render job '{job_id}' queued. "
      "I'll notify you once the renderer reports the final status."
    ),
    "metadata": metadata,
  }
