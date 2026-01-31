"""Person detection pipeline step using Google Video Intelligence API."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from google.cloud import videointelligence_v1 as videointelligence
from google.oauth2 import service_account

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state
from ...config import get_settings

logger = logging.getLogger(__name__)


def _time_offset_to_seconds(offset) -> float:
    """Convert protobuf duration to seconds."""
    if offset is None:
        return 0.0
    seconds = getattr(offset, "seconds", 0) or 0
    nanos = getattr(offset, "nanos", 0) or 0
    return float(seconds) + float(nanos) / 1_000_000_000


def _get_video_client():
    """Get Video Intelligence client with credentials."""
    settings = get_settings()
    key_path = settings.google_service_account_key or settings.firebase_service_account_key

    if key_path:
        from pathlib import Path
        import json

        path = Path(key_path).expanduser()
        if path.exists():
            credentials = service_account.Credentials.from_service_account_file(str(path))
        else:
            key_data = json.loads(key_path)
            credentials = service_account.Credentials.from_service_account_info(key_data)

        return videointelligence.VideoIntelligenceServiceClient(credentials=credentials)

    return videointelligence.VideoIntelligenceServiceClient()


def _parse_bounding_box(box) -> dict[str, float]:
    """Parse a normalized bounding box."""
    return {
        "left": float(getattr(box, "left", 0) or 0),
        "top": float(getattr(box, "top", 0) or 0),
        "right": float(getattr(box, "right", 0) or 0),
        "bottom": float(getattr(box, "bottom", 0) or 0),
    }


def _parse_landmark(landmark) -> dict[str, Any]:
    """Parse a pose landmark."""
    point = getattr(landmark, "point", None)
    return {
        "name": getattr(landmark, "name", "") or "",
        "x": float(getattr(point, "x", 0) or 0) if point else 0,
        "y": float(getattr(point, "y", 0) or 0) if point else 0,
        "confidence": float(getattr(landmark, "confidence", 0) or 0),
    }


def _parse_attribute(attr) -> dict[str, Any]:
    """Parse a person attribute."""
    return {
        "name": getattr(attr, "name", "") or "",
        "value": getattr(attr, "value", "") or "",
        "confidence": float(getattr(attr, "confidence", 0) or 0),
    }


def _parse_timestamped_object(obj) -> dict[str, Any]:
    """Parse a timestamped person detection."""
    box = getattr(obj, "normalized_bounding_box", None)
    return {
        "time": _time_offset_to_seconds(obj.time_offset),
        "boundingBox": _parse_bounding_box(box) if box else {"left": 0, "top": 0, "right": 0, "bottom": 0},
        "landmarks": [_parse_landmark(lm) for lm in (getattr(obj, "landmarks", []) or [])],
        "attributes": [_parse_attribute(attr) for attr in (getattr(obj, "attributes", []) or [])],
    }


@register_step(
    id="person-detection",
    label="Detect people",
    description="Detects people with body landmarks and attributes using the Video Intelligence API.",
    auto_start=True,
    supported_types=[AssetType.VIDEO],
)
async def person_detection_step(context: PipelineContext) -> PipelineResult:
    """Detect people in video."""
    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before person detection")

    # Create client and request
    client = _get_video_client()

    person_config = videointelligence.PersonDetectionConfig(
        include_bounding_boxes=True,
        include_pose_landmarks=True,
        include_attributes=True,
    )

    video_context = videointelligence.VideoContext(
        person_detection_config=person_config,
    )

    request = videointelligence.AnnotateVideoRequest(
        input_uri=gcs_uri,
        features=[videointelligence.Feature.PERSON_DETECTION],
        video_context=video_context,
    )

    # Execute in thread pool to avoid blocking the event loop
    operation = client.annotate_video(request=request)
    result = await asyncio.to_thread(operation.result, 600)

    # Parse results
    people = []
    person_index = 0

    if result.annotation_results:
        annotations = result.annotation_results[0]

        for annotation in annotations.person_detection_annotations or []:
            for track in annotation.tracks or []:
                segment = track.segment
                start_time = _time_offset_to_seconds(getattr(segment, "start_time_offset", None))
                end_time = _time_offset_to_seconds(getattr(segment, "end_time_offset", None))
                confidence = float(getattr(track, "confidence", 0) or 0)

                timestamped_objects = [
                    _parse_timestamped_object(obj)
                    for obj in (track.timestamped_objects or [])
                ]

                people.append({
                    "personIndex": person_index,
                    "startTime": start_time,
                    "endTime": end_time,
                    "confidence": confidence,
                    "timestampedObjects": timestamped_objects,
                    "firstAppearance": timestamped_objects[0] if timestamped_objects else None,
                })
                person_index += 1

    # Sort by start time
    people.sort(key=lambda p: p["startTime"])

    # Collect all unique attributes
    all_attributes: dict[str, set] = {}
    for person in people:
        for obj in person.get("timestampedObjects", []):
            for attr in obj.get("attributes", []):
                name = attr.get("name", "")
                value = attr.get("value", "")
                if name:
                    if name not in all_attributes:
                        all_attributes[name] = set()
                    if value:
                        all_attributes[name].add(value)

    attribute_summary = [
        {"name": name, "values": list(values)}
        for name, values in all_attributes.items()
    ]

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "personCount": len(people),
            "people": people[:50],  # Limit to 50 tracks
            "attributeSummary": attribute_summary,
            "gcsUri": gcs_uri,
        },
    )
