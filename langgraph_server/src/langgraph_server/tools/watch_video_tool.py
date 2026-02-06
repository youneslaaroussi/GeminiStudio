"""Tool to render a preview of the timeline and return it for the agent to watch.

This triggers a fast low-res render, waits for completion, and returns the video
as multimodal content so the agent can analyze it with full conversation context.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
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
from ..firebase import fetch_user_projects
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


def _sign_asset_request(timestamp: int, secret: str) -> str:
    """Sign an asset service GET request with HMAC-SHA256."""
    payload = f"{timestamp}."
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


def _get_asset_signed_url(
    settings: Settings, user_id: str, project_id: str, asset_id: str
) -> str | None:
    """Fetch signed playback URL for an asset. Used only for render payload, never stored."""
    if not settings.asset_service_url:
        return None
    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id}"
    headers: dict[str, str] = {}
    if settings.asset_service_shared_secret:
        ts = int(time.time() * 1000)
        headers["X-Signature"] = _sign_asset_request(ts, settings.asset_service_shared_secret)
        headers["X-Timestamp"] = str(ts)
    try:
        resp = httpx.get(endpoint, headers=headers, timeout=10.0)
        if resp.status_code == 200:
            return resp.json().get("signedUrl")
    except Exception as e:
        logger.warning("Failed to get signed URL for asset %s: %s", asset_id, e)
    return None


def _resolve_project_assets_for_render(
    project_data: dict[str, Any], settings: Settings, user_id: str, project_id: str
) -> dict[str, Any]:
    """Resolve assetId -> signed URL for all media clips. Payload only; never persisted."""
    project = dict(project_data)
    layers = project.get("layers", [])

    for layer in layers:
        for clip in layer.get("clips", []):
            ctype = clip.get("type")
            if ctype not in ("video", "audio", "image"):
                continue
            asset_id = clip.get("assetId")
            if not asset_id:
                continue
            url = _get_asset_signed_url(settings, user_id, project_id, asset_id)
            if url:
                clip["src"] = url
            if ctype == "video" and clip.get("maskAssetId"):
                mask_url = _get_asset_signed_url(settings, user_id, project_id, clip["maskAssetId"])
                if mask_url:
                    clip["maskSrc"] = mask_url

    project["layers"] = layers
    return project


def _extract_project(projects: list[dict[str, Any]], project_id: str | None) -> dict[str, Any] | None:
    if not projects:
        return None
    if project_id:
        for entry in projects:
            if entry.get("id") == project_id:
                return entry
    return projects[0]


def _slugify(name: str) -> str:
    """Convert project name into a filesystem-friendly slug."""
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return normalized or "preview"


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
                # Still waiting or active - continue polling
            elif response.status_code == 404:
                return {"status": "error", "error": "Job not found"}
        except httpx.HTTPError as e:
            logger.warning("Error polling job status: %s", e)

        time.sleep(POLL_INTERVAL_SECONDS)

    return {"status": "timeout", "error": "Preview render timed out after 5 minutes"}


@tool
def watchVideo(
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict[str, Any]:
    """Render a preview of the current timeline and watch it.

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
    branch_id = context.get("branch_id")

    if branch_id and project_id:
        projects = fetch_user_projects(user_id, settings, branch_id=branch_id, project_id=project_id)
    else:
        projects = fetch_user_projects(user_id, settings)

    target_project = _extract_project(projects, project_id)
    if not target_project:
        return {
            "status": "error",
            "message": "No project found. Ask the user to open a project in Studio.",
        }

    project_data = target_project.get("_projectData")
    if not isinstance(project_data, dict):
        return {
            "status": "error",
            "message": "Project data is unavailable. Please sync the project.",
        }

    project_name = project_data.get("name") or target_project.get("name") or "Preview"

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

    project_payload = _resolve_project_assets_for_render(
        project_data, settings, user_id, project_id or target_project.get("id") or ""
    )
    project_payload.setdefault("renderScale", PREVIEW_RESOLUTION_SCALE)
    project_payload.setdefault("background", project_payload.get("background", "#000000"))
    project_payload.setdefault("fps", PREVIEW_FPS)

    # Get resolution and apply scale
    resolution = project_data.get("resolution") or {}
    full_width = int(resolution.get("width") or 1280)
    full_height = int(resolution.get("height") or 720)
    preview_width = int(full_width * PREVIEW_RESOLUTION_SCALE)
    preview_height = int(full_height * PREVIEW_RESOLUTION_SCALE)

    request_id = uuid4().hex
    slug = _slugify(project_name)
    destination = f"/tmp/gemini-preview/{slug}-{request_id}.mp4"

    # Generate signed upload URL for GCS
    effective_project_id = project_id or target_project.get("id") or "unknown"
    gcs_object_name = f"previews/{user_id}/{effective_project_id}/{request_id}.mp4"

    upload_url = _generate_signed_upload_url(gcs_object_name, "video/mp4", settings)
    if not upload_url:
        return {
            "status": "error",
            "message": "Failed to generate upload URL for preview.",
        }

    output_payload: Dict[str, Any] = {
        "format": "mp4",
        "fps": PREVIEW_FPS,
        "size": {"width": preview_width, "height": preview_height},
        "quality": PREVIEW_QUALITY,
        "destination": destination,
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
        "tags": ["gemini-agent", "watchVideo", "preview"],
        "extra": {
            "requestedAt": datetime.now(timezone.utc).isoformat(),
            "projectName": project_name,
            "previewMode": True,
        },
    }
    if thread_id:
        metadata["agent"] = {
            "threadId": thread_id,
            "projectId": effective_project_id,
            "userId": user_id,
            "requestId": request_id,
        }

    job_payload: Dict[str, Any] = {
        "project": project_payload,
        "output": output_payload,
        "metadata": metadata,
        "options": {
            "resolutionScale": PREVIEW_RESOLUTION_SCALE,
        },
    }

    endpoint = settings.renderer_base_url.rstrip("/") + "/renders"

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

    logger.info("[watchVideo] Preview render queued: job_id=%s", job_id)

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

    logger.info("[watchVideo] Downloading preview from GCS...")

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

    logger.info("[watchVideo] Uploading preview to Gemini Files API (%d bytes)", len(video_bytes))

    # Upload to Gemini Files API
    try:
        uploaded = upload_file_sync(
            video_bytes,
            "video/mp4",
            display_name=f"Timeline Preview - {project_name}",
        )
    except Exception as exc:
        logger.exception("Failed to upload preview to Gemini Files API")
        return {
            "status": "error",
            "message": f"Failed to upload preview to Gemini: {exc}",
        }

    file_uri = uploaded.uri
    logger.info("[watchVideo] Preview ready: %s", file_uri)

    range_note = ""
    if start_time is not None and end_time is not None and end_time > start_time:
        range_note = f" (segment {start_time}s–{end_time}s)"

    # Return text with _injectMedia flag - agent.py will inject media as HumanMessage
    return {
        "status": "success",
        "message": f"Preview render of '{project_name}'{range_note} ready ({preview_width}x{preview_height} @ {PREVIEW_FPS}fps). The video is now visible.",
        "_injectMedia": True,
        "fileUri": file_uri,
        "mimeType": "video/mp4",
        "assetName": f"{project_name} (preview)",
        "jobId": job_id,
        "projectName": project_name,
        "resolution": f"{preview_width}x{preview_height}",
        "fps": PREVIEW_FPS,
    }
