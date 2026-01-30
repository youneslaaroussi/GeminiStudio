"""Tool to add a clip to the timeline (modifies Automerge state server-side)."""

from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client, decode_automerge_state

logger = logging.getLogger(__name__)


def _load_automerge_doc(base64_state: str):
    """Load an Automerge document from base64 state."""
    from automerge.core import Document
    binary = base64.b64decode(base64_state)
    return Document.load(binary)


def _save_automerge_doc(doc) -> str:
    """Save an Automerge document to base64 state."""
    binary = doc.save()
    return base64.b64encode(binary).decode("utf-8")


def _automerge_to_dict(doc, obj_id) -> Any:
    """Recursively convert Automerge document to Python dict/list.
    
    automerge-py returns values as (val_type, val) where:
    - For scalars: val_type is tuple (ScalarType.X, actual_value), val is internal ref
    - For objects: val_type is ObjType.Map/List/Text, val is object ID to recurse
    """
    from automerge.core import ObjType
    
    obj_type = doc.object_type(obj_id)
    
    if obj_type == ObjType.Map:
        result = {}
        for key in doc.keys(obj_id):
            value = doc.get(obj_id, key)
            if value is not None:
                val_type, val = value
                if isinstance(val_type, tuple):
                    # Scalar value: val_type is (ScalarType.X, actual_value)
                    result[key] = val_type[1]
                elif val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    # Nested object: recurse using val as object ID
                    result[key] = _automerge_to_dict(doc, val)
        return result
    elif obj_type == ObjType.List:
        result = []
        length = doc.length(obj_id)
        for i in range(length):
            value = doc.get(obj_id, i)
            if value is not None:
                val_type, val = value
                if isinstance(val_type, tuple):
                    # Scalar value: val_type is (ScalarType.X, actual_value)
                    result.append(val_type[1])
                elif val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    # Nested object: recurse using val as object ID
                    result.append(_automerge_to_dict(doc, val))
        return result
    elif obj_type == ObjType.Text:
        return doc.text(obj_id)
    return None


def _get_project_data(doc) -> dict | None:
    """
    Extract project data from Automerge document.
    
    The document may store project data in two ways:
    1. Directly as fields (name, layers, fps, etc.) - modern format
    2. As a JSON string in 'projectJSON' field - legacy format
    
    Returns the project data dict or None if extraction fails.
    """
    from automerge.core import ROOT
    
    result = _automerge_to_dict(doc, ROOT)
    
    if not isinstance(result, dict):
        logger.error("[ADD_CLIP] Automerge document root is not a dict")
        return None
    
    logger.info("[ADD_CLIP] Automerge doc keys: %s", list(result.keys()))
    
    # Check for legacy projectJSON format
    if 'projectJSON' in result:
        project_json_str = result['projectJSON']
        if isinstance(project_json_str, str):
            try:
                return json.loads(project_json_str)
            except json.JSONDecodeError as e:
                logger.error("[ADD_CLIP] Failed to parse projectJSON: %s", e)
                return None
    
    # Modern format: project data is stored directly
    if 'layers' in result:
        return result
    
    logger.error("[ADD_CLIP] No 'layers' key found in document. Available keys: %s", list(result.keys()))
    return None


def _set_project_data(doc, project_data: dict, use_legacy_format: bool = False) -> None:
    """
    Save project data back to Automerge document.
    
    Args:
        doc: The Automerge document
        project_data: The project data to save
        use_legacy_format: If True, saves as JSON string in 'projectJSON' field
    """
    from automerge.core import ROOT, ScalarType
    
    if use_legacy_format:
        with doc.transaction() as tx:
            tx.put(ROOT, "projectJSON", ScalarType.Str, json.dumps(project_data))
    else:
        # For modern format, we need to update each field
        # This is complex with Automerge, so we use the JSON string approach
        with doc.transaction() as tx:
            tx.put(ROOT, "projectJSON", ScalarType.Str, json.dumps(project_data))


