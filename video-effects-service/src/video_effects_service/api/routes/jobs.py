"""API routes for video effect jobs."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...effects.definitions import get_effect_definition
from ...storage.firestore import (
    get_job,
    list_jobs_by_asset,
    save_job,
)
from ...tasks import get_task_queue
from ...providers.replicate import create_prediction, map_replicate_status
from ...asset_client import get_asset_from_service

logger = logging.getLogger(__name__)

router = APIRouter()


class StartJobRequest(BaseModel):
    """Request body for starting a video effect job."""

    asset_id: str = Field(..., alias="assetId", min_length=1)
    effect_id: str = Field(..., alias="effectId", min_length=1)
    user_id: str = Field(..., alias="userId", min_length=1)
    project_id: str = Field(..., alias="projectId", min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class JobResponse(BaseModel):
    """Response body for a video effect job."""

    id: str
    effect_id: str = Field(alias="effectId")
    effect_label: str | None = Field(default=None, alias="effectLabel")
    provider: str
    asset_id: str = Field(alias="assetId")
    asset_name: str = Field(alias="assetName")
    asset_url: str = Field(alias="assetUrl")
    user_id: str | None = Field(default=None, alias="userId")
    project_id: str | None = Field(default=None, alias="projectId")
    status: str
    params: dict[str, Any]
    result_asset_id: str | None = Field(default=None, alias="resultAssetId")
    result_asset_url: str | None = Field(default=None, alias="resultAssetUrl")
    metadata: dict[str, Any] | None = None
    error: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


def job_to_response(job: dict[str, Any]) -> dict[str, Any]:
    """Convert a stored job to API response format."""
    definition = get_effect_definition(job.get("effectId", ""))
    return {
        "id": job["id"],
        "effectId": job.get("effectId"),
        "effectLabel": definition.label if definition else job.get("effectId"),
        "provider": job.get("provider"),
        "assetId": job.get("assetId"),
        "assetName": job.get("assetName"),
        "assetUrl": job.get("assetUrl"),
        "userId": job.get("userId"),
        "projectId": job.get("projectId"),
        "status": job.get("status"),
        "params": job.get("params", {}),
        "resultAssetId": job.get("resultAssetId"),
        "resultAssetUrl": job.get("resultAssetUrl"),
        "metadata": job.get("metadata"),
        "error": job.get("error"),
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
    }


@router.post("")
async def start_job(request: StartJobRequest):
    """Start a new video effect job."""
    import uuid
    from datetime import datetime

    # Get effect definition
    definition = get_effect_definition(request.effect_id)
    if not definition:
        raise HTTPException(status_code=400, detail=f"Unknown video effect: {request.effect_id}")

    # Get asset from asset service
    try:
        asset = await get_asset_from_service(
            request.user_id, request.project_id, request.asset_id
        )
    except Exception as e:
        logger.exception(f"Failed to get asset: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to get asset: {e}")

    asset_url = asset.get("signedUrl") or asset.get("gcsUri")
    if not asset_url:
        raise HTTPException(status_code=400, detail="Asset does not have a valid URL")

    # Merge default values with provided params
    merged_params = {**definition.default_values, **request.params}

    # Build provider input
    provider_input = definition.build_provider_input(
        asset_url=asset_url,
        asset_name=asset.get("name", ""),
        params=merged_params,
    )

    # Create prediction with Replicate
    try:
        prediction = await create_prediction(
            version=definition.version,
            input_data=provider_input,
        )
    except Exception as e:
        logger.exception(f"Failed to create prediction: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start effect: {e}")

    # Create job record
    job_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    job_data = {
        "id": job_id,
        "effectId": definition.id,
        "provider": definition.provider,
        "assetId": request.asset_id,
        "assetName": asset.get("name", ""),
        "assetUrl": asset_url,
        "userId": request.user_id,
        "projectId": request.project_id,
        "status": map_replicate_status(prediction.get("status", "")),
        "params": merged_params,
        "createdAt": now,
        "updatedAt": now,
        "providerState": {
            "replicate": {
                "predictionId": prediction["id"],
                "version": definition.version,
                "getUrl": prediction.get("urls", {}).get("get"),
                "streamUrl": prediction.get("urls", {}).get("stream"),
            }
        },
    }

    # Save to Firestore
    save_job(job_data)

    # Enqueue for background polling
    try:
        queue = await get_task_queue()
        await queue.enqueue_poll(job_id)
    except Exception as e:
        logger.warning(f"Failed to enqueue job for polling: {e}")

    return {"job": job_to_response(job_data)}


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a video effect job."""
    from ...service import poll_job

    # Poll and update job status
    job = await poll_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {"job": job_to_response(job)}


@router.get("")
async def list_jobs(asset_id: str = Query(..., alias="assetId")):
    """List all jobs for an asset."""
    jobs = list_jobs_by_asset(asset_id)
    return {"jobs": [job_to_response(job) for job in jobs]}
