"""Tool to apply a video effect (e.g. segmentation) to an asset/clip."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.tools import tool

from ..config import get_settings

logger = logging.getLogger(__name__)

# Supported effect ID (segmentation)
EFFECT_ID_SAM2 = "replicate.meta.sam2-video"


@tool
def applyVideoEffectToClip(
    asset_id: str,
    effect_id: str = EFFECT_ID_SAM2,
    click_coordinates: str = "",
    click_frames: str = "1",
    click_object_ids: str = "",
    mask_type: str = "binary",
    video_fps: int = 25,
    output_video: bool = True,
    user_id: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Apply a video effect (e.g. segmentation) to a clip/asset.

    Use this after you have digested the clip or fetched asset metadata so you know
    the video content and where to place tracking points. For the segmentation effect,
    provide     click_coordinates as [x,y] pairs (e.g. '[391,239],[178,320]') and
    click_frames as comma-separated frame numbers (e.g. '1,15,30'). Returns a job ID
    to poll with getVideoEffectJobStatus.

    Args:
        asset_id: The ID of the asset (clip) to apply the effect to.
        effect_id: Effect to apply. Default is segmentation (replicate.meta.sam2-video).
        click_coordinates: Coordinates for tracking points, [x,y] pairs e.g. '[391,239],[178,320]'.
        click_frames: Comma-separated frame numbers where clicks apply (e.g. '1,15,30'). Default '1'.
        click_object_ids: Optional labels for objects (e.g. 'bee_1,bee_2').
        mask_type: 'binary' or 'highlighted'. Default 'binary'.
        video_fps: Output FPS. Default 25.
        output_video: Whether to return video output. Default True.
        user_id: Injected from agent context.
        project_id: Injected from agent context.
    """
    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "user_id and project_id are required (injected from session).",
        }

    if not asset_id:
        return {
            "status": "error",
            "message": "asset_id is required.",
        }

    settings = get_settings()
    base_url = settings.video_effects_service_url or ""
    if not base_url:
        return {
            "status": "error",
            "message": "Video effects service URL not configured (VIDEO_EFFECTS_SERVICE_URL).",
        }

    params: dict[str, Any] = {
        "maskType": mask_type,
        "videoFps": video_fps,
        "clickFrames": click_frames or "1",
        "clickObjectIds": click_object_ids or "",
        "clickCoordinates": click_coordinates,
        "outputVideo": output_video,
    }

    payload = {
        "assetId": asset_id,
        "effectId": effect_id,
        "userId": user_id,
        "projectId": project_id,
        "params": params,
    }

    endpoint = f"{base_url.rstrip('/')}/api/jobs"

    try:
        response = httpx.post(endpoint, json=payload, timeout=30.0)
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact video effects service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach video effects service: {exc}",
        }

    if response.status_code != 201:
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
    effect_label = job.get("effectLabel", effect_id)
    asset_name = job.get("assetName", asset_id)

    return {
        "status": "success",
        "message": f"Started '{effect_label}' for asset {asset_name}. Use getVideoEffectJobStatus with this jobId to check completion.",
        "jobId": job_id,
        "job": job,
    }


@tool
def getVideoEffectJobStatus(
    job_id: str,
) -> dict[str, Any]:
    """Check the status of a video effect job started by applyVideoEffectToClip.

    Args:
        job_id: The job ID returned when starting the effect.
    """
    settings = get_settings()
    base_url = settings.video_effects_service_url or ""
    if not base_url:
        return {
            "status": "error",
            "message": "Video effects service URL not configured (VIDEO_EFFECTS_SERVICE_URL).",
        }

    endpoint = f"{base_url.rstrip('/')}/api/jobs/{job_id}"

    try:
        response = httpx.get(endpoint, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact video effects service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach video effects service: {exc}",
        }

    if response.status_code == 404:
        return {
            "status": "error",
            "message": f"Job '{job_id}' not found.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Video effects service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        data = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response: {exc}",
        }

    job = data.get("job", {})
    status = job.get("status", "unknown")
    result_asset_url = job.get("resultAssetUrl")
    error_msg = job.get("error")

    return {
        "status": "success",
        "jobId": job_id,
        "jobStatus": status,
        "resultAssetUrl": result_asset_url,
        "error": error_msg,
        "job": job,
    }
