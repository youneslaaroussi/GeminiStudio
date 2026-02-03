"""Main service logic for video effects."""

from __future__ import annotations

import logging
from typing import Any

from .effects.definitions import get_effect_definition
from .providers.replicate import get_prediction, map_replicate_status
from .storage.firestore import get_job, update_job
from .asset_client import download_remote_file, upload_to_asset_service

logger = logging.getLogger(__name__)


async def poll_job(job_id: str) -> dict[str, Any] | None:
    """
    Poll a video effect job and update its status.

    Args:
        job_id: The job ID to poll

    Returns:
        Updated job data, or None if not found
    """
    job = get_job(job_id)
    if not job:
        return None

    # If already completed or errored, no need to poll
    status = job.get("status", "")
    if status in ("completed", "error"):
        return job

    # Get effect definition
    effect_id = job.get("effectId", "")
    definition = get_effect_definition(effect_id)
    if not definition:
        logger.error(f"Unknown effect: {effect_id}")
        return update_job(job_id, {"status": "error", "error": f"Unknown effect: {effect_id}"})

    # Get provider state
    provider_state = job.get("providerState", {})
    replicate_state = provider_state.get("replicate", {})
    prediction_id = replicate_state.get("predictionId")

    if not prediction_id:
        logger.warning(f"Job {job_id} has no prediction ID")
        return job

    # Poll Replicate
    try:
        prediction = await get_prediction(prediction_id)
    except Exception as e:
        logger.exception(f"Failed to poll prediction: {e}")
        return job

    new_status = map_replicate_status(prediction.get("status", ""))

    if new_status == "completed":
        # Handle completion
        try:
            updated_job = await _handle_completion(job, definition, prediction)
            return updated_job
        except Exception as e:
            logger.exception(f"Failed to handle completion: {e}")
            return update_job(job_id, {"status": "error", "error": str(e)})

    if new_status == "error":
        # Handle error
        error_message = (
            prediction.get("error")
            or (
                prediction.get("output")
                if isinstance(prediction.get("output"), str)
                else (
                    "\n".join(prediction.get("output", []))
                    if isinstance(prediction.get("output"), list)
                    else "Video effect failed"
                )
            )
        )
        return update_job(job_id, {"status": "error", "error": error_message})

    # Still running, update status and metrics
    return update_job(
        job_id,
        {
            "status": new_status,
            "metadata": {
                **(job.get("metadata") or {}),
                "providerMetrics": prediction.get("metrics"),
            },
        },
    )


async def _handle_completion(
    job: dict[str, Any],
    definition: Any,
    prediction: dict[str, Any],
) -> dict[str, Any]:
    """Handle job completion - download result and upload to asset service."""
    job_id = job["id"]

    # Extract result from prediction
    extraction = definition.extract_result(
        prediction.get("output"),
        prediction.get("status", ""),
    )

    if extraction.get("error"):
        return update_job(job_id, {"status": "error", "error": extraction["error"]})

    result_url = extraction.get("result_url")
    if not result_url:
        return update_job(
            job_id,
            {"status": "error", "error": "Processed video URL was not returned by the provider."},
        )

    # Check if we have userId and projectId
    user_id = job.get("userId")
    project_id = job.get("projectId")
    if not user_id or not project_id:
        return update_job(
            job_id,
            {"status": "error", "error": "Cannot save result: missing userId or projectId"},
        )

    # Download the processed video
    logger.info(f"Downloading processed video from {result_url}")
    file_content, mime_type = await download_remote_file(result_url)

    # Use extension that matches actual format (webm, gif, mp4) so download filename is correct
    ext = ".mp4"
    if mime_type:
        mt = mime_type.split(";")[0].strip().lower()
        if mt == "video/webm":
            ext = ".webm"
        elif mt == "image/gif":
            ext = ".gif"
        elif mt.startswith("video/"):
            ext = ".mp4"
    filename = f"{definition.label or definition.id}-{job_id[:8]}{ext}"
    logger.info(f"Uploading result as {filename}")

    result = await upload_to_asset_service(
        user_id=user_id,
        project_id=project_id,
        file_content=file_content,
        filename=filename,
        mime_type=mime_type,
        source="video-effect",
        run_pipeline=True,
    )

    # Update job with result
    result_asset = result.get("asset", result)
    return update_job(
        job_id,
        {
            "status": "completed",
            "resultAssetId": result_asset.get("id"),
            "resultAssetUrl": result_asset.get("signedUrl"),
            "metadata": {
                **(job.get("metadata") or {}),
                **(extraction.get("metadata") or {}),
                "providerMetrics": prediction.get("metrics"),
            },
        },
    )
