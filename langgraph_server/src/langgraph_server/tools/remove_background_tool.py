"""Tool to remove background from an image (polls until done)."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from langchain_core.tools import tool

from ..config import get_settings

logger = logging.getLogger(__name__)

EFFECT_ID_BACKGROUND_REMOVER = "replicate.851-labs.background-remover"
POLL_INTERVAL_SEC = 2
MAX_POLL_SEC = 120


@tool
def removeBackgroundOnImage(
    asset_id: str | None = None,
    image_url: str | None = None,
    _agent_context: dict | None = None,
) -> dict[str, Any]:
    """Remove the background from an image. Polls until the job completes, then returns the result.

    Use when the user asks to remove background, cut out subject, or make transparent.
    Provide either asset_id (for an asset in the project) or image_url (direct image URL).
    The result is stored in the asset service; returns resultAssetUrl and resultAssetId.

    Args:
        asset_id: The ID of the asset (image) to process. Use when the image is in project assets.
        image_url: Direct URL of the image. Use when you have an external image URL.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "user_id and project_id are required (injected from session).",
        }

    if not asset_id and not image_url:
        return {
            "status": "error",
            "message": "Either asset_id or image_url is required.",
        }
    if asset_id and image_url:
        return {
            "status": "error",
            "message": "Provide only one of asset_id or image_url.",
        }

    settings = get_settings()
    base_url = (settings.video_effects_service_url or "").rstrip("/")
    if not base_url:
        return {
            "status": "error",
            "message": "Video effects service URL not configured (VIDEO_EFFECTS_SERVICE_URL).",
        }

    payload: dict[str, Any] = {
        "effectId": EFFECT_ID_BACKGROUND_REMOVER,
        "userId": user_id,
        "projectId": project_id,
        "params": {},
    }
    if asset_id:
        payload["assetId"] = asset_id
    else:
        payload["imageUrl"] = image_url
        payload["assetName"] = "image"

    try:
        response = httpx.post(
            f"{base_url}/api/jobs",
            json=payload,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact video effects service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach video effects service: {exc}",
        }

    if response.status_code not in (200, 201):
        detail = response.text[:300] if response.text else "No detail"
        return {
            "status": "error",
            "message": f"Video effects service returned HTTP {response.status_code}: {detail}",
        }

    try:
        data = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response from video effects service: {exc}",
        }

    job = data.get("job", {})
    job_id = job.get("id", "")
    if not job_id:
        return {
            "status": "error",
            "message": "No job ID in response.",
        }

    # Poll until completed or error
    start = time.monotonic()
    while True:
        elapsed = time.monotonic() - start
        if elapsed >= MAX_POLL_SEC:
            return {
                "status": "error",
                "message": f"Background removal timed out after {MAX_POLL_SEC}s. JobId: {job_id}",
                "jobId": job_id,
            }

        try:
            poll_response = httpx.get(
                f"{base_url}/api/jobs/{job_id}",
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("Failed to poll job %s: %s", job_id, exc)
            time.sleep(POLL_INTERVAL_SEC)
            continue

        if poll_response.status_code != 200:
            time.sleep(POLL_INTERVAL_SEC)
            continue

        try:
            poll_data = poll_response.json()
        except Exception:
            time.sleep(POLL_INTERVAL_SEC)
            continue

        job = poll_data.get("job", {})
        status = job.get("status", "")

        if status == "completed":
            return {
                "status": "success",
                "message": "Background removed successfully.",
                "jobId": job_id,
                "resultAssetId": job.get("resultAssetId"),
                "resultAssetUrl": job.get("resultAssetUrl"),
                "job": job,
            }
        if status == "error":
            return {
                "status": "error",
                "message": job.get("error", "Background removal failed."),
                "jobId": job_id,
                "job": job,
            }

        time.sleep(POLL_INTERVAL_SEC)