def _find_or_create_layer(project_data: dict, clip_type: str, layer_id: str | None) -> dict:
    """Find an existing layer or create one for the clip type."""
    layers = project_data.setdefault("layers", [])
    
    # If layer_id specified, try to find it
    if layer_id:
        for layer in layers:
            if layer.get("id") == layer_id:
                return layer
    
    # Find a layer matching the clip type
    type_map = {
        "video": "video",
        "audio": "audio",
        "image": "image",
        "text": "text",
    }
    target_type = type_map.get(clip_type, clip_type)
    
    for layer in layers:
        if layer.get("type") == target_type:
            return layer
    
    # Create a new layer
    new_layer = {
        "id": f"layer-{uuid.uuid4().hex[:8]}",
        "name": f"{target_type.capitalize()} Layer",
        "type": target_type,
        "clips": [],
    }
    layers.append(new_layer)
    return new_layer


@tool
def addClipToTimeline(
    clip_type: str,
    start: float,
    duration: float,
    src: str | None = None,
    text: str | None = None,
    name: str | None = None,
    asset_id: str | None = None,
    layer_id: str | None = None,
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Add a new clip to the project timeline.

    Args:
        clip_type: Type of clip - "video", "audio", "image", or "text"
        start: Start time in seconds on the timeline
        duration: Duration of the clip in seconds
        src: Source URL for media clips (video, audio, image)
        text: Text content for text clips
        name: Optional name for the clip
        asset_id: Optional asset ID reference
        layer_id: Optional specific layer ID to add to
        project_id: Project ID (injected by agent)
        user_id: User ID (injected by agent)
        branch_id: Branch ID (injected by agent)

    Returns:
        Status dict with the created clip info or error message.
    """
    logger.info(
        "[ADD_CLIP] Called with: type=%s, start=%s, duration=%s, src=%s, text=%s, name=%s, "
        "asset_id=%s, layer_id=%s, project_id=%s, user_id=%s, branch_id=%s",
        clip_type, start, duration, src[:50] if src else None, text[:50] if text else None,
        name, asset_id, layer_id, project_id, user_id, branch_id
    )

    if not user_id or not project_id:
        logger.error("[ADD_CLIP] Missing user_id or project_id")
        return {
            "status": "error",
            "message": "User and project context required to modify timeline.",
        }

    if clip_type not in ("video", "audio", "image", "text"):
        return {
            "status": "error",
            "message": f"Invalid clip_type '{clip_type}'. Must be video, audio, image, or text.",
        }

    # Media clips need either src or asset_id (asset_id can be used to build proxy URL)
    if clip_type in ("video", "audio", "image") and not src and not asset_id:
        return {
            "status": "error",
            "message": f"Either source URL (src) or asset_id is required for {clip_type} clips.",
        }

    if clip_type == "text" and not text:
        return {
            "status": "error",
            "message": "Text content is required for text clips.",
        }

    if start < 0 or duration <= 0:
        return {
            "status": "error",
            "message": "Start must be >= 0 and duration must be > 0.",
        }

    settings = get_settings()
    db = get_firestore_client(settings)

    # Determine which branch to use
    use_branch_id = branch_id or "main"
    logger.info("[ADD_CLIP] Using branch: %s", use_branch_id)

    try:
        # Load the branch document
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
            logger.error("[ADD_CLIP] Branch not found: %s", use_branch_id)
            return {
                "status": "error",
                "message": f"Branch '{use_branch_id}' not found for project.",
            }

        logger.info("[ADD_CLIP] Branch document loaded")
        branch_data = branch_doc.to_dict()
        automerge_state = branch_data.get("automergeState")

        if not automerge_state:
            logger.error("[ADD_CLIP] No automergeState in branch")
            return {
                "status": "error",
                "message": "Project has no timeline data yet.",
            }

        logger.info("[ADD_CLIP] automergeState size: %d bytes", len(automerge_state))

        # Load and parse the Automerge document
        doc = _load_automerge_doc(automerge_state)
        logger.info("[ADD_CLIP] Automerge document loaded")
        
        project_data = _get_project_data(doc)
        logger.info("[ADD_CLIP] Project JSON extracted: %s", "yes" if project_data else "no")

        if not project_data:
            logger.error("[ADD_CLIP] Could not parse project timeline data")
            return {
                "status": "error",
                "message": "Could not parse project timeline data.",
            }

        # Find or create the appropriate layer
        layer = _find_or_create_layer(project_data, clip_type, layer_id)

        # Create the clip with all required base fields
        clip_id = f"clip-{uuid.uuid4().hex[:8]}"
        clip: dict[str, Any] = {
            "id": clip_id,
            "type": clip_type,
            "name": name or f"New {clip_type.capitalize()} Clip",
            "start": start,
            "duration": duration,
            "offset": 0,
            "speed": 1,
            "position": {"x": 0, "y": 0},
            "scale": {"x": 1, "y": 1},
        }

        # For media clips, use proxy URL to avoid CORS issues
        # Try to extract asset_id and filename from GCS URL if not provided directly
        effective_asset_id = asset_id
        asset_filename = None
        if src and clip_type in ("video", "audio", "image"):
            # GCS URL format: https://storage.googleapis.com/.../assets/{asset_id}/{filename}?query...
            import re
            # Extract asset_id
            asset_match = re.search(r'/assets/([a-f0-9-]{36})/', src)
            if asset_match:
                if not effective_asset_id:
                    effective_asset_id = asset_match.group(1)
                    logger.info("[ADD_CLIP] Extracted asset_id from URL: %s", effective_asset_id)
                # Extract filename (after asset_id, before query params)
                filename_match = re.search(r'/assets/[a-f0-9-]{36}/([^?]+)', src)
                if filename_match:
                    asset_filename = filename_match.group(1)
                    logger.info("[ADD_CLIP] Extracted filename from URL: %s", asset_filename)
        
        if effective_asset_id and clip_type in ("video", "audio", "image"):
            # Include filename in proxy URL for proper extension detection
            if asset_filename:
                proxy_src = f"/api/assets/{effective_asset_id}/file/{asset_filename}?projectId={project_id}&userId={user_id}"
            else:
                proxy_src = f"/api/assets/{effective_asset_id}/file?projectId={project_id}&userId={user_id}"
            clip["src"] = proxy_src
            clip["assetId"] = effective_asset_id
            logger.info("[ADD_CLIP] Using proxy URL: %s", proxy_src)
        elif src:
            clip["src"] = src
            logger.warning("[ADD_CLIP] Using raw src URL (no proxy): %s", src[:80])
        else:
            # This shouldn't happen due to validation, but log if it does
            logger.error("[ADD_CLIP] No src or asset_id for media clip")
        
        if text:
            clip["text"] = text

        # Add type-specific defaults
        if clip_type == "video":
            clip["objectFit"] = "contain"
        elif clip_type == "audio":
            clip["volume"] = 1.0
        elif clip_type == "text":
            clip["fontSize"] = 48
            clip["fill"] = "#ffffff"
            clip["opacity"] = 1.0

        # Add clip to layer
        layer.setdefault("clips", []).append(clip)
        logger.info("[ADD_CLIP] Clip added to layer %s (now has %d clips)", layer.get("id"), len(layer["clips"]))

        # Save back to Automerge document
        logger.info("[ADD_CLIP] Saving to Automerge document...")
        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)
        logger.info("[ADD_CLIP] Automerge document saved, new state size: %d bytes", len(new_state))

        # Update Firestore
        logger.info("[ADD_CLIP] Updating Firestore...")
        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
        })

        logger.info(
            "[ADD_CLIP] SUCCESS: Added clip %s to layer %s in project %s (branch %s)",
            clip_id, layer.get("id"), project_id, use_branch_id
        )

        result = {
            "status": "success",
            "message": f"Added {clip_type} clip '{clip['name']}' at {start}s for {duration}s.",
            "clip": {
                "id": clip_id,
                "type": clip_type,
                "name": clip["name"],
                "start": start,
                "duration": duration,
                "layerId": layer.get("id"),
                "layerName": layer.get("name"),
            },
        }
        logger.info("[ADD_CLIP] Returning: %s", result)
        return result

    except Exception as e:
        logger.exception("[ADD_CLIP] FAILED: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to add clip: {str(e)}",
        }
