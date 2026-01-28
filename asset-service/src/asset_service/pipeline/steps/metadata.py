"""Metadata extraction pipeline step."""

from __future__ import annotations

import logging
from pathlib import Path

from ..registry import register_step
from ..types import PipelineContext, PipelineResult, StepStatus
from ...metadata.ffprobe import extract_metadata, determine_asset_type

logger = logging.getLogger(__name__)


@register_step(
    id="metadata",
    label="Extract metadata",
    description="Extract file metadata using ffprobe.",
    auto_start=True,
)
async def metadata_step(context: PipelineContext) -> PipelineResult:
    """Extract metadata from the asset file."""
    metadata: dict = {
        "mimeType": context.asset.mime_type,
        "size": context.asset.size,
        "uploadedAt": context.asset.uploaded_at,
        "type": determine_asset_type(context.asset.mime_type, context.asset.name),
    }

    # Extract detailed metadata using ffprobe
    try:
        path = Path(context.asset_path)
        if path.exists():
            extracted = extract_metadata(path)
            extracted_dict = extracted.to_dict()

            # Map ffprobe output to our schema
            if extracted.duration is not None:
                metadata["duration"] = extracted.duration
            if extracted.width is not None:
                metadata["width"] = extracted.width
            if extracted.height is not None:
                metadata["height"] = extracted.height
            if extracted.codec is not None:
                metadata["videoCodec"] = extracted.codec
            if extracted.audio_codec is not None:
                metadata["audioCodec"] = extracted.audio_codec
            if extracted.sample_rate is not None:
                metadata["sampleRate"] = extracted.sample_rate
            if extracted.channels is not None:
                metadata["channels"] = extracted.channels
            if extracted.bitrate is not None:
                metadata["bitrate"] = extracted.bitrate
            if extracted.format_name is not None:
                metadata["formatName"] = extracted.format_name

            # Store file size from ffprobe if available
            if extracted.size is not None:
                metadata["fileSize"] = extracted.size

    except Exception as e:
        logger.warning(f"Failed to extract ffprobe metadata: {e}")
        metadata["metadataError"] = str(e)

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata=metadata,
    )
