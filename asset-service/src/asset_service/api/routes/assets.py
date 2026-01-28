"""Asset management API routes."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ...config import get_settings
from ...metadata.ffprobe import extract_metadata, determine_asset_type
from ...storage.firestore import (
    save_asset,
    get_asset,
    list_assets,
    update_asset,
    delete_asset,
)
from ...storage.gcs import create_signed_url, delete_from_gcs, upload_to_gcs
from ...tasks.queue import get_task_queue

logger = logging.getLogger(__name__)

router = APIRouter()


class AssetResponse(BaseModel):
    """Response model for asset data."""

    id: str
    name: str
    fileName: str
    mimeType: str
    size: int
    type: str
    uploadedAt: str
    updatedAt: str | None = None
    gcsUri: str | None = None
    signedUrl: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    source: str = "api"


class UploadResponse(BaseModel):
    """Response model for upload."""

    asset: AssetResponse
    pipelineStarted: bool = False


@router.post("/{user_id}/{project_id}/upload", response_model=UploadResponse)
async def upload_asset(
    user_id: str,
    project_id: str,
    file: UploadFile = File(...),
    source: str = Form(default="api"),
    run_pipeline: bool = Form(default=True),
):
    """
    Upload a new asset.

    - Extracts metadata using ffprobe
    - Uploads to GCS immediately
    - Stores metadata in Firestore
    - Queues pipeline for background processing (non-blocking)
    """
    settings = get_settings()

    # Generate asset ID
    asset_id = str(uuid.uuid4())

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Get filename and mime type
    original_filename = file.filename or f"asset-{asset_id}"
    mime_type = file.content_type or "application/octet-stream"

    # Determine asset type
    asset_type = determine_asset_type(mime_type, original_filename)

    # Extract metadata using ffprobe (save to temp file first)
    metadata: dict[str, Any] = {}
    temp_path = None

    try:
        # Write to temp file for ffprobe
        suffix = os.path.splitext(original_filename)[1] or ""
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            temp_path = tmp.name

        # Extract metadata
        extracted = extract_metadata(temp_path)
        if extracted.width:
            metadata["width"] = extracted.width
        if extracted.height:
            metadata["height"] = extracted.height
        if extracted.duration:
            metadata["duration"] = extracted.duration
        if extracted.codec:
            metadata["videoCodec"] = extracted.codec
        if extracted.audio_codec:
            metadata["audioCodec"] = extracted.audio_codec
        if extracted.sample_rate:
            metadata["sampleRate"] = extracted.sample_rate
        if extracted.channels:
            metadata["channels"] = extracted.channels
        if extracted.bitrate:
            metadata["bitrate"] = extracted.bitrate

    except Exception as e:
        logger.warning(f"Failed to extract metadata: {e}")

    # Upload to GCS immediately (so we have a signed URL right away)
    object_name = f"{user_id}/{project_id}/assets/{asset_id}/{original_filename}"
    gcs_result = upload_to_gcs(content, object_name, mime_type, settings)
    signed_url = create_signed_url(object_name, settings=settings)

    # Create asset data with GCS info
    now = datetime.utcnow().isoformat() + "Z"
    asset_data = {
        "id": asset_id,
        "name": original_filename,
        "fileName": original_filename,
        "mimeType": mime_type,
        "size": file_size,
        "type": asset_type,
        "uploadedAt": now,
        "updatedAt": now,
        "source": source,
        "gcsUri": gcs_result["gcs_uri"],
        "bucket": gcs_result["bucket"],
        "objectName": gcs_result["object_name"],
        "signedUrl": signed_url,
        **metadata,
    }

    # Save to Firestore
    saved_asset = save_asset(user_id, project_id, asset_data, settings)

    # Queue pipeline for background processing (non-blocking)
    pipeline_started = False
    if run_pipeline:
        try:
            queue = await get_task_queue()
            await queue.enqueue_pipeline(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_data=saved_asset,
                asset_path=temp_path or "",
            )
            pipeline_started = True
            logger.info(f"Queued pipeline for asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to queue pipeline: {e}")
            # Don't fail the upload if queuing fails

    # Note: temp file cleanup happens in the worker after pipeline completes
    # If pipeline not requested, clean up now
    if not run_pipeline and temp_path and os.path.exists(temp_path):
        os.unlink(temp_path)

    return UploadResponse(
        asset=AssetResponse(**saved_asset),
        pipelineStarted=pipeline_started,
    )


@router.get("/{user_id}/{project_id}", response_model=list[AssetResponse])
async def list_project_assets(user_id: str, project_id: str):
    """List all assets for a project."""
    settings = get_settings()

    # Run blocking Firestore call in thread pool
    assets = await asyncio.to_thread(list_assets, user_id, project_id, settings)

    # Generate fresh signed URLs in parallel using thread pool
    async def get_signed_url(asset: dict) -> None:
        object_name = asset.get("objectName")
        if object_name:
            try:
                url = await asyncio.to_thread(create_signed_url, object_name, settings=settings)
                asset["signedUrl"] = url
            except Exception as e:
                logger.warning(f"Failed to create signed URL for {object_name}: {e}")

    await asyncio.gather(*[get_signed_url(asset) for asset in assets])

    return [AssetResponse(**asset) for asset in assets]


@router.get("/{user_id}/{project_id}/{asset_id}", response_model=AssetResponse)
async def get_asset_by_id(user_id: str, project_id: str, asset_id: str):
    """Get a single asset by ID."""
    settings = get_settings()

    # Run blocking Firestore call in thread pool
    asset = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)

    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Generate fresh signed URL in thread pool
    object_name = asset.get("objectName")
    if object_name:
        try:
            asset["signedUrl"] = await asyncio.to_thread(
                create_signed_url, object_name, settings=settings
            )
        except Exception as e:
            logger.warning(f"Failed to create signed URL for {object_name}: {e}")

    return AssetResponse(**asset)


@router.patch("/{user_id}/{project_id}/{asset_id}", response_model=AssetResponse)
async def update_asset_by_id(
    user_id: str,
    project_id: str,
    asset_id: str,
    updates: dict[str, Any],
):
    """Update an asset."""
    settings = get_settings()

    # Don't allow updating certain fields
    protected_fields = {"id", "uploadedAt", "gcsUri", "objectName", "bucket"}
    for field in protected_fields:
        updates.pop(field, None)

    updated = update_asset(user_id, project_id, asset_id, updates, settings)
    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found")

    return AssetResponse(**updated)


@router.delete("/{user_id}/{project_id}/{asset_id}")
async def delete_asset_by_id(user_id: str, project_id: str, asset_id: str):
    """Delete an asset."""
    settings = get_settings()

    # Get asset first to get GCS URI
    asset = get_asset(user_id, project_id, asset_id, settings)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Delete from GCS
    gcs_uri = asset.get("gcsUri")
    if gcs_uri:
        try:
            delete_from_gcs(gcs_uri, settings)
        except Exception as e:
            logger.warning(f"Failed to delete from GCS: {e}")

    # Delete from Firestore
    delete_asset(user_id, project_id, asset_id, settings)

    return {"deleted": True, "assetId": asset_id}
