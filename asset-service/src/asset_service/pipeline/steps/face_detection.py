"""Face detection pipeline step using Google Video Intelligence API."""

from __future__ import annotations

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


def _summarize_face_annotation(annotation, index: int) -> dict[str, Any]:
    """Summarize a face detection annotation."""
    tracks = list(annotation.tracks or [])

    # Get attributes from first track's first timestamped object
    attributes = []
    if tracks:
        first_track = tracks[0]
        timestamped_objects = list(first_track.timestamped_objects or [])
        if timestamped_objects:
            first_obj = timestamped_objects[0]
            attributes = [
                getattr(attr, "name", "") or ""
                for attr in (getattr(first_obj, "attributes", []) or [])
            ]

    # Extract all timestamped objects with bounding boxes
    all_timestamped_boxes = []
    for track in tracks:
        for obj in (track.timestamped_objects or []):
            box = getattr(obj, "normalized_bounding_box", None)
            if box:
                time_offset = getattr(obj, "time_offset", None)
                all_timestamped_boxes.append({
                    "time": _time_offset_to_seconds(time_offset),
                    "boundingBox": _parse_bounding_box(box),
                })

    # Get segments
    segments = []
    for track in tracks:
        segment = getattr(track, "segment", None)
        if segment:
            segments.append({
                "start": _time_offset_to_seconds(getattr(segment, "start_time_offset", None)),
                "end": _time_offset_to_seconds(getattr(segment, "end_time_offset", None)),
            })

    # Get first appearance
    first_box = all_timestamped_boxes[0] if all_timestamped_boxes else None

    return {
        "faceIndex": index,
        "trackCount": len(tracks),
        "attributes": attributes,
        "segments": segments,
        "timestampedBoxes": all_timestamped_boxes,
        "firstAppearance": {
            "time": first_box["time"],
            "boundingBox": first_box["boundingBox"],
        } if first_box else None,
    }


@register_step(
    id="face-detection",
    label="Detect faces",
    description="Analyzes the video for faces using the Video Intelligence API.",
    auto_start=True,
    supported_types=[AssetType.VIDEO],
)
async def face_detection_step(context: PipelineContext) -> PipelineResult:
    """Detect faces in video."""
    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before face detection")

    # Create client and request
    client = _get_video_client()

    face_config = videointelligence.FaceDetectionConfig(
        include_attributes=True,
        include_bounding_boxes=True,
    )

    video_context = videointelligence.VideoContext(
        face_detection_config=face_config,
    )

    request = videointelligence.AnnotateVideoRequest(
        input_uri=gcs_uri,
        features=[videointelligence.Feature.FACE_DETECTION],
        video_context=video_context,
    )

    # Execute
    operation = client.annotate_video(request=request)
    result = operation.result(timeout=600)

    # Parse results
    faces = []
    if result.annotation_results:
        annotations = result.annotation_results[0]
        face_annotations = annotations.face_detection_annotations or []
        faces = [
            _summarize_face_annotation(ann, i)
            for i, ann in enumerate(face_annotations)
        ]

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "faceCount": len(faces),
            "faces": faces,
            "gcsUri": gcs_uri,
        },
    )
