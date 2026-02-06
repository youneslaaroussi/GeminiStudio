"""Extract audio to FLAC for Speech-to-Text.

Video/audio files may use codecs that Google Speech-to-Text does not decode
reliably (e.g. some MP4/MOV from screen recorders). Extracting to FLAC ensures
the transcription step receives a format the API handles well.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from ...metadata.ffprobe import extract_metadata
from ...storage.gcs import upload_to_gcs
from ..registry import register_step
from ..store import get_pipeline_state
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ...config import get_settings

logger = logging.getLogger(__name__)


def _has_audio_stream(file_path: Path) -> bool:
    """Check if the media file has an audio stream."""
    try:
        metadata = extract_metadata(file_path)
        return metadata.audio_codec is not None
    except Exception:
        return False


def _extract_audio_to_flac(source_path: Path, output_path: Path) -> None:
    """Extract audio to 16 kHz mono FLAC for Speech-to-Text."""
    # 16 kHz mono FLAC is well supported by Google Speech-to-Text
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-acodec",
            "flac",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(output_path),
        ],
        capture_output=True,
        timeout=300,
    )
    if result.returncode != 0:
        stderr = (result.stderr or b"").decode(errors="replace")[:500]
        raise RuntimeError(f"ffmpeg failed: {stderr}")
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("ffmpeg produced empty or missing FLAC file")


@register_step(
    id="audio-extract",
    label="Extract audio for transcription",
    description="Extract audio to FLAC so Speech-to-Text can transcribe reliably.",
    auto_start=True,
    supported_types=[AssetType.VIDEO, AssetType.AUDIO],
)
async def audio_extract_step(context: PipelineContext) -> PipelineResult:
    """Extract audio to FLAC and upload to GCS for the transcription step."""
    path = Path(context.asset_path)
    if not path.exists():
        raise FileNotFoundError(f"Asset file not found: {context.asset_path}")

    if not _has_audio_stream(path):
        logger.info(f"Asset {context.asset.id} has no audio stream, skipping audio extract")
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={"skipped": True, "reason": "no_audio"},
        )

    settings = get_settings()
    if not settings.asset_gcs_bucket:
        raise ValueError("ASSET_GCS_BUCKET must be configured")

    flac_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".flac", delete=False) as tmp:
            flac_path = Path(tmp.name)
        _extract_audio_to_flac(path, flac_path)
    except Exception as e:
        if flac_path and flac_path.exists():
            try:
                flac_path.unlink()
            except OSError:
                pass
        logger.warning(f"Audio extract failed for {context.asset.id}: {e}")
        return PipelineResult(
            status=StepStatus.FAILED,
            error=str(e),
            metadata={"skipped": False},
        )

    try:
        destination = f"assets/{context.asset.id}/audio_for_transcription.flac"
        with open(flac_path, "rb") as f:
            result = upload_to_gcs(
                data=f.read(),
                destination=destination,
                mime_type="audio/flac",
                settings=settings,
            )
        gcs_uri = result["gcs_uri"]
    finally:
        if flac_path and flac_path.exists():
            try:
                flac_path.unlink()
            except OSError:
                pass

    logger.info(f"Uploaded audio for transcription to {gcs_uri} for asset {context.asset.id}")

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "audioForTranscriptionGcsUri": gcs_uri,
            "bucket": result["bucket"],
            "objectName": result["object_name"],
        },
    )
