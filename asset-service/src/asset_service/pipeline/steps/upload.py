"""Cloud upload pipeline step."""

from __future__ import annotations

import logging
from pathlib import Path

from ..registry import register_step
from ..types import PipelineContext, PipelineResult, StepStatus
from ...config import get_settings
from ...storage.gcs import upload_to_gcs, create_signed_url

logger = logging.getLogger(__name__)


@register_step(
    id="cloud-upload",
    label="Upload to Cloud Storage",
    description="Copies the original asset into the configured GCS bucket.",
    auto_start=True,
)
async def upload_step(context: PipelineContext) -> PipelineResult:
    """Upload asset to Google Cloud Storage.

    Note: Since we now upload immediately during asset creation,
    this step will typically just verify the existing upload.
    """
    settings = get_settings()

    if not settings.asset_gcs_bucket:
        raise ValueError("ASSET_GCS_BUCKET must be configured")

    # Check if already uploaded (from immediate upload during creation)
    existing_gcs_uri = context.params.get("gcsUri")
    existing_object_name = context.params.get("objectName")
    existing_bucket = context.params.get("bucket")

    if existing_gcs_uri and existing_object_name:
        # Already uploaded, just refresh the signed URL
        signed_url = create_signed_url(
            object_name=existing_object_name,
            bucket=existing_bucket or settings.asset_gcs_bucket,
            settings=settings,
        )
        logger.info(f"Asset already in GCS: {existing_gcs_uri}")
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={
                "gcsUri": existing_gcs_uri,
                "signedUrl": signed_url,
                "bucket": existing_bucket or settings.asset_gcs_bucket,
                "objectName": existing_object_name,
            },
        )

    # Need to upload - read the file
    path = Path(context.asset_path)
    if not path.exists():
        raise FileNotFoundError(f"Asset file not found: {context.asset_path}")

    with open(path, "rb") as f:
        data = f.read()

    # Upload to GCS
    object_name = f"assets/{context.asset.id}/{context.asset.file_name}"
    result = upload_to_gcs(
        data=data,
        destination=object_name,
        mime_type=context.asset.mime_type,
        settings=settings,
    )

    # Generate signed URL
    signed_url = create_signed_url(
        object_name=result["object_name"],
        bucket=result["bucket"],
        settings=settings,
    )

    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={
            "gcsUri": result["gcs_uri"],
            "signedUrl": signed_url,
            "bucket": result["bucket"],
            "objectName": result["object_name"],
        },
    )
