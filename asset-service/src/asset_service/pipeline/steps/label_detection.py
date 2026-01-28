"""Label detection pipeline step using Google Video Intelligence API."""

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


def _parse_entity(entity) -> dict[str, Any]:
    """Parse a label entity."""
    return {
        "entityId": getattr(entity, "entity_id", "") or "",
        "description": getattr(entity, "description", "") or "",
        "languageCode": getattr(entity, "language_code", "en") or "en",
    }


def _parse_label_annotation(annotation) -> dict[str, Any]:
    """Parse a label annotation into our format."""
    entity = _parse_entity(annotation.entity) if annotation.entity else {}

    categories = [
        _parse_entity(cat) for cat in (annotation.category_entities or [])
    ]

    segments = []
    max_confidence = 0.0
    for seg in annotation.segments or []:
        segment_data = {
            "start": _time_offset_to_seconds(getattr(seg.segment, "start_time_offset", None)),
            "end": _time_offset_to_seconds(getattr(seg.segment, "end_time_offset", None)),
            "confidence": float(getattr(seg, "confidence", 0) or 0),
        }
        segments.append(segment_data)
        max_confidence = max(max_confidence, segment_data["confidence"])

    return {
        "entity": entity,
        "categories": categories,
        "segments": segments,
        "confidence": max_confidence,
    }


def _parse_frame_labels(frame_annotations) -> list[dict[str, Any]]:
    """Parse frame-level label annotations."""
    frame_label_map: dict[str, dict] = {}

    for annotation in frame_annotations or []:
        entity = _parse_entity(annotation.entity) if annotation.entity else {}
        description = entity.get("description", "")

        frames = []
        for frame in annotation.frames or []:
            frames.append({
                "time": _time_offset_to_seconds(frame.time_offset),
                "confidence": float(getattr(frame, "confidence", 0) or 0),
            })

        if description:
            frame_label_map[description] = {"entity": entity, "frames": frames}

    return list(frame_label_map.values())


@register_step(
    id="label-detection",
    label="Detect labels",
    description="Identifies objects, locations, activities, and more using the Video Intelligence API.",
    auto_start=True,
    supported_types=[AssetType.VIDEO],
)
async def label_detection_step(context: PipelineContext) -> PipelineResult:
    """Detect labels in video."""
    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before label detection")

    # Create client and request
    client = _get_video_client()

    label_config = videointelligence.LabelDetectionConfig(
        label_detection_mode=videointelligence.LabelDetectionMode.SHOT_AND_FRAME_MODE,
        frame_confidence_threshold=0.5,
        video_confidence_threshold=0.5,
    )

    video_context = videointelligence.VideoContext(
        label_detection_config=label_config,
    )

    request = videointelligence.AnnotateVideoRequest(
        input_uri=gcs_uri,
        features=[videointelligence.Feature.LABEL_DETECTION],
        video_context=video_context,
    )

    # Execute
    operation = client.annotate_video(request=request)
    result = operation.result(timeout=600)

    # Parse results
    segment_labels = []
    shot_labels = []
    frame_labels = []

    if result.annotation_results:
        annotations = result.annotation_results[0]

        # Segment-level labels (whole video)
        segment_labels = [
            _parse_label_annotation(ann)
            for ann in (annotations.segment_label_annotations or [])
        ]
        segment_labels.sort(key=lambda x: x["confidence"], reverse=True)

        # Shot-level labels
        shot_labels = [
            _parse_label_annotation(ann)
            for ann in (annotations.shot_label_annotations or [])
        ]
        shot_labels.sort(key=lambda x: x["confidence"], reverse=True)

        # Frame-level labels
        frame_labels = _parse_frame_labels(annotations.frame_label_annotations)

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "segmentLabelCount": len(segment_labels),
            "shotLabelCount": len(shot_labels),
            "frameLabelCount": len(frame_labels),
            "segmentLabels": segment_labels[:50],  # Limit to top 50
            "shotLabels": shot_labels[:50],
            "frameLabels": frame_labels[:30],
            "gcsUri": gcs_uri,
        },
    )
