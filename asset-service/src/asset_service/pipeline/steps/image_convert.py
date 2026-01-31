"""Image conversion pipeline step using CloudConvert API.

Converts unsupported image formats (HEIC, HEIF) to PNG for broader compatibility.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import Any

import httpx

from ..registry import register_step
from ..store import update_pipeline_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ...cloudconvert import (
    convert_file,
    ConversionJob,
    ConversionJobStatus,
    save_conversion_job,
    find_latest_conversion_job_for_asset,
    update_conversion_job,
)
from ...config import get_settings
from ...metadata.ffprobe import extract_metadata
from ...storage.gcs import create_signed_url, upload_to_gcs, download_from_gcs
from ...storage.firestore import update_asset

logger = logging.getLogger(__name__)

# Formats that need conversion
FORMATS_TO_CONVERT = {
    "heic": "png",
    "heif": "png",
}

# MIME types that trigger conversion
MIME_TYPES_TO_CONVERT = {
    "image/heic": ("heic", "png"),
    "image/heif": ("heif", "png"),
    "image/heic-sequence": ("heic", "png"),
    "image/heif-sequence": ("heif", "png"),
}


def _needs_conversion(mime_type: str | None, filename: str | None) -> tuple[str, str] | None:
    """
    Check if an image needs conversion.
    
    Returns:
        Tuple of (input_format, output_format) if conversion needed, None otherwise.
    """
    # Check MIME type first
    if mime_type and mime_type.lower() in MIME_TYPES_TO_CONVERT:
        return MIME_TYPES_TO_CONVERT[mime_type.lower()]
    
    # Fall back to extension check
    if filename:
        ext = os.path.splitext(filename.lower())[1].lstrip(".")
        if ext in FORMATS_TO_CONVERT:
            return (ext, FORMATS_TO_CONVERT[ext])
    
    return None


def _output_filename(original_name: str, output_format: str) -> str:
    """Generate output filename with new extension."""
    base = os.path.splitext(original_name or "image")[0]
    return f"{base}.{output_format}"


async def _download_and_upload_to_gcs(
    download_url: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    filename: str,
    mime_type: str,
) -> tuple[str, str, str]:
    """
    Download converted file from CloudConvert and upload to GCS.
    
    Returns:
        Tuple of (gcs_uri, object_name, signed_url)
    """
    settings = get_settings()
    
    # Download the converted file
    async with httpx.AsyncClient() as client:
        response = await client.get(download_url, timeout=120.0)
        response.raise_for_status()
        content = response.content
    
    # Upload to GCS
    object_name = f"{user_id}/{project_id}/converted/{asset_id}/{filename}"
    gcs_uri = f"gs://{settings.asset_gcs_bucket}/{object_name}"
    
    await asyncio.to_thread(
        upload_to_gcs,
        content,
        object_name,
        mime_type,
        settings,
    )
    
    # Create signed URL
    signed_url = create_signed_url(object_name, settings=settings)
    
    logger.info(f"Uploaded converted file to {gcs_uri}")
    return gcs_uri, object_name, signed_url


async def _reextract_and_save_metadata(
    user_id: str,
    project_id: str,
    asset_id: str,
    converted_gcs_uri: str,
) -> dict[str, Any] | None:
    """
    Re-extract metadata from converted file and update asset + pipeline step.
    
    This fixes dimension extraction failures on HEIC files by re-running
    ffprobe on the converted PNG.
    
    Returns:
        Extracted metadata dict if successful, None otherwise.
    """
    import tempfile
    
    settings = get_settings()
    
    try:
        # Download converted file
        logger.info(f"[image-convert] Downloading converted file for metadata re-extraction: {converted_gcs_uri}")
        content = await asyncio.to_thread(download_from_gcs, converted_gcs_uri, settings)
        
        # Write to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
            tmp.write(content)
            temp_path = tmp.name
        
        try:
            # Extract metadata using ffprobe
            extracted = extract_metadata(temp_path)
            
            # Build metadata update dict
            metadata_updates: dict[str, Any] = {}
            if extracted.width is not None:
                metadata_updates["width"] = extracted.width
            if extracted.height is not None:
                metadata_updates["height"] = extracted.height
            if extracted.size is not None:
                metadata_updates["fileSize"] = extracted.size
            
            if metadata_updates:
                # Update asset document
                await asyncio.to_thread(
                    update_asset, user_id, project_id, asset_id, metadata_updates, settings
                )
                logger.info(
                    f"[image-convert] Updated asset {asset_id} with re-extracted metadata: "
                    f"width={metadata_updates.get('width')}, height={metadata_updates.get('height')}"
                )
                
                # Also update the metadata pipeline step
                await update_pipeline_step(
                    user_id,
                    project_id,
                    asset_id,
                    "metadata",
                    {
                        "id": "metadata",
                        "label": "Extract metadata",
                        "status": "succeeded",
                        "metadata": {
                            **metadata_updates,
                            "reextractedAfterConversion": True,
                        },
                        "updatedAt": datetime.utcnow().isoformat() + "Z",
                    },
                )
            
            return metadata_updates
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        logger.warning(f"[image-convert] Failed to re-extract metadata after conversion: {e}")
        return None


async def _update_asset_with_converted_file(
    user_id: str,
    project_id: str,
    asset_id: str,
    original_gcs_uri: str,
    original_object_name: str,
    original_signed_url: str | None,
    original_mime_type: str,
    converted_gcs_uri: str,
    converted_object_name: str,
    converted_signed_url: str,
    converted_filename: str,
    output_format: str,
) -> None:
    """Update asset document to point to converted file, backing up original."""
    settings = get_settings()
    
    # Determine new mime type
    mime_map = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
    }
    new_mime_type = mime_map.get(output_format.lower(), f"image/{output_format}")
    
    updates = {
        # Backup original
        "originalGcsUri": original_gcs_uri,
        "originalObjectName": original_object_name,
        "originalSignedUrl": original_signed_url,
        "originalMimeType": original_mime_type,
        # Set converted as primary
        "gcsUri": converted_gcs_uri,
        "objectName": converted_object_name,
        "signedUrl": converted_signed_url,
        "mimeType": new_mime_type,
        "name": converted_filename,
        "fileName": converted_filename,
        # Mark as converted
        "converted": True,
        "convertedAt": datetime.utcnow().isoformat() + "Z",
    }
    
    await asyncio.to_thread(update_asset, user_id, project_id, asset_id, updates, settings)
    logger.info(f"Updated asset {asset_id} with converted file")


@register_step(
    id="image-convert",
    label="Convert image",
    description="Convert HEIC/HEIF images to PNG for compatibility.",
    auto_start=True,
    supported_types=[AssetType.IMAGE],
)
async def image_convert_step(context: PipelineContext) -> PipelineResult:
    """
    Convert image format if needed.
    
    Currently converts:
    - HEIC → PNG
    - HEIF → PNG
    """
    logger.info(f"[image-convert] Starting for asset {context.asset.id} (mime: {context.asset.mime_type}, name: {context.asset.name})")
    settings = get_settings()
    
    # Check if CloudConvert is configured
    if not settings.cloudconvert_api_key:
        logger.info("[image-convert] CloudConvert API key not configured, skipping")
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={"message": "CloudConvert not configured, skipping conversion"},
        )
    
    # Check if conversion is needed
    conversion = _needs_conversion(context.asset.mime_type, context.asset.file_name)
    logger.info(f"[image-convert] Needs conversion check: mime={context.asset.mime_type}, file={context.asset.file_name}, result={conversion}")
    if not conversion:
        logger.info("[image-convert] No conversion needed, skipping")
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={"message": "No conversion needed", "format": context.asset.mime_type},
        )
    
    input_format, output_format = conversion
    logger.info(f"Converting {context.asset.name} from {input_format} to {output_format}")
    
    # Check for existing completed conversion
    existing_job = await find_latest_conversion_job_for_asset(
        context.user_id,
        context.project_id,
        context.asset.id,
        output_format=output_format,
    )
    
    if existing_job and existing_job.status == "completed":
        logger.info(f"Using existing conversion job {existing_job.id}")
        
        # Update asset if not already done
        if not getattr(context.asset, "converted", False):
            await _update_asset_with_converted_file(
                user_id=context.user_id,
                project_id=context.project_id,
                asset_id=context.asset.id,
                original_gcs_uri=context.asset.gcs_uri or "",
                original_object_name=context.asset.object_name or "",
                original_signed_url=context.asset.signed_url,
                original_mime_type=context.asset.mime_type,
                converted_gcs_uri=existing_job.output_gcs_uri or "",
                converted_object_name=existing_job.output_gcs_uri.replace(f"gs://{settings.asset_gcs_bucket}/", "") if existing_job.output_gcs_uri else "",
                converted_signed_url=existing_job.output_signed_url or "",
                converted_filename=existing_job.output_file_name or _output_filename(context.asset.name, output_format),
                output_format=output_format,
            )
        
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={
                "message": "Conversion completed (cached)",
                "jobId": existing_job.id,
                "inputFormat": input_format,
                "outputFormat": output_format,
                "outputGcsUri": existing_job.output_gcs_uri,
                "outputSignedUrl": existing_job.output_signed_url,
            },
        )
    
    # Need to run conversion
    # Get signed URL for input file
    input_signed_url = context.asset.signed_url
    if not input_signed_url and context.asset.object_name:
        input_signed_url = create_signed_url(context.asset.object_name, settings=settings)
    
    if not input_signed_url:
        return PipelineResult(
            status=StepStatus.FAILED,
            metadata={"message": "No signed URL available for input file"},
            error="Cannot convert: no signed URL for input file",
        )
    
    # Create job record
    now = datetime.utcnow().isoformat() + "Z"
    job = ConversionJob(
        id=str(uuid.uuid4()),
        asset_id=context.asset.id,
        asset_name=context.asset.name,
        file_name=context.asset.file_name,
        mime_type=context.asset.mime_type,
        input_format=input_format,
        output_format=output_format,
        input_gcs_uri=context.asset.gcs_uri or "",
        output_gcs_uri=None,
        output_signed_url=None,
        output_file_name=None,
        status="processing",
        cloudconvert_job_id=None,
        config={"inputFormat": input_format, "outputFormat": output_format},
        error=None,
        created_at=now,
        updated_at=now,
        user_id=context.user_id,
        project_id=context.project_id,
    )
    await save_conversion_job(job)
    
    try:
        # Run conversion via CloudConvert
        output_filename = _output_filename(context.asset.name, output_format)
        
        result = await convert_file(
            input_url=input_signed_url,
            input_format=input_format,
            output_format=output_format,
            filename=output_filename,
            options={"strip": True},  # Remove metadata
        )
        
        if result.status == ConversionJobStatus.ERROR:
            await update_conversion_job(
                context.user_id,
                context.project_id,
                job.id,
                {"status": "error", "error": result.error, "updated_at": datetime.utcnow().isoformat() + "Z"},
            )
            return PipelineResult(
                status=StepStatus.FAILED,
                metadata={
                    "message": "Conversion failed",
                    "jobId": job.id,
                    "error": result.error,
                },
                error=result.error,
            )
        
        if not result.output_url:
            await update_conversion_job(
                context.user_id,
                context.project_id,
                job.id,
                {"status": "error", "error": "No output URL", "updated_at": datetime.utcnow().isoformat() + "Z"},
            )
            return PipelineResult(
                status=StepStatus.FAILED,
                metadata={"message": "Conversion completed but no output URL"},
                error="No output URL from CloudConvert",
            )
        
        # Download from CloudConvert and upload to our GCS
        actual_filename = result.output_filename or output_filename
        gcs_uri, object_name, signed_url = await _download_and_upload_to_gcs(
            download_url=result.output_url,
            user_id=context.user_id,
            project_id=context.project_id,
            asset_id=context.asset.id,
            filename=actual_filename,
            mime_type=f"image/{output_format}",
        )
        
        # Update job record
        await update_conversion_job(
            context.user_id,
            context.project_id,
            job.id,
            {
                "status": "completed",
                "output_gcs_uri": gcs_uri,
                "output_signed_url": signed_url,
                "output_file_name": actual_filename,
                "cloudconvert_job_id": result.job_id,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
        )
        
        # Update asset to use converted file
        await _update_asset_with_converted_file(
            user_id=context.user_id,
            project_id=context.project_id,
            asset_id=context.asset.id,
            original_gcs_uri=context.asset.gcs_uri or "",
            original_object_name=context.asset.object_name or "",
            original_signed_url=context.asset.signed_url,
            original_mime_type=context.asset.mime_type,
            converted_gcs_uri=gcs_uri,
            converted_object_name=object_name,
            converted_signed_url=signed_url,
            converted_filename=actual_filename,
            output_format=output_format,
        )
        
        # Re-extract metadata from converted file (fixes HEIC dimension issues)
        await _reextract_and_save_metadata(
            context.user_id,
            context.project_id,
            context.asset.id,
            gcs_uri,
        )
        
        return PipelineResult(
            status=StepStatus.SUCCEEDED,
            metadata={
                "message": f"Converted {input_format.upper()} to {output_format.upper()}",
                "jobId": job.id,
                "cloudconvertJobId": result.job_id,
                "inputFormat": input_format,
                "outputFormat": output_format,
                "outputGcsUri": gcs_uri,
                "outputSignedUrl": signed_url,
                "outputFileName": actual_filename,
            },
        )
        
    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Image conversion failed: {error_msg}")
        
        await update_conversion_job(
            context.user_id,
            context.project_id,
            job.id,
            {"status": "error", "error": error_msg, "updated_at": datetime.utcnow().isoformat() + "Z"},
        )
        
        return PipelineResult(
            status=StepStatus.FAILED,
            metadata={"message": "Conversion failed", "error": error_msg},
            error=error_msg,
        )
