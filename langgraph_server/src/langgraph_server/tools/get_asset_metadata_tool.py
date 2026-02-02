"""Tool to get detailed metadata for an asset (face detection, shot detection, etc.)."""

from __future__ import annotations

import logging
from typing import Literal

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)

# Define which metadata types are available from the pipeline
METADATA_TYPES = [
    "face-detection",
    "shot-detection",
    "label-detection",
    "person-detection",
    "transcription",
    "metadata",
]


@tool
def getAssetMetadata(
    asset_id: str,
    user_id: str | None = None,
    project_id: str | None = None,
    metadata_type: str | None = None,
) -> dict:
    """Get detailed metadata for an asset including face detection, shot detection, labels, transcription, and more.

    Args:
        asset_id: The ID of the asset to get metadata for.
        user_id: The user ID (injected by agent context).
        project_id: The project ID (injected by agent context).
        metadata_type: Optional filter to get specific metadata type.
            Valid values: face-detection, shot-detection, label-detection,
            person-detection, transcription, metadata.
            If not specified, returns all available metadata.
    """

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to get asset metadata.",
        }

    if not asset_id:
        return {
            "status": "error",
            "message": "asset_id is required.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    # Validate metadata_type if provided
    if metadata_type and metadata_type not in METADATA_TYPES:
        return {
            "status": "error",
            "message": f"Invalid metadata_type '{metadata_type}'. Valid types: {', '.join(METADATA_TYPES)}",
        }

    # Fetch pipeline state for the asset
    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/pipeline/{user_id}/{project_id}/{asset_id}"

    try:
        # Sign request for asset service authentication
        headers = get_asset_service_headers("")
        response = httpx.get(endpoint, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code == 404:
        return {
            "status": "error",
            "message": f"Asset '{asset_id}' not found or has no pipeline data.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        pipeline_state = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response from asset service: {exc}",
        }

    # Extract metadata from pipeline steps
    steps = pipeline_state.get("steps", [])
    metadata_results = {}
    summary_items = []

    for step in steps:
        step_id = step.get("id", "")
        step_label = step.get("label", step_id)
        step_status = step.get("status", "unknown")
        step_metadata = step.get("metadata", {})

        # Filter by type if specified
        if metadata_type and step_id != metadata_type:
            continue

        # Only include steps that have succeeded and have metadata
        if step_status == "succeeded" and step_metadata:
            metadata_results[step_id] = {
                "label": step_label,
                "status": step_status,
                "data": step_metadata,
            }

            # Build human-readable summary
            summary = _format_step_summary(step_id, step_metadata)
            if summary:
                summary_items.append({"type": "text", "text": f"**{step_label}**: {summary}"})
        elif step_status == "running":
            summary_items.append({"type": "text", "text": f"**{step_label}**: Processing..."})
        elif step_status == "failed":
            error = step.get("error", "Unknown error")
            summary_items.append({"type": "text", "text": f"**{step_label}**: Failed - {error}"})

    if not metadata_results and not summary_items:
        return {
            "status": "success",
            "outputs": [
                {"type": "text", "text": f"No metadata available for asset '{asset_id}'. Pipeline may not have run yet."},
            ],
        }

    if not summary_items:
        summary_items.append({"type": "text", "text": "No completed analysis available."})

    return {
        "status": "success",
        "outputs": [
            {
                "type": "list",
                "title": f"Metadata for asset '{asset_id}'",
                "items": summary_items,
            },
            {
                "type": "json",
                "data": {
                    "assetId": asset_id,
                    "metadata": metadata_results,
                },
            },
        ],
    }


def _format_step_summary(step_id: str, metadata: dict) -> str:
    """Format a human-readable summary for a pipeline step's metadata."""

    if step_id == "face-detection":
        face_count = metadata.get("faceCount", 0)
        return f"{face_count} face{'s' if face_count != 1 else ''} detected"

    elif step_id == "shot-detection":
        shot_count = metadata.get("shotCount", 0)
        shots = metadata.get("shots", [])
        if shots:
            # Show shot boundaries for narrative trimming (e.g. "Shots: 0.0-5.2s, 5.2-12.1s, ...")
            max_shots = 15
            parts = []
            for s in shots[:max_shots]:
                start = s.get("start", 0)
                end = s.get("end", start)
                parts.append(f"{start:.1f}-{end:.1f}s")
            shot_ranges = ", ".join(parts)
            if len(shots) > max_shots:
                shot_ranges += f", ... (+{len(shots) - max_shots} more)"
            return f"{shot_count} shot{'s' if shot_count != 1 else ''} detected. Shots: {shot_ranges}"
        return f"{shot_count} shot{'s' if shot_count != 1 else ''} detected"

    elif step_id == "label-detection":
        segment_count = metadata.get("segmentLabelCount", 0)
        shot_count = metadata.get("shotLabelCount", 0)
        frame_count = metadata.get("frameLabelCount", 0)
        return f"{segment_count} segment labels, {shot_count} shot labels, {frame_count} frame labels"

    elif step_id == "person-detection":
        person_count = metadata.get("personCount", 0)
        return f"{person_count} person{'s' if person_count != 1 else ''} detected"

    elif step_id == "transcription":
        transcript = metadata.get("transcript", "")
        word_count = len(transcript.split()) if transcript else 0
        segments = metadata.get("segments", [])
        if segments:
            # Show segment timestamps (start_sec + snippet) for narrative trimming
            max_segments = 20
            parts = []
            for seg in segments[:max_segments]:
                start_ms = seg.get("start", 0)
                start_sec = start_ms / 1000.0 if isinstance(start_ms, (int, float)) else 0
                speech = (seg.get("speech") or "")[:20].replace("'", "\\'")
                parts.append(f"{start_sec:.1f}s '{speech}'")
            seg_line = ", ".join(parts)
            if len(segments) > max_segments:
                seg_line += f", ... (+{len(segments) - max_segments} more)"
            return f"{word_count} words transcribed. Segments (start_sec, text): {seg_line}"
        return f"{word_count} words transcribed"

    elif step_id == "metadata":
        duration = metadata.get("duration")
        width = metadata.get("width")
        height = metadata.get("height")
        parts = []
        if duration:
            parts.append(f"{duration:.1f}s")
        if width and height:
            parts.append(f"{width}x{height}")
        codec = metadata.get("videoCodec")
        if codec:
            parts.append(codec)
        return ", ".join(parts) if parts else "Basic metadata extracted"

    return "Data available"
