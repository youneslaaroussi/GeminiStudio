"""Frame sampling pipeline step - extracts video frames for filmstrip and preview."""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ...config import get_settings
from ...storage.gcs import upload_to_gcs

logger = logging.getLogger(__name__)

FRAME_COUNT = 20
FRAME_HEIGHT = 120  # Height for each sampled frame (width preserves aspect)


@register_step(
    id="frame-sampling",
    label="Sample frames",
    description="Extract video frames at even intervals for preview and filmstrip.",
    auto_start=True,
    supported_types=[AssetType.VIDEO],
)
async def frame_sampling_step(context: PipelineContext) -> PipelineResult:
    """Extract frames at even intervals, upload each to GCS."""
    settings = get_settings()
    path = Path(context.asset_path)
    if not path.exists():
        raise FileNotFoundError(f"Asset file not found: {context.asset_path}")

    # Get duration from metadata step or asset
    duration = context.asset.duration
    if not duration or duration <= 0:
        from ..store import get_pipeline_state
        state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
        for s in state.get("steps", []):
            if s.get("id") == "metadata" and s.get("metadata", {}).get("duration"):
                duration = float(s["metadata"]["duration"])
                break
        if not duration or duration <= 0:
            return PipelineResult(status=StepStatus.FAILED, error="No duration available for frame sampling")

    object_names: list[str] = []

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            for i in range(FRAME_COUNT):
                ts = duration * (i + 0.5) / FRAME_COUNT
                out_path = tmp / f"frame_{i:02d}.jpg"
                r = subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-ss",
                        str(ts),
                        "-i",
                        str(path),
                        "-vframes",
                        "1",
                        "-vf",
                        f"scale=-1:{FRAME_HEIGHT}:force_original_aspect_ratio=decrease",
                        "-q:v",
                        "5",
                        str(out_path),
                    ],
                    capture_output=True,
                    timeout=15,
                )
                if r.returncode != 0:
                    logger.warning(f"Frame {i} extraction failed: {r.stderr.decode()[:200]}")
                    continue

                if not out_path.exists():
                    continue

                object_name = f"assets/{context.asset.id}/frames/frame_{i:02d}.jpg"
                with open(out_path, "rb") as f:
                    data = f.read()

                upload_to_gcs(
                    data=data,
                    destination=object_name,
                    mime_type="image/jpeg",
                    settings=settings,
                )
                object_names.append(object_name)

    except FileNotFoundError:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    if not object_names:
        return PipelineResult(status=StepStatus.FAILED, error="No frames extracted")

    # Store objectNames only - signed URLs generated on-demand via API (they expire)
    logger.info(f"Frame sampling completed for asset {context.asset.id}: {len(object_names)} frames")

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "frameCount": len(object_names),
            "duration": duration,
            "objectNames": object_names,
        },
    )
