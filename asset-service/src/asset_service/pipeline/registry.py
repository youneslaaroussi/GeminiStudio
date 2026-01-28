"""Pipeline step registry and runner."""

from __future__ import annotations

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

logger = logging.getLogger(__name__)


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
) -> dict[str, Any]:
    """
    Run all auto-start steps for an asset.

    Args:
        user_id: User ID
        project_id: Project ID
        asset: Asset information
        asset_path: Path to the asset file

    Returns:
        Updated pipeline state
    """
    from ..metadata.ffprobe import determine_asset_type

    asset_type = AssetType(determine_asset_type(asset.mime_type, asset.name))
    auto_steps = [s for s in get_steps() if s.auto_start]

    state = await get_pipeline_state(user_id, project_id, asset.id)

    for step in auto_steps:
        # Skip if not supported for this asset type
        if step.supported_types and asset_type not in step.supported_types:
            continue

        # Check current status
        current = next((s for s in state["steps"] if s["id"] == step.id), None)
        if current and current.get("status") in ("succeeded", "running", "waiting"):
            continue

        # Run the step
        state = await run_step(user_id, project_id, asset, asset_path, step.id)

    return state
