"""Waveform extraction pipeline step."""

from __future__ import annotations

import logging
import struct
import subprocess
from pathlib import Path

from ...metadata.ffprobe import extract_metadata
from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus

logger = logging.getLogger(__name__)

WAVEFORM_SAMPLE_COUNT = 200


def _has_audio_stream(file_path: Path) -> bool:
    """Check if the media file has an audio stream."""
    try:
        metadata = extract_metadata(file_path)
        return metadata.audio_codec is not None
    except Exception:
        return False


def _extract_audio_peaks(file_path: Path, duration: float) -> tuple[list[float], float]:
    """Extract peak amplitude samples from audio using ffmpeg."""
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(file_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "8000",
                "-f",
                "s16le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=60,
        )
    except FileNotFoundError:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[:200]}")

    raw = result.stdout
    if len(raw) < 2:
        return ([0.0] * WAVEFORM_SAMPLE_COUNT, duration)

    # Parse s16le: 2 bytes per sample, little-endian
    samples = struct.unpack(f"<{len(raw) // 2}h", raw)
    if not samples:
        return ([0.0] * WAVEFORM_SAMPLE_COUNT, duration)

    # Normalize to 0-1 range (s16 range is -32768 to 32767)
    max_val = max(abs(s) for s in samples) or 1
    normalized = [abs(s) / max_val for s in samples]

    # Downsample to WAVEFORM_SAMPLE_COUNT peaks (take max in each bucket)
    step = max(1, len(normalized) // WAVEFORM_SAMPLE_COUNT)
    peaks: list[float] = []
    for i in range(WAVEFORM_SAMPLE_COUNT):
        start = i * step
        end = min(start + step, len(normalized))
        if start < len(normalized):
            bucket = normalized[start:end]
            peaks.append(max(bucket) if bucket else 0.0)
        else:
            peaks.append(0.0)

    return (peaks, duration)


@register_step(
    id="waveform",
    label="Extract waveform",
    description="Extract audio waveform peak data.",
    auto_start=True,
    supported_types=[AssetType.VIDEO, AssetType.AUDIO],
)
async def waveform_step(context: PipelineContext) -> PipelineResult:
    """Extract waveform peak samples from video/audio."""
    path = Path(context.asset_path)
    if not path.exists():
        raise FileNotFoundError(f"Asset file not found: {context.asset_path}")

    # Get duration
    duration = context.asset.duration
    if not duration or duration <= 0:
        from ..store import get_pipeline_state
        state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
        for s in state.get("steps", []):
            if s.get("id") == "metadata" and s.get("metadata", {}).get("duration"):
                duration = float(s["metadata"]["duration"])
                break
        if not duration or duration <= 0:
            return PipelineResult(status=StepStatus.FAILED, error="No duration available for waveform")

    # Skip extraction for assets without audio - return silent waveform
    if not _has_audio_stream(path):
        logger.info(f"Asset {context.asset.id} has no audio stream, returning silent waveform")
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={
                "samples": [0.0] * WAVEFORM_SAMPLE_COUNT,
                "duration": duration,
            },
        )

    try:
        samples, actual_duration = _extract_audio_peaks(path, duration)
    except Exception as e:
        return PipelineResult(status=StepStatus.FAILED, error=str(e))

    logger.info(f"Waveform extracted for asset {context.asset.id}: {len(samples)} samples")

    # Waveform data stored in pipeline step metadata (Firestore)
    # Frontend reads from pipeline state via Firestore real-time listeners
    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "samples": samples,
            "duration": actual_duration,
        },
    )
