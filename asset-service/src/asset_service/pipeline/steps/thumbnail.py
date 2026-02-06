"""Thumbnail extraction pipeline step."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ...config import get_settings
from ...storage.gcs import upload_to_gcs

logger = logging.getLogger(__name__)


@register_step(
    id="thumbnail",
    label="Extract thumbnail",
    description="Extract first frame as thumbnail image.",
    auto_start=True,
    supported_types=[AssetType.VIDEO, AssetType.IMAGE],
)
async def thumbnail_step(context: PipelineContext) -> PipelineResult:
    """Extract thumbnail (first frame for video, or use image as-is for images)."""
    settings = get_settings()
    path = Path(context.asset_path)
    if not path.exists():
        raise FileNotFoundError(f"Asset file not found: {context.asset_path}")

    object_name = f"assets/{context.asset.id}/thumbnail.jpg"

    if context.asset_type == AssetType.IMAGE:
        # For images, create a resized thumbnail (max 400px)
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                result = subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i",
                        str(path),
                        "-vf",
                        "scale='min(400,iw)':'min(400,ih)':force_original_aspect_ratio=decrease",
                        "-q:v",
                        "5",
                        tmp_path,
                    ],
                    capture_output=True,
                    timeout=30,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[:200]}")
                with open(tmp_path, "rb") as f:
                    data = f.read()
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        except FileNotFoundError:
            raise RuntimeError("ffmpeg not found. Please install ffmpeg.")
    else:
        # Video: extract first frame
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(path),
                    "-ss",
                    "0",
                    "-vframes",
                    "1",
                    "-f",
                    "image2",
                    "-q:v",
                    "5",
                    "pipe:1",
                ],
                capture_output=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[:200]}")
            data = result.stdout
        except FileNotFoundError:
            raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    if not data:
        return PipelineResult(status=StepStatus.FAILED, error="No thumbnail data produced")

    # Upload to GCS - store objectName only; signed URLs generated on-demand via API (they expire)
    upload_result = upload_to_gcs(
        data=data,
        destination=object_name,
        mime_type="image/jpeg",
        settings=settings,
    )

    logger.info(f"Thumbnail uploaded for asset {context.asset.id}")

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "objectName": object_name,
            "gcsUri": upload_result["gcs_uri"],
        },
    )
