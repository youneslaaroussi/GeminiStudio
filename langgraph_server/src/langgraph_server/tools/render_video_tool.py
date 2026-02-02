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
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
from google.cloud import storage
from google.oauth2 import service_account
from langchain_core.tools import tool, InjectedToolArg

from ..config import Settings, get_settings
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError
from ..firebase import fetch_user_projects

logger = logging.getLogger(__name__)


def _sign_renderer_request(body: str, timestamp: int, secret: str) -> str:
    """Sign a renderer request body with HMAC-SHA256."""
    payload = f"{timestamp}.{body}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

_FORMAT_CHOICES = {"mp4", "webm", "gif"}
_QUALITY_CHOICES = {"low", "web", "social", "studio"}
_ASSET_URL_PATTERN = re.compile(r"^/api/assets/([^/]+)/file")

_MIME_TYPES = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "gif": "image/gif",
}


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


def _slugify(name: str) -> str:
  """Convert project name into a filesystem-friendly slug."""

  normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
  return normalized or "render"


def _extract_project(projects: list[dict[str, Any]], project_id: str | None) -> dict[str, Any] | None:
  if not projects:
    return None
  if project_id:
    for entry in projects:
      if entry.get("id") == project_id:
        return entry
  return projects[0]


def _sign_asset_request(timestamp: int, secret: str) -> str:
  """Sign an asset service GET request with HMAC-SHA256."""
  # For GET requests, we sign just the timestamp (no body)
  payload = f"{timestamp}."
  return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _resolve_asset_url(src: str, settings: Settings, user_id: str | None = None) -> str | None:
  """Resolve /api/assets/{assetId}/file?projectId=... to a signed GCS URL."""
  match = _ASSET_URL_PATTERN.match(src)
  if not match:
    return None

  asset_id = match.group(1)
  parsed = urlparse(src)
  params = parse_qs(parsed.query)
  project_id = params.get("projectId", [None])[0]
  # Use provided user_id or fallback to URL param (for backwards compatibility)
  effective_user_id = user_id or params.get("userId", [None])[0]

  if not all([asset_id, project_id, effective_user_id, settings.asset_service_url]):
    logger.warning("Cannot resolve asset URL %s: missing asset_id=%s, project_id=%s, user_id=%s", 
                   src, asset_id, project_id, effective_user_id)
    return None

  endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{effective_user_id}/{project_id}/{asset_id}"
  
  # Build auth headers
  headers: dict[str, str] = {}
  if settings.asset_service_shared_secret:
    timestamp = int(time.time() * 1000)
    signature = _sign_asset_request(timestamp, settings.asset_service_shared_secret)
    headers["X-Signature"] = signature
    headers["X-Timestamp"] = str(timestamp)
  
  try:
    response = httpx.get(endpoint, headers=headers, timeout=10.0)
    if response.status_code == 200:
      data = response.json()
      signed_url = data.get("signedUrl")
      if signed_url:
        logger.debug("Resolved asset %s to signed URL", asset_id)
        return signed_url
    else:
      logger.warning("Asset service returned %d for %s: %s", response.status_code, endpoint, response.text[:200])
  except Exception as e:
    logger.warning("Failed to resolve asset URL %s: %s", src, e)

  return None


def _resolve_project_assets(project_data: dict[str, Any], settings: Settings, user_id: str | None = None) -> dict[str, Any]:
  """Resolve all /api/assets/... URLs in project clips to signed GCS URLs."""
  project = dict(project_data)
  layers = project.get("layers", [])
  resolved_count = 0
  failed_count = 0
  
  for layer in layers:
    for clip in layer.get("clips", []):
      src = clip.get("src", "")
      if src.startswith("/api/assets/"):
        signed_url = _resolve_asset_url(src, settings, user_id)
        if signed_url:
          clip["src"] = signed_url
          resolved_count += 1
        else:
          failed_count += 1
          logger.warning("Failed to resolve asset URL for clip: %s", src)
  
  if resolved_count > 0 or failed_count > 0:
    logger.info("Asset URL resolution: %d resolved, %d failed", resolved_count, failed_count)
  
  project["layers"] = layers
  return project


@tool
def renderVideo(
  format: str = "mp4",
  fps: int | None = None,
  width: int | None = None,
  height: int | None = None,
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
      width: Output width in pixels. Use lower values (e.g., 640) for fast previews.
      height: Output height in pixels. Use lower values (e.g., 360) for fast previews.
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
  effective_branch_id = context.get("branch_id")
  # When branch_id is set (chat session branch), only that branch's data is used
  if effective_branch_id and effective_project_id:
    projects = fetch_user_projects(effective_user_id, settings, branch_id=effective_branch_id, project_id=effective_project_id)
  else:
    projects = fetch_user_projects(effective_user_id, settings)
  target_project = _extract_project(projects, effective_project_id)

  if not target_project:
    return {
      "status": "error",
      "message": "No project could be located for the current user. Ask the user to open a project in Studio and try again.",
      "reason": "missing_project",
    }

  project_data = target_project.get("_projectData")
  if not isinstance(project_data, dict):
    return {
      "status": "error",
      "message": "Project data is unavailable or malformed. Please sync the project before rendering.",
      "reason": "missing_project_data",
    }

  project_name = (
    project_data.get("name")
    or target_project.get("name")
    or "Gemini Project"
  )

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

  resolution = project_data.get("resolution") or {}
  default_width = int(resolution.get("width") or 1920)
  default_height = int(resolution.get("height") or 1080)
  output_width = int(width or default_width)
  output_height = int(height or default_height)

  project_fps = project_data.get("fps") or 30
  output_fps = int(fps or project_fps)

  request_id = uuid4().hex
  slug = _slugify(project_name)
  destination = f"/tmp/gemini-renderer/{slug}-{request_id}.{output_format}"

  # Resolve /api/assets/... URLs to signed GCS URLs
  project_payload = _resolve_project_assets(project_data, settings, effective_user_id)
  project_payload.setdefault("renderScale", project_payload.get("renderScale", 1))
  project_payload.setdefault("background", project_payload.get("background", "#000000"))
  project_payload.setdefault("fps", project_payload.get("fps", output_fps))

  # Generate signed upload URL for GCS
  effective_project_id = project_id or target_project.get("id") or "unknown"
  gcs_object_name = f"renders/{effective_user_id}/{effective_project_id}/{request_id}.{output_format}"
  content_type = _MIME_TYPES.get(output_format, "application/octet-stream")
  
  effective_upload_url = upload_url or _generate_signed_upload_url(
      gcs_object_name, content_type, settings
  )

  output_payload: Dict[str, Any] = {
    "format": output_format,
    "fps": output_fps,
    "size": {"width": output_width, "height": output_height},
    "quality": output_quality,
    "destination": destination,
    "includeAudio": bool(include_audio),
  }
  if effective_upload_url:
    output_payload["uploadUrl"] = effective_upload_url
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
      "projectId": (project_id or target_project.get("id")),
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
      "projectName": project_name,
    },
  }
  if agent_metadata:
    metadata["agent"] = agent_metadata

  job_payload: Dict[str, Any] = {
    "project": project_payload,
    "output": output_payload,
    "metadata": metadata,
  }

  endpoint = settings.renderer_base_url.rstrip("/") + "/renders"

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
    "projectId": project_id or target_project.get("id"),
    "eventTopic": settings.render_event_topic,
    "eventSubscription": settings.render_event_subscription,
    "message": (
      f"Render job '{job_id}' queued for '{project_name}'. "
      "I'll notify you once the renderer reports the final status."
    ),
    "metadata": metadata,
  }
