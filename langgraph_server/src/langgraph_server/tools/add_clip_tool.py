"""Tool to add a clip to the timeline (modifies Automerge state server-side)."""

from __future__ import annotations

import base64
import json
import logging
import time
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client, decode_automerge_state, ensure_main_branch_exists

logger = logging.getLogger(__name__)

ADD_CLIP_TRANSITION_TYPES = (
    "fade", "slide-left", "slide-right", "slide-up", "slide-down",
    "cross-dissolve", "zoom", "blur", "dip-to-black",
)


def _parse_transition(param: str | None) -> dict | None:
    """Parse transition JSON. Returns dict or None if invalid."""
    if not param:
        return None
    try:
        t = json.loads(param) if isinstance(param, str) else param
        if isinstance(t, dict):
            tt = t.get("type")
            if tt in ADD_CLIP_TRANSITION_TYPES:
                dur = t.get("duration", 0.5)
                if isinstance(dur, (int, float)) and 0.1 <= dur <= 5:
                    return {"type": tt, "duration": float(dur)}
    except (json.JSONDecodeError, TypeError):
        pass
    return None


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
    clip_type: str | None = None,
    start: float = 0,
    duration: float | None = None,
    offset: float = 0,
    text: str | None = None,
    name: str | None = None,
    template: str | None = None,
    subtitle: str | None = None,
    backgroundColor: str | None = None,
    enter_transition: str | None = None,
    exit_transition: str | None = None,
    asset_id: str | None = None,
    layer_id: str | None = None,
    _agent_context: dict | None = None,
) -> dict:
    """Add a new clip to the project timeline.

    For media clips (video/audio/image), provide asset_id - type and duration will be auto-detected.
    Use offset and duration to trim: e.g. offset=30, duration=20 uses seconds 30-50 of the source.
    For text clips, provide clip_type='text' and text content. Use template (text|title-card|lower-third|caption-style),
    subtitle, and backgroundColor for text clip styling. Use enter_transition and exit_transition (JSON: {"type":"fade","duration":0.5})
    for in/out effects. Types: fade, slide-left, slide-right, slide-up, slide-down, zoom, dip-to-black.

    Args:
        clip_type: Type of clip - "video", "audio", "image", or "text". Optional for media clips if asset_id is provided.
        start: Start time in seconds on the timeline (defaults to 0)
        duration: Duration of the clip in seconds. Optional - defaults to asset duration or 5s for images.
        offset: Start time in seconds within the source media (defaults to 0). Use with duration to trim to a segment.
        text: Text content for text clips
        name: Optional name for the clip
        template: For text clips: text, title-card, lower-third, or caption-style
        subtitle: For text clips with title-card or lower-third template
        backgroundColor: For text clips with background (e.g. rgba(0,0,0,0.8))
        enter_transition: Optional JSON {"type":"fade","duration":0.5} for in transition
        exit_transition: Optional JSON {"type":"fade","duration":0.5} for out transition
        asset_id: Asset ID for media clips - used to get the media source URL
        layer_id: Optional specific layer ID to add to

    Returns:
        Status dict with the created clip info or error message.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    logger.info(
        "[ADD_CLIP] Called with: type=%s, start=%s, duration=%s, offset=%s, text=%s, name=%s, "
        "template=%s, asset_id=%s, layer_id=%s, project_id=%s, user_id=%s, branch_id=%s",
        clip_type, start, duration, offset, text[:50] if text else None,
        name, template, asset_id, layer_id, project_id, user_id, branch_id
    )

    if not user_id or not project_id:
        logger.error("[ADD_CLIP] Missing user_id or project_id")
        return {
            "status": "error",
            "message": "User and project context required to modify timeline.",
        }

    # Initialize settings and Firestore client
    settings = get_settings()
    db = get_firestore_client(settings)

    # Resolve clip_type and duration from asset metadata if asset_id is provided
    resolved_type = clip_type
    resolved_duration = duration
    asset_filename = None
    asset_duration = None

    if asset_id:
        # Fetch asset metadata from Firestore
        asset_ref = (
            db.collection("users")
            .document(user_id)
            .collection("projects")
            .document(project_id)
            .collection("assets")
            .document(asset_id)
        )
        asset_doc = asset_ref.get()
        
        if asset_doc.exists:
            asset_data = asset_doc.to_dict()
            logger.info("[ADD_CLIP] Asset metadata: %s", {k: v for k, v in asset_data.items() if k != "signedUrl"})
            
            # Infer type from asset if not provided
            if not resolved_type:
                asset_type = asset_data.get("type", "").lower()
                if asset_type in ("video", "audio", "image"):
                    resolved_type = asset_type
                    logger.info("[ADD_CLIP] Inferred clip_type from asset: %s", resolved_type)
            
            # Get duration from asset if not provided
            if not resolved_duration and asset_data.get("duration"):
                resolved_duration = asset_data["duration"]
                logger.info("[ADD_CLIP] Using asset duration: %s", resolved_duration)

            asset_duration = asset_data.get("duration")

            # Get filename for proxy URL
            asset_filename = asset_data.get("name") or asset_data.get("fileName")
        else:
            logger.warning("[ADD_CLIP] Asset not found: %s", asset_id)

    # Reject explicit zero or negative duration before applying defaults
    if duration is not None and duration <= 0:
        return {
            "status": "error",
            "message": "Duration must be greater than 0.",
        }

    # Default duration for images
    if not resolved_duration:
        resolved_duration = 5 if resolved_type == "image" else 10

    # Validate resolved values
    if resolved_type and resolved_type not in ("video", "audio", "image", "text"):
        return {
            "status": "error",
            "message": f"Invalid clip_type '{resolved_type}'. Must be video, audio, image, or text.",
        }

    # Media clips need asset_id
    if resolved_type in ("video", "audio", "image") and not asset_id:
        return {
            "status": "error",
            "message": f"asset_id is required for {resolved_type} clips.",
        }

    # Text clips need type and text
    if not resolved_type:
        return {
            "status": "error",
            "message": "Could not determine clip type. Provide 'clip_type' or a valid 'asset_id'.",
        }

    if resolved_type == "text" and not text:
        return {
            "status": "error",
            "message": "Text content is required for text clips.",
        }

    if start < 0 or resolved_duration <= 0:
        return {
            "status": "error",
            "message": "Start must be >= 0 and duration must be > 0.",
        }

    # offset only applies to video/audio (trim to segment); images use 0
    source_offset = offset if resolved_type in ("video", "audio") else 0
    if source_offset < 0:
        return {
            "status": "error",
            "message": "Offset must be >= 0 (start time within source media in seconds).",
        }
    if asset_duration is not None and source_offset + resolved_duration > asset_duration:
        return {
            "status": "error",
            "message": f"Segment (offset={source_offset}s, duration={resolved_duration}s) extends past source duration ({asset_duration}s).",
        }

    # Get settings and db client (may already be initialized above)
    try:
        settings
    except NameError:
        settings = get_settings()
    try:
        db
    except NameError:
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

        # If branch doesn't exist and it's "main", create it with empty timeline
        if not branch_doc.exists:
            if use_branch_id == "main":
                logger.info("[ADD_CLIP] Main branch not found, creating with empty timeline")
                automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
                # Re-fetch the branch document
                branch_doc = branch_ref.get()
            else:
                logger.error("[ADD_CLIP] Branch not found: %s", use_branch_id)
                return {
                    "status": "error",
                    "message": f"Branch '{use_branch_id}' not found for project.",
                }

        logger.info("[ADD_CLIP] Branch document loaded")
        branch_data = branch_doc.to_dict()
        automerge_state = branch_data.get("automergeState")

        if not automerge_state:
            # Try to initialize if it's the main branch
            if use_branch_id == "main":
                logger.info("[ADD_CLIP] Main branch has no automergeState, initializing")
                automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
            else:
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
        layer = _find_or_create_layer(project_data, resolved_type, layer_id)

        # Create the clip with all required base fields
        clip_id = f"clip-{uuid.uuid4().hex[:8]}"
        clip: dict[str, Any] = {
            "id": clip_id,
            "type": resolved_type,
            "name": name or f"New {resolved_type.capitalize()} Clip",
            "start": start,
            "duration": resolved_duration,
            "offset": source_offset,
            "speed": 1,
            "position": {"x": 0, "y": 0},
            "scale": {"x": 1, "y": 1},
        }

        # For media clips, build proxy URL from asset_id
        if asset_id and resolved_type in ("video", "audio", "image"):
            # Build proxy URL - include filename for proper extension detection
            if asset_filename:
                from urllib.parse import quote
                proxy_src = f"/api/assets/{asset_id}/file/{quote(asset_filename)}?projectId={project_id}&userId={user_id}"
            else:
                proxy_src = f"/api/assets/{asset_id}/file?projectId={project_id}&userId={user_id}"
            clip["src"] = proxy_src
            clip["assetId"] = asset_id
            logger.info("[ADD_CLIP] Using proxy URL: %s", proxy_src)
        
        if text:
            clip["text"] = text

        # Add text template fields for text clips
        if resolved_type == "text":
            if template and template in ("text", "title-card", "lower-third", "caption-style"):
                clip["template"] = template
            if subtitle is not None:
                clip["subtitle"] = subtitle
            if backgroundColor is not None:
                clip["backgroundColor"] = backgroundColor

        # Add enter/exit transitions
        enter_t = _parse_transition(enter_transition)
        if enter_t:
            clip["enterTransition"] = enter_t
        exit_t = _parse_transition(exit_transition)
        if exit_t:
            clip["exitTransition"] = exit_t

        # Add type-specific defaults
        if resolved_type == "video":
            clip["objectFit"] = "contain"
        elif resolved_type == "audio":
            clip["volume"] = 1.0
        elif resolved_type == "text":
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
            "timestamp": int(time.time() * 1000),
        })

        logger.info(
            "[ADD_CLIP] SUCCESS: Added clip %s to layer %s in project %s (branch %s)",
            clip_id, layer.get("id"), project_id, use_branch_id
        )

        result = {
            "status": "success",
            "message": f"Added {resolved_type} clip '{clip['name']}' at {start}s for {resolved_duration}s."
            + (f" (source segment {source_offset}s–{source_offset + resolved_duration}s)" if source_offset else ""),
            "clip": {
                "id": clip_id,
                "type": resolved_type,
                "name": clip["name"],
                "start": start,
                "duration": resolved_duration,
                "offset": source_offset,
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
