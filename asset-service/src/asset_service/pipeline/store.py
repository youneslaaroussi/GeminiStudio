"""Pipeline state storage in Firestore."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from ..config import Settings, get_settings
from ..storage.firestore import get_firestore_client

logger = logging.getLogger(__name__)


def _get_default_steps() -> list[dict[str, Any]]:
    """Get default step states from registry."""
    # Import here to avoid circular imports
    from .registry import get_steps

    now = datetime.utcnow().isoformat() + "Z"
    return [
        {
            "id": step.id,
            "label": step.label,
            "status": "idle",
            "metadata": {},
            "updatedAt": now,
        }
        for step in get_steps()
    ]


def _merge_with_defaults(state: dict[str, Any]) -> dict[str, Any]:
    """Merge existing state with default steps."""
    from .registry import get_steps

    now = datetime.utcnow().isoformat() + "Z"
    existing = {s["id"]: s for s in state.get("steps", [])}

    merged_steps = []
    for step in get_steps():
        if step.id in existing:
            merged_steps.append(existing[step.id])
        else:
            merged_steps.append({
                "id": step.id,
                "label": step.label,
                "status": "idle",
                "metadata": {},
                "updatedAt": now,
            })

    return {
        **state,
        "steps": merged_steps,
    }


async def get_pipeline_state(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Get pipeline state for an asset.

    Returns a state dict with all registered steps (merging defaults with existing).
    """
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("assets")
        .document(asset_id)
        .collection("pipeline")
        .document("state")
    )

    # Run blocking Firestore call in thread pool
    doc = await asyncio.to_thread(doc_ref.get)
    now = datetime.utcnow().isoformat() + "Z"

    if not doc.exists:
        # Create initial state
        state = {
            "assetId": asset_id,
            "steps": _get_default_steps(),
            "updatedAt": now,
        }
        await asyncio.to_thread(doc_ref.set, state)
        return state

    data = doc.to_dict()
    return _merge_with_defaults(data)


async def get_all_pipeline_states(
    user_id: str,
    project_id: str,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Get pipeline states for all assets in a project."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    # Get all assets
    assets_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("assets")
    )

    # Run blocking stream() in thread pool and collect results
    asset_docs = await asyncio.to_thread(lambda: list(assets_ref.stream()))
    
    states = []
    for asset_doc in asset_docs:
        asset_id = asset_doc.id
        state = await get_pipeline_state(user_id, project_id, asset_id, settings)
        states.append(state)

    return states


async def update_pipeline_state(
    user_id: str,
    project_id: str,
    asset_id: str,
    steps: list[dict[str, Any]],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Update the full pipeline state for an asset."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("assets")
        .document(asset_id)
        .collection("pipeline")
        .document("state")
    )

    now = datetime.utcnow().isoformat() + "Z"
    state = {
        "assetId": asset_id,
        "steps": steps,
        "updatedAt": now,
    }

    await asyncio.to_thread(doc_ref.set, state)
    return state


async def update_pipeline_step(
    user_id: str,
    project_id: str,
    asset_id: str,
    step_id: str,
    step_data: dict[str, Any],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Update a single pipeline step.

    Args:
        user_id: User ID
        project_id: Project ID
        asset_id: Asset ID
        step_id: Step ID to update
        step_data: New step data

    Returns:
        Updated pipeline state
    """
    state = await get_pipeline_state(user_id, project_id, asset_id, settings)

    # Update or add the step
    steps = state.get("steps", [])
    updated = False
    for i, step in enumerate(steps):
        if step["id"] == step_id:
            steps[i] = step_data
            updated = True
            break

    if not updated:
        steps.append(step_data)

    return await update_pipeline_state(user_id, project_id, asset_id, steps, settings)


async def delete_pipeline_state(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> bool:
    """Delete pipeline state for an asset."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("assets")
        .document(asset_id)
        .collection("pipeline")
        .document("state")
    )

    doc = await asyncio.to_thread(doc_ref.get)
    if not doc.exists:
        return False

    await asyncio.to_thread(doc_ref.delete)
    return True
