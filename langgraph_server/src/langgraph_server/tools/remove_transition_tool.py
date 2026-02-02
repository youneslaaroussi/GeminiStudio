"""Tool to remove a transition between two clips (modifies Automerge state server-side)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client, ensure_main_branch_exists

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)
from .add_transition_tool import _make_transition_key

logger = logging.getLogger(__name__)


def _find_clip_and_layer(project_data: dict, clip_id: str) -> tuple[dict | None, dict | None]:
    """Return (clip, layer) if clip_id exists in project, else (None, None)."""
    layers = project_data.get("layers") or []
    for layer in layers:
        for clip in layer.get("clips") or []:
            if clip.get("id") == clip_id:
                return clip, layer
    return None, None


@tool
def removeTransition(
    from_clip_id: str,
    to_clip_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Remove an existing transition between two clips.

    Use getTimelineState to see current transitions. Provide the same from_clip_id and to_clip_id
    used when the transition was added (e.g. the clip IDs that form the transition key).

    Args:
        from_clip_id: ID of the first (left) clip in the transition.
        to_clip_id: ID of the second (right) clip in the transition.
        project_id: Project ID (injected by agent).
        user_id: User ID (injected by agent).
        branch_id: Branch ID (injected by agent).

    Returns:
        Status dict with removed transition info or error message.
    """
    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "User and project context required to remove transition.",
        }

    if not from_clip_id or not to_clip_id:
        return {
            "status": "error",
            "message": "Both from_clip_id and to_clip_id are required.",
        }

    settings = get_settings()
    db = get_firestore_client(settings)
    use_branch_id = branch_id or "main"

    try:
        branch_ref = (
            db.collection("users")
            .document(user_id)
            .collection("projects")
            .document(project_id)
            .collection("branches")
            .document(use_branch_id)
        )
        branch_doc = branch_ref.get()

        if not branch_doc.exists:
            if use_branch_id == "main":
                ensure_main_branch_exists(user_id, project_id, settings)
                branch_doc = branch_ref.get()  # re-fetch after create
            else:
                return {
                    "status": "error",
                    "message": f"Branch '{use_branch_id}' not found for project.",
                }

        branch_data = branch_doc.to_dict()
        automerge_state = branch_data.get("automergeState")

        if not automerge_state:
            if use_branch_id == "main":
                ensure_main_branch_exists(user_id, project_id, settings)
                branch_doc = branch_ref.get()
                branch_data = branch_doc.to_dict()
                automerge_state = branch_data.get("automergeState")
            else:
                return {
                    "status": "error",
                    "message": "Project has no timeline data yet.",
                }

        doc = _load_automerge_doc(automerge_state)
        project_data = _get_project_data(doc)

        if not project_data:
            return {
                "status": "error",
                "message": "Could not parse project timeline data.",
            }

        transitions: dict[str, Any] = project_data.get("transitions") or {}
        key = _make_transition_key(from_clip_id, to_clip_id)
        existing = transitions.get(key)

        if not existing:
            return {
                "status": "error",
                "message": f"No transition found between clips \"{from_clip_id}\" and \"{to_clip_id}\".",
            }

        from_clip, _ = _find_clip_and_layer(project_data, from_clip_id)
        to_clip, _ = _find_clip_and_layer(project_data, to_clip_id)
        from_name = from_clip.get("name", from_clip_id) if from_clip else from_clip_id
        to_name = to_clip.get("name", to_clip_id) if to_clip else to_clip_id

        del transitions[key]
        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
        })

        return {
            "status": "success",
            "message": f"Removed {existing.get('type', 'transition')} transition between \"{from_name}\" and \"{to_name}\".",
            "transitionKey": key,
            "removedTransition": existing,
        }
    except Exception as e:
        logger.exception("[REMOVE_TRANSITION] %s", e)
        return {
            "status": "error",
            "message": str(e),
        }
