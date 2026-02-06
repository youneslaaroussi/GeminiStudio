"""Pipeline step registry and runner."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Awaitable

from .types import (
    AssetType,
    StepStatus,
    PipelineContext,
    PipelineResult,
    PipelineStepState,
    StoredAsset,
)
from .store import get_pipeline_state, update_pipeline_step
from ..config import get_settings
from ..search.algolia import index_asset

logger = logging.getLogger(__name__)

# Maximum time to wait for all steps to complete (5 minutes)
MAX_PIPELINE_WAIT_SECONDS = 300
# Interval between polling waiting steps
POLL_INTERVAL_SECONDS = 5

PARALLEL_STEP_IDS = {
    "shot-detection",
    "face-detection",
    "person-detection",
    "label-detection",
}

EARLY_STEP_IDS = {
    "cloud-upload",
    "metadata",
    "image-convert",
    "thumbnail",
    "frame-sampling",
    "waveform",
    "audio-extract",
}


@dataclass
class StepDefinition:
    """Definition of a pipeline step."""

    id: str
    label: str
    description: str = ""
    auto_start: bool = False
    supported_types: list[AssetType] | None = None
    run: Callable[[PipelineContext], Awaitable[PipelineResult]] = field(default=lambda ctx: None)


# Global registry
_registry: dict[str, StepDefinition] = {}


def register_step(
    id: str,
    label: str,
    description: str = "",
    auto_start: bool = False,
    supported_types: list[AssetType] | None = None,
):
    """
    Decorator to register a pipeline step.

    Usage:
        @register_step("my-step", "My Step", auto_start=True)
        async def my_step(context: PipelineContext) -> PipelineResult:
            ...
    """

    def decorator(func: Callable[[PipelineContext], Awaitable[PipelineResult]]):
        _registry[id] = StepDefinition(
            id=id,
            label=label,
            description=description,
            auto_start=auto_start,
            supported_types=supported_types,
            run=func,
        )
        logger.debug(f"Registered pipeline step: {id}")
        return func

    return decorator


def get_steps() -> list[StepDefinition]:
    """Get all registered pipeline steps in registration order."""
    return list(_registry.values())


def get_step(step_id: str) -> StepDefinition | None:
    """Get a step by ID."""
    return _registry.get(step_id)


async def run_step(
    user_id: str,
    project_id: str,
    asset: StoredAsset,
    asset_path: str,
    step_id: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run a single pipeline step for an asset.

    Args:
        user_id: User ID
        project_id: Project ID
        asset: Asset information
        asset_path: Path to the asset file
        step_id: ID of the step to run
        params: Optional parameters for the step

    Returns:
        Updated pipeline state

    Raises:
        ValueError: If step not found or not supported for asset type
    """
    from ..metadata.ffprobe import determine_asset_type

    step = get_step(step_id)
    if not step:
        raise ValueError(f"Unknown pipeline step: {step_id}")

    asset_type = AssetType(determine_asset_type(asset.mime_type, asset.name))
    if step.supported_types and asset_type not in step.supported_types:
        raise ValueError(f"Step '{step.label}' does not support {asset_type.value} assets")

    # Get current state
    state = await get_pipeline_state(user_id, project_id, asset.id)
    step_state = next(
        (s for s in state["steps"] if s["id"] == step_id),
        {"id": step_id, "label": step.label, "status": "idle", "updatedAt": datetime.utcnow().isoformat() + "Z"},
    )

    # Mark as running
    now = datetime.utcnow().isoformat() + "Z"
    await update_pipeline_step(
        user_id,
        project_id,
        asset.id,
        step_id,
        {
            "id": step_id,
            "label": step.label,
            "status": "running",
            "startedAt": now,
            "updatedAt": now,
        },
    )

    # Create context
    context = PipelineContext(
        asset=asset,
        asset_path=asset_path,
        asset_type=asset_type,
        step_state=PipelineStepState.from_dict(step_state),
        user_id=user_id,
        project_id=project_id,
        params=params or {},
    )

    # Run the step
    try:
        result = await step.run(context)
    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Pipeline step {step_id} failed: {error_msg}")
        await update_pipeline_step(
            user_id,
            project_id,
            asset.id,
            step_id,
            {
                "id": step_id,
                "label": step.label,
                "status": "failed",
                "error": error_msg,
                "updatedAt": datetime.utcnow().isoformat() + "Z",
            },
        )
        raise

    # Update with result
    now = datetime.utcnow().isoformat() + "Z"
    step_data = {
        "id": step_id,
        "label": step.label,
        "status": result.status.value,
        "metadata": result.metadata,
        "updatedAt": now,
    }
    if result.error:
        step_data["error"] = result.error

    await update_pipeline_step(user_id, project_id, asset.id, step_id, step_data)

    return await get_pipeline_state(user_id, project_id, asset.id)


