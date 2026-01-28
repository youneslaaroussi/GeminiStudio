"""Shot detection pipeline step using Google Video Intelligence API."""

from __future__ import annotations

import logging

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
            # Try parsing as JSON
            key_data = json.loads(key_path)
            credentials = service_account.Credentials.from_service_account_info(key_data)

        return videointelligence.VideoIntelligenceServiceClient(credentials=credentials)

    return videointelligence.VideoIntelligenceServiceClient()


@register_step(
    id="shot-detection",
    label="Detect shot changes",
    description="Uses Google Video Intelligence to extract shot boundaries in the uploaded video.",
    auto_start=True,
    supported_types=[AssetType.VIDEO],
)
async def shot_detection_step(context: PipelineContext) -> PipelineResult:
    """Detect shot changes in video."""
    # Get GCS URI from upload step
    state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
    upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
    gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before shot detection")

    # Create client and request
    client = _get_video_client()

    request = videointelligence.AnnotateVideoRequest(
        input_uri=gcs_uri,
        features=[videointelligence.Feature.SHOT_CHANGE_DETECTION],
    )

    # Execute
    operation = client.annotate_video(request=request)
    result = operation.result(timeout=600)

    # Parse results
    shots = []
    if result.annotation_results:
        annotations = result.annotation_results[0]
        for index, shot in enumerate(annotations.shot_annotations or []):
            start = _time_offset_to_seconds(shot.start_time_offset)
            end = _time_offset_to_seconds(shot.end_time_offset)
            duration = max(0, end - start)
            shots.append({
                "index": index,
                "start": start,
                "end": end,
                "duration": duration,
            })

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "shotCount": len(shots),
            "shots": shots,
            "gcsUri": gcs_uri,
        },
    )
