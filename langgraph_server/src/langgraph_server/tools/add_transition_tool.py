"""Tool to add a transition between two adjacent clips (modifies Automerge state server-side)."""

from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)

# Transition types aligned with app (timeline-transition.ts, types/timeline.ts)
TRANSITION_TYPES = ("fade", "slide-left", "slide-right", "slide-up", "slide-down")
MIN_DURATION = 0.1
MAX_DURATION = 5.0
ADJACENCY_TOLERANCE = 0.01


def _make_transition_key(from_clip_id: str, to_clip_id: str) -> str:
    """Transition key format: fromId->toId (matches app makeTransitionKey)."""
    return f"{from_clip_id}->{to_clip_id}"


def _find_clip_and_layer(project_data: dict, clip_id: str) -> tuple[dict | None, dict | None]:
    """Return (clip, layer) if clip_id exists in project, else (None, None)."""
    layers = project_data.get("layers") or []
    for layer in layers:
        for clip in layer.get("clips") or []:
            if clip.get("id") == clip_id:
                return clip, layer
    return None, None


def _clip_end(clip: dict) -> float:
    """End time of clip: start + duration / speed (matches app getClipEnd)."""
    start = float(clip.get("start", 0))
    duration = float(clip.get("duration", 0))
    speed = float(clip.get("speed", 1))
    return start + duration / speed


@tool
def addTransition(
    from_clip_id: str,
    to_clip_id: str,
    transition_type: str = "fade",
    duration: float = 0.5,
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Add a transition effect between two adjacent video clips on the same layer.

    Use getTimelineState to get clip IDs. Both clips must be video, on the same layer,
    and adjacent (from clip ends where to clip starts). Supports fade and slide transitions.

    Args:
        from_clip_id: ID of the first (left) clip.
        to_clip_id: ID of the second (right) clip.
        transition_type: Effect type: "fade", "slide-left", "slide-right", "slide-up", "slide-down". Default "fade".
        duration: Transition duration in seconds (0.1 to 5). Default 0.5.
        project_id: Project ID (injected by agent).
        user_id: User ID (injected by agent).
        branch_id: Branch ID (injected by agent).

    Returns:
        Status dict with transition info or error message.
    """
    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "User and project context required to add transition.",
        }

    if not from_clip_id or not to_clip_id:
        return {
            "status": "error",
            "message": "Both from_clip_id and to_clip_id are required.",
        }

    if from_clip_id == to_clip_id:
        return {
            "status": "error",
            "message": "from_clip_id and to_clip_id must be different.",
        }

    transition_type = (transition_type or "fade").strip().lower()
    if transition_type not in TRANSITION_TYPES:
        return {
            "status": "error",
            "message": f"transition_type must be one of: {', '.join(TRANSITION_TYPES)}.",
        }

    if not (MIN_DURATION <= duration <= MAX_DURATION):
        return {
            "status": "error",
            "message": f"duration must be between {MIN_DURATION} and {MAX_DURATION} seconds.",
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
                automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
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

        from_clip, from_layer = _find_clip_and_layer(project_data, from_clip_id)
        to_clip, to_layer = _find_clip_and_layer(project_data, to_clip_id)

        if not from_clip:
            return {
                "status": "error",
                "message": f"Clip '{from_clip_id}' not found. Use getTimelineState to list clip IDs.",
            }
        if not to_clip:
            return {
                "status": "error",
                "message": f"Clip '{to_clip_id}' not found. Use getTimelineState to list clip IDs.",
            }

        if from_clip.get("type") != "video" or to_clip.get("type") != "video":
            return {
                "status": "error",
                "message": "Transitions are only supported between video clips.",
            }

        if from_layer is None or to_layer is None or from_layer.get("id") != to_layer.get("id"):
            return {
                "status": "error",
                "message": "Both clips must be on the same layer for a transition.",
            }

        from_end = _clip_end(from_clip)
        to_start = float(to_clip.get("start", 0))
        gap = abs(to_start - from_end)

        if gap > ADJACENCY_TOLERANCE:
            return {
                "status": "error",
                "message": f"Clips are not adjacent (gap {gap:.2f}s). Transitions require clips to be touching.",
            }

        if from_end > to_start + ADJACENCY_TOLERANCE:
            return {
                "status": "error",
                "message": "The 'from' clip must end where the 'to' clip begins.",
            }

        transitions: dict[str, Any] = project_data.setdefault("transitions", {})
        key = _make_transition_key(from_clip_id, to_clip_id)
        transition = {"type": transition_type, "duration": round(duration, 2)}
        transitions[key] = transition

        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
        })

        return {
            "status": "success",
            "message": f"Added {transition_type} transition ({duration}s) between \"{from_clip.get('name', from_clip_id)}\" and \"{to_clip.get('name', to_clip_id)}\".",
            "transitionKey": key,
            "fromClip": {"id": from_clip_id, "name": from_clip.get("name"), "end": from_end},
            "toClip": {"id": to_clip_id, "name": to_clip.get("name"), "start": to_start},
            "transition": transition,
        }
    except Exception as e:
        logger.exception("[ADD_TRANSITION] %s", e)
        return {
            "status": "error",
            "message": str(e),
        }