async def run_auto_steps(
    user_id: str,
    project_id: str,
    asset: StoredAsset,
    asset_path: str,
    agent_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run all auto-start steps for an asset.

    Pipeline order: early steps (cloud-upload, metadata), then Gemini analysis,
    then Video Intelligence steps in parallel.
    """
    from ..metadata.ffprobe import determine_asset_type
    from ..pubsub import publish_pipeline_event

    asset_type = AssetType(determine_asset_type(asset.mime_type, asset.name))
    auto_steps = [s for s in get_steps() if s.auto_start]

    # Filter to steps supported for this asset type
    applicable_steps = [
        s for s in auto_steps
        if not s.supported_types or asset_type in s.supported_types
    ]
    
    logger.info(f"Pipeline for asset {asset.id} (type={asset_type.value}): applicable steps = {[s.id for s in applicable_steps]}")

    state = await get_pipeline_state(user_id, project_id, asset.id)
    steps_run = []
    failed_steps = []

    from ..tasks.worker import is_shutting_down

    early_steps = [s for s in applicable_steps if s.id in EARLY_STEP_IDS]
    # Middle steps run sequentially (like gemini-analysis)
    middle_steps = [s for s in applicable_steps if s.id not in PARALLEL_STEP_IDS and s.id not in EARLY_STEP_IDS]
    # Parallel steps run last
    parallel_steps = [s for s in applicable_steps if s.id in PARALLEL_STEP_IDS]
    
    # Combine sequential steps in order
    sequential_steps = early_steps + middle_steps

    # Helper to run a single step and track results
    async def execute_step(step: StepDefinition) -> dict[str, Any] | None:
        """Execute a step and return its result info."""
        if is_shutting_down():
            return None

        # Check current status
        current_state = await get_pipeline_state(user_id, project_id, asset.id)
        current = next((s for s in current_state["steps"] if s["id"] == step.id), None)
        if current and current.get("status") in ("succeeded", "running"):
            return None

        try:
            # Use the (possibly refreshed) asset
            result_state = await run_step(user_id, project_id, asset, asset_path, step.id)
            step_state = next((s for s in result_state["steps"] if s["id"] == step.id), None)
            if step_state:
                return {
                    "id": step.id,
                    "label": step.label,
                    "status": step_state.get("status", "unknown"),
                }
        except Exception as e:
            logger.exception(f"Step {step.id} failed during auto-run: {e}")
            return {
                "id": step.id,
                "label": step.label,
                "status": "failed",
                "error": str(e),
            }
        return None

    # First pass: run sequential steps (early steps like cloud-upload, then analysis steps)
    for step in sequential_steps:
        if is_shutting_down():
            logger.info("Pipeline interrupted due to shutdown during step execution")
            break

        result = await execute_step(step)
        if result:
            steps_run.append(result)
            if result.get("status") == "failed":
                failed_steps.append(step.id)

    # Second pass: run parallel steps concurrently (video analysis steps)
    if parallel_steps and not is_shutting_down():
        logger.info(f"Running {len(parallel_steps)} video analysis steps in parallel")
        parallel_results = await asyncio.gather(
            *[execute_step(step) for step in parallel_steps],
            return_exceptions=True,
        )

        for i, result in enumerate(parallel_results):
            step = parallel_steps[i]
            if isinstance(result, Exception):
                logger.exception(f"Step {step.id} raised exception: {result}")
                steps_run.append({
                    "id": step.id,
                    "label": step.label,
                    "status": "failed",
                    "error": str(result),
                })
                failed_steps.append(step.id)
            elif result:
                steps_run.append(result)
                if result.get("status") == "failed":
                    failed_steps.append(step.id)

    # Refresh state after all steps
    state = await get_pipeline_state(user_id, project_id, asset.id)

    # Second pass: poll waiting steps until they complete or timeout
    elapsed_seconds = 0
    while elapsed_seconds < MAX_PIPELINE_WAIT_SECONDS:
        # Check for shutdown signal
        if is_shutting_down():
            logger.info("Pipeline interrupted due to shutdown")
            break

        # Get current state
        state = await get_pipeline_state(user_id, project_id, asset.id)

        # Find waiting steps
        waiting_step_ids = [
            s["id"] for s in state["steps"]
            if s.get("status") == "waiting"
        ]

        if not waiting_step_ids:
            logger.info(f"All pipeline steps completed for asset {asset.id}")
            break

        logger.info(
            f"Waiting for {len(waiting_step_ids)} steps to complete: {waiting_step_ids} "
            f"({elapsed_seconds}s elapsed)"
        )

        # Wait before polling (use shorter intervals for faster shutdown)
        await asyncio.sleep(min(POLL_INTERVAL_SECONDS, 2))
        elapsed_seconds += POLL_INTERVAL_SECONDS

        # Re-run waiting steps to poll their status
        for step_id in waiting_step_ids:
            # Check for shutdown before each step poll
            if is_shutting_down():
                logger.info("Pipeline polling interrupted due to shutdown")
                break

            step = get_step(step_id)
            if not step:
                continue

            try:
                state = await run_step(user_id, project_id, asset, asset_path, step_id)
                step_state = next((s for s in state["steps"] if s["id"] == step_id), None)

                if step_state:
                    new_status = step_state.get("status", "unknown")

                    # Update steps_run if status changed
                    existing = next((s for s in steps_run if s["id"] == step_id), None)
                    if existing:
                        existing["status"] = new_status
                    else:
                        steps_run.append({
                            "id": step_id,
                            "label": step.label,
                            "status": new_status,
                        })

                    if new_status == "failed" and step_id not in failed_steps:
                        failed_steps.append(step_id)

            except Exception as e:
                logger.exception(f"Error polling step {step_id}: {e}")

    # Log if we timed out
    if elapsed_seconds >= MAX_PIPELINE_WAIT_SECONDS:
        waiting_steps = [s["id"] for s in state["steps"] if s.get("status") == "waiting"]
        if waiting_steps:
            logger.warning(
                f"Pipeline timed out after {MAX_PIPELINE_WAIT_SECONDS}s with "
                f"waiting steps: {waiting_steps}"
            )

    # Calculate final counts
    succeeded_count = sum(1 for s in steps_run if s.get("status") == "succeeded")
    total_count = len(steps_run)

    # Publish pipeline completion event
    if total_count > 0:
        # If more than half failed, consider pipeline failed
        if len(failed_steps) > total_count / 2:
            event_type = "pipeline.failed"
        else:
            event_type = "pipeline.completed"
    else:
        # No steps to run (all already done or not applicable)
        event_type = "pipeline.completed"

    publish_pipeline_event(
        event_type=event_type,
        user_id=user_id,
        project_id=project_id,
        asset_id=asset.id,
        asset_name=asset.name,
        steps_summary=steps_run,
        metadata={
            "agent": agent_metadata or {},
            "succeededCount": succeeded_count,
            "failedCount": len(failed_steps),
            "totalCount": total_count,
        },
    )

    # Index asset to Algolia for search (with pipeline metadata)
    try:
        from ..storage.firestore import get_asset as get_asset_data
        asset_data = get_asset_data(user_id, project_id, asset.id)
        if asset_data:
            await index_asset(
                user_id=user_id,
                project_id=project_id,
                asset_data=asset_data,
                pipeline_state=state,
            )
    except Exception as e:
        logger.warning(f"Failed to index asset to Algolia after pipeline: {e}")

    return state
