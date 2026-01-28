"""Pipeline API routes."""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...config import get_settings
from ...storage.firestore import get_asset
from ...storage.gcs import download_from_gcs
from ...pipeline.registry import get_steps, run_step, run_auto_steps
from ...pipeline.store import get_pipeline_state, get_all_pipeline_states
from ...pipeline.types import StoredAsset
from ...tasks.queue import get_task_queue

logger = logging.getLogger(__name__)

router = APIRouter()


class StepDefinitionResponse(BaseModel):
    """Response model for step definition."""

    id: str
    label: str
    description: str
    autoStart: bool
    supportedTypes: list[str] | None


class StepStateResponse(BaseModel):
    """Response model for step state."""

    id: str
    label: str
    status: str
    metadata: dict[str, Any] = {}
    error: str | None = None
    startedAt: str | None = None
    updatedAt: str


class PipelineStateResponse(BaseModel):
    """Response model for pipeline state."""

    assetId: str
    steps: list[StepStateResponse]
    updatedAt: str


class RunStepRequest(BaseModel):
    """Request model for running a pipeline step."""

    params: dict[str, Any] = {}


@router.get("/steps", response_model=list[StepDefinitionResponse])
async def list_pipeline_steps():
    """List all available pipeline steps."""
    steps = get_steps()
    return [
        StepDefinitionResponse(
            id=step.id,
            label=step.label,
            description=step.description,
            autoStart=step.auto_start,
            supportedTypes=[t.value for t in step.supported_types] if step.supported_types else None,
        )
        for step in steps
    ]


@router.get("/{user_id}/{project_id}/{asset_id}", response_model=PipelineStateResponse)
async def get_asset_pipeline_state(user_id: str, project_id: str, asset_id: str):
    """Get pipeline state for an asset."""
    state = await get_pipeline_state(user_id, project_id, asset_id)
    return PipelineStateResponse(
        assetId=state["assetId"],
        steps=[StepStateResponse(**s) for s in state["steps"]],
        updatedAt=state["updatedAt"],
    )


@router.get("/{user_id}/{project_id}", response_model=list[PipelineStateResponse])
async def list_project_pipeline_states(user_id: str, project_id: str):
    """List pipeline states for all assets in a project."""
    states = await get_all_pipeline_states(user_id, project_id)
    return [
        PipelineStateResponse(
            assetId=state["assetId"],
            steps=[StepStateResponse(**s) for s in state["steps"]],
            updatedAt=state["updatedAt"],
        )
        for state in states
    ]


class RunStepResponse(BaseModel):
    """Response model for running a pipeline step."""

    taskId: str
    message: str


@router.post("/{user_id}/{project_id}/{asset_id}/{step_id}", response_model=RunStepResponse)
async def run_pipeline_step(
    user_id: str,
    project_id: str,
    asset_id: str,
    step_id: str,
    request: RunStepRequest | None = None,
):
    """
    Queue a specific pipeline step for background processing.

    Returns immediately with a task ID. Poll the pipeline state endpoint
    to check progress.
    """
    settings = get_settings()

    # Get asset
    asset_data = get_asset(user_id, project_id, asset_id, settings)
    if not asset_data:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Verify step exists
    step = next((s for s in get_steps() if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=400, detail=f"Unknown pipeline step: {step_id}")

    # Queue the step for background processing
    try:
        queue = await get_task_queue()
        params = request.params if request else {}
        task_id = await queue.enqueue_step(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            asset_data=asset_data,
            step_id=step_id,
            params=params,
        )
        logger.info(f"Queued step {step_id} for asset {asset_id}, task {task_id}")
    except Exception as e:
        logger.exception(f"Failed to queue pipeline step: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to queue step: {e}")

    return RunStepResponse(
        taskId=task_id,
        message=f"Step '{step.label}' queued for processing",
    )


@router.post("/{user_id}/{project_id}/{asset_id}/auto", response_model=RunStepResponse)
async def run_auto_pipeline_steps(user_id: str, project_id: str, asset_id: str):
    """
    Queue all auto-start pipeline steps for background processing.

    Returns immediately with a task ID. Poll the pipeline state endpoint
    to check progress.
    """
    settings = get_settings()

    # Get asset
    asset_data = get_asset(user_id, project_id, asset_id, settings)
    if not asset_data:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Queue the pipeline for background processing
    try:
        queue = await get_task_queue()
        task_id = await queue.enqueue_pipeline(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            asset_data=asset_data,
            asset_path="",  # Worker will download from GCS
        )
        logger.info(f"Queued auto pipeline for asset {asset_id}, task {task_id}")
    except Exception as e:
        logger.exception(f"Failed to queue pipeline: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to queue pipeline: {e}")

    return RunStepResponse(
        taskId=task_id,
        message="Pipeline queued for processing",
    )
