"""Asset management API routes."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import mimetypes
import os
import tempfile
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Path, Request, UploadFile
from pydantic import BaseModel

# Path segment for asset ID. Reorder is not ambiguous: POST .../reorder is defined before .../{asset_id}.
ASSET_ID_PATH = Path(..., description="Asset ID")

from ...config import get_settings
from ...metadata.ffprobe import extract_metadata, determine_asset_type
from ...storage.firestore import (
    save_asset,
    get_asset,
    list_assets,
    update_asset,
    delete_asset,
    batch_update_sort_orders,
)
from ...storage.gcs import create_signed_url, delete_from_gcs, upload_to_gcs
from ...pipeline.store import get_pipeline_state
from ...tasks.queue import get_task_queue
from ...search.algolia import index_asset, delete_asset_index, update_asset_index

logger = logging.getLogger(__name__)

router = APIRouter()


class AssetResponse(BaseModel):
    """Response model for asset data."""

    id: str
    name: str
    fileName: str = ""
    mimeType: str = ""
    size: int = 0
    type: str
    uploadedAt: str
    updatedAt: str | None = None
    gcsUri: str | None = None
    signedUrl: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    source: str = "api"
    sortOrder: int | None = None
    description: str | None = None  # AI-generated short description
    notes: str | None = None  # User notes (what the asset is for)
    # Component asset fields
    code: str | None = None
    componentName: str | None = None
    inputDefs: list[dict[str, Any]] | None = None


class ReorderBody(BaseModel):
    """Body for reorder request."""

    assetIds: list[str]


class UploadResponse(BaseModel):
    """Response model for upload."""

    asset: AssetResponse
    pipelineStarted: bool = False
    transcodeStarted: bool = False


def _is_unsupported_video_format(mime: str, filename: str) -> bool:
    if mime in ("video/quicktime", "video/x-msvideo"):
        return True
    ext = (filename or "").lower().split(".")[-1]
    return ext in ("mov", "avi", "qt")


@router.post("/{user_id}/{project_id}/upload", response_model=UploadResponse)
async def upload_asset(
    request: Request,
    user_id: str,
    project_id: str,
    file: UploadFile = File(...),
    source: str = Form(default="api"),
    run_pipeline: bool = Form(default=True),
    thread_id: str | None = Form(default=None),
    # Transcode options (JSON string or individual fields)
    transcode_options: str | None = Form(default=None, alias="transcodeOptions"),
    transcode_format: str | None = Form(default=None, alias="transcodeFormat"),
    transcode_video_bitrate: int | None = Form(default=None, alias="transcodeVideoBitrate"),
    # Note: width/height params removed - always preserve original aspect ratio
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

    # Verify file hash if HMAC auth is enabled (hash was signed by client)
    expected_hash = getattr(request.state, "expected_file_hash", None)
    if expected_hash:
        actual_hash = hashlib.sha256(content).hexdigest()
        if not hmac.compare_digest(expected_hash, actual_hash):
            raise HTTPException(status_code=401, detail="File hash mismatch")

    # Get filename and mime type
    original_filename = file.filename or f"asset-{asset_id}"
    mime_type = file.content_type or "application/octet-stream"
    
    # If MIME type is generic, try to infer from filename extension
    if mime_type == "application/octet-stream" and original_filename:
        guessed_type, _ = mimetypes.guess_type(original_filename)
        if guessed_type:
            logger.info(f"Resolved MIME type from extension: {guessed_type} (was {mime_type})")
            mime_type = guessed_type

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

        # Extract metadata (run in thread pool to avoid blocking)
        extracted = await asyncio.to_thread(extract_metadata, temp_path)
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

    # Upload to GCS immediately
    # Run blocking GCS operations in thread pool
    object_name = f"{user_id}/{project_id}/assets/{asset_id}/{original_filename}"
    gcs_result = await asyncio.to_thread(upload_to_gcs, content, object_name, mime_type, settings)
    # Do NOT store signedUrl - it expires. Generate on-demand in list/get.

    # Create asset data with GCS info (objectName only, no signed URLs)
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
        **metadata,
    }

    saved_asset = await asyncio.to_thread(save_asset, user_id, project_id, asset_data, settings)

    import json as _json

    parsed_transcode_opts: dict[str, Any] = {}
    if transcode_options:
        try:
            parsed_transcode_opts = _json.loads(transcode_options)
        except _json.JSONDecodeError:
            logger.warning(f"Invalid transcode_options JSON: {transcode_options}")
    elif transcode_format or transcode_video_bitrate:
        if transcode_format:
            parsed_transcode_opts["outputFormat"] = transcode_format
        if transcode_video_bitrate:
            parsed_transcode_opts["videoBitrate"] = transcode_video_bitrate

    transcode_started = False
    pipeline_started = False
    need_transcode_then_pipeline = (
        asset_type == "video"
        and run_pipeline
        and (
            _is_unsupported_video_format(mime_type, original_filename)
            or parsed_transcode_opts
        )
    )

    if need_transcode_then_pipeline:
        transcode_params = parsed_transcode_opts or {}
        try:
            queue = await get_task_queue()
            agent_metadata = (
                {"threadId": thread_id, "userId": user_id, "projectId": project_id}
                if thread_id
                else None
            )
            await queue.enqueue_transcode(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_data=saved_asset,
                params=transcode_params,
                trigger_pipeline_after=True,
                agent_metadata=agent_metadata,
            )
            transcode_started = True
            pipeline_started = True
            logger.info(f"Queued transcode then pipeline for asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to queue transcode: {e}")
    elif run_pipeline:
        try:
            queue = await get_task_queue()
            agent_metadata = (
                {"threadId": thread_id, "userId": user_id, "projectId": project_id}
                if thread_id
                else None
            )
            await queue.enqueue_pipeline(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_data=saved_asset,
                asset_path=temp_path or "",
                agent_metadata=agent_metadata,
            )
            pipeline_started = True
            logger.info(f"Queued pipeline for asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to queue pipeline: {e}")

    if (need_transcode_then_pipeline or not run_pipeline) and temp_path and os.path.exists(temp_path):
        os.unlink(temp_path)

    # Index to Algolia (basic metadata, pipeline will update with rich content)
    try:
        await index_asset(
            user_id=user_id,
            project_id=project_id,
            asset_data=saved_asset,
            pipeline_state=None,  # Pipeline hasn't run yet
        )
    except Exception as e:
        logger.warning(f"Failed to index new asset to Algolia: {e}")

    # Add fresh signedUrl to response only (not stored - expires)
    response_asset = dict(saved_asset)
    response_asset["signedUrl"] = await asyncio.to_thread(
        create_signed_url, saved_asset["objectName"], settings=settings
    )
    return UploadResponse(
        asset=AssetResponse(**response_asset),
        pipelineStarted=pipeline_started,
        transcodeStarted=transcode_started,
    )


class RegisterGcsRequest(BaseModel):
    """Request body for registering an existing GCS file as an asset."""

    gcsUri: str  # e.g., gs://bucket/path/to/file.mp4
    name: str | None = None  # Optional display name
    source: str = "render"  # Source identifier
    runPipeline: bool = True  # Whether to run the analysis pipeline
    threadId: str | None = None  # For agent notifications
    transcodeOptions: dict[str, Any] | None = None
    transcodeFormat: str | None = None
    transcodeVideoBitrate: int | None = None


@router.post("/{user_id}/{project_id}/register-gcs", response_model=UploadResponse)
async def register_gcs_asset(
    user_id: str,
    project_id: str,
    body: RegisterGcsRequest,
):
    """
    Register an existing GCS file as an asset.

    This is used by the renderer to register rendered videos as assets
    so they can be analyzed by the agent pipeline.
    """
    settings = get_settings()

    # Parse GCS URI
    if not body.gcsUri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="Invalid GCS URI format")

    parts = body.gcsUri[5:].split("/", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid GCS URI format")

    bucket_name, object_name = parts

    # Generate asset ID
    asset_id = str(uuid.uuid4())

    # Extract filename from object name
    filename = object_name.split("/")[-1] if "/" in object_name else object_name
    display_name = body.name or filename

    # Guess MIME type from extension
    mime_type, _ = mimetypes.guess_type(filename)
    mime_type = mime_type or "application/octet-stream"

    # Determine asset type
    asset_type = determine_asset_type(mime_type, filename)

    # Get file size and metadata from GCS
    from google.cloud import storage as gcs_storage

    try:
        client = gcs_storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        blob.reload()  # Fetch metadata
        file_size = blob.size or 0
    except Exception as e:
        logger.error(f"Failed to get GCS file info: {e}")
        raise HTTPException(status_code=404, detail="GCS file not found")

    # Do NOT store signedUrl - it expires. Generate on-demand in list/get.

    # Extract video metadata if it's a video
    metadata: dict[str, Any] = {}
    temp_path = None

    if asset_type == "video":
        try:
            # Download to temp file for ffprobe
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp:
                blob.download_to_file(tmp)
                temp_path = tmp.name

            extracted = await asyncio.to_thread(extract_metadata, temp_path)
            if extracted.width:
                metadata["width"] = extracted.width
            if extracted.height:
                metadata["height"] = extracted.height
            if extracted.duration:
                metadata["duration"] = extracted.duration
            if extracted.codec:
                metadata["videoCodec"] = extracted.codec
        except Exception as e:
            logger.warning(f"Failed to extract metadata from GCS file: {e}")
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    # Create asset data (objectName only, no signed URLs - generated on-demand)
    now = datetime.utcnow().isoformat() + "Z"
    asset_data = {
        "id": asset_id,
        "name": display_name,
        "fileName": filename,
        "mimeType": mime_type,
        "size": file_size,
        "type": asset_type,
        "uploadedAt": now,
        "updatedAt": now,
        "source": body.source,
        "gcsUri": body.gcsUri,
        "bucket": bucket_name,
        "objectName": object_name,
        **metadata,
    }

    saved_asset = await asyncio.to_thread(save_asset, user_id, project_id, asset_data, settings)

    parsed_transcode_opts: dict[str, Any] = {}
    if body.transcodeOptions:
        parsed_transcode_opts = dict(body.transcodeOptions)
    elif body.transcodeFormat or body.transcodeVideoBitrate:
        if body.transcodeFormat:
            parsed_transcode_opts["outputFormat"] = body.transcodeFormat
        if body.transcodeVideoBitrate:
            parsed_transcode_opts["videoBitrate"] = body.transcodeVideoBitrate

    transcode_started = False
    # Queue pipeline if requested
    pipeline_started = False
    need_transcode_then_pipeline = (
        asset_type == "video"
        and body.runPipeline
        and (
            _is_unsupported_video_format(mime_type, filename)
            or parsed_transcode_opts
        )
    )

    if need_transcode_then_pipeline:
        try:
            queue = await get_task_queue()
            agent_metadata = (
                {"threadId": body.threadId, "userId": user_id, "projectId": project_id}
                if body.threadId
                else None
            )
            await queue.enqueue_transcode(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_data=saved_asset,
                params=parsed_transcode_opts,
                trigger_pipeline_after=True,
                agent_metadata=agent_metadata,
            )
            transcode_started = True
            pipeline_started = True
            logger.info(f"Queued transcode then pipeline for GCS asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to queue transcode for registered GCS asset {asset_id}: {e}")
    elif body.runPipeline:
        try:
            queue = await get_task_queue()
            agent_metadata = (
                {"threadId": body.threadId, "userId": user_id, "projectId": project_id}
                if body.threadId
                else None
            )
            await queue.enqueue_pipeline(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_data=saved_asset,
                asset_path="",  # Already in GCS
                agent_metadata=agent_metadata,
            )
            pipeline_started = True
            logger.info(f"Queued pipeline for registered GCS asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to queue pipeline: {e}")

    # Index to Algolia
    try:
        await index_asset(
            user_id=user_id,
            project_id=project_id,
            asset_data=saved_asset,
            pipeline_state=None,
        )
    except Exception as e:
        logger.warning(f"Failed to index registered asset to Algolia: {e}")

    # Add fresh signedUrl to response only (not stored - expires)
    response_asset = dict(saved_asset)
    response_asset["signedUrl"] = await asyncio.to_thread(
        create_signed_url, object_name, bucket=bucket_name, settings=settings
    )
    return UploadResponse(
        asset=AssetResponse(**response_asset),
        pipelineStarted=pipeline_started,
        transcodeStarted=transcode_started,
    )


@router.get("/{user_id}/{project_id}", response_model=list[AssetResponse])
async def list_project_assets(user_id: str, project_id: str):
    """List all assets for a project. No signed URLs - use playback-url for on-demand URLs."""
    settings = get_settings()

    # Run blocking Firestore call in thread pool
    assets = await asyncio.to_thread(list_assets, user_id, project_id, settings)
    # Do NOT generate signed URLs here - list is polled frequently (e.g. every 10s during transcode).
    # Client uses playback path; playback-url generates URL only when actually needed.
    return [AssetResponse(**asset) for asset in assets]


@router.post("/{user_id}/{project_id}/reorder", response_model=list[AssetResponse])
async def reorder_assets(
    user_id: str,
    project_id: str,
    body: ReorderBody,
):
    """Set asset order by providing ordered list of asset IDs."""
    settings = get_settings()

    try:
        await asyncio.to_thread(
            batch_update_sort_orders, user_id, project_id, body.assetIds, settings
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Return list in new order (no signed URLs - use playback-url on demand)
    assets = await asyncio.to_thread(list_assets, user_id, project_id, settings)
    return [AssetResponse(**asset) for asset in assets]


class CreateComponentBody(BaseModel):
    """Body for creating a component asset (no file upload)."""

    name: str
    code: str
    componentName: str
    inputDefs: list[dict[str, Any]] = []


@router.post("/{user_id}/{project_id}/component", response_model=AssetResponse)
async def create_component_asset(
    user_id: str,
    project_id: str,
    body: CreateComponentBody,
):
    """Create a component asset (code-only, no file upload)."""
    settings = get_settings()
    now = datetime.utcnow().isoformat() + "Z"
    asset_id = str(uuid.uuid4())

    asset_data: dict[str, Any] = {
        "id": asset_id,
        "name": body.name,
        "fileName": "",
        "mimeType": "text/typescript",
        "size": len(body.code.encode("utf-8")),
        "type": "component",
        "uploadedAt": now,
        "updatedAt": now,
        "source": "web",
        "code": body.code,
        "componentName": body.componentName,
        "inputDefs": [d.model_dump() if hasattr(d, "model_dump") else d for d in body.inputDefs],
    }

    await asyncio.to_thread(save_asset, user_id, project_id, asset_data, settings)
    logger.info(f"Created component asset {asset_id} ({body.componentName}) for user {user_id} project {project_id}")

    return AssetResponse(**asset_data)


@router.get("/{user_id}/{project_id}/{asset_id}", response_model=AssetResponse)
async def get_asset_by_id(
    user_id: str, project_id: str, asset_id: str = ASSET_ID_PATH
):
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
    asset_id: str = ASSET_ID_PATH,
    updates: dict[str, Any] = ...,
):
    """Update an asset."""
    settings = get_settings()

    # Don't allow updating certain fields
    protected_fields = {"id", "uploadedAt", "gcsUri", "objectName", "bucket"}
    for field in protected_fields:
        updates.pop(field, None)

    # Run blocking Firestore call in thread pool
    updated = await asyncio.to_thread(update_asset, user_id, project_id, asset_id, updates, settings)
    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Re-index in Algolia when notes (or other searchable fields) change
    if "notes" in updates or "name" in updates or "description" in updates:
        try:
            await update_asset_index(
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                updates={k: v for k, v in updates.items() if k in ("notes", "name", "description")},
                settings=settings,
            )
        except Exception as e:
            logger.warning("Failed to update Algolia index after asset update: %s", e)

    # Add fresh signedUrl to response (not stored - expires)
    object_name = updated.get("objectName")
    if object_name:
        try:
            updated["signedUrl"] = await asyncio.to_thread(
                create_signed_url, object_name, settings=settings
            )
        except Exception as e:
            logger.warning(f"Failed to create signed URL for {object_name}: {e}")

    return AssetResponse(**updated)


@router.delete("/{user_id}/{project_id}/{asset_id}")
async def delete_asset_by_id(
    user_id: str, project_id: str, asset_id: str = ASSET_ID_PATH
):
    """Delete an asset."""
    settings = get_settings()

    # Get asset first to get GCS URI (run in thread pool)
    asset = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Delete from GCS (run in thread pool)
    gcs_uri = asset.get("gcsUri")
    if gcs_uri:
        try:
            await asyncio.to_thread(delete_from_gcs, gcs_uri, settings)
        except Exception as e:
            logger.warning(f"Failed to delete from GCS: {e}")

    # Delete from Firestore (run in thread pool)
    await asyncio.to_thread(delete_asset, user_id, project_id, asset_id, settings)

    # Delete from Algolia search index
    try:
        await delete_asset_index(user_id, project_id, asset_id, settings)
    except Exception as e:
        logger.warning(f"Failed to delete asset from Algolia: {e}")

    return {"deleted": True, "assetId": asset_id}


class TranscodeRequest(BaseModel):
    outputFormat: str | None = None
    videoCodec: str | None = None
    videoBitrate: int | None = None
    frameRate: float | None = None
    audioCodec: str | None = None
    audioBitrate: int | None = None
    sampleRate: int | None = None
    channels: int | None = None
    triggerPipelineAfter: bool = False


class TranscodeResponse(BaseModel):
    """Response for transcode request."""

    queued: bool
    jobId: str | None = None
    message: str


@router.get("/{user_id}/{project_id}/{asset_id}/thumbnail")
async def get_asset_thumbnail(
    user_id: str, project_id: str, asset_id: str = ASSET_ID_PATH
):
    """Get fresh signed thumbnail URL. objectName stored in Firestore, URL generated on-demand."""
    settings = get_settings()
    asset = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    state = await get_pipeline_state(user_id, project_id, asset_id, settings)
    thumb_step = next(
        (s for s in state.get("steps", []) if s.get("id") == "thumbnail"),
        None,
    )
    if not thumb_step or thumb_step.get("status") != "succeeded":
        return {"url": None, "available": False}

    meta = thumb_step.get("metadata", {})
    object_name = meta.get("objectName")
    if not object_name:
        return {"url": None, "available": False}

    url = await asyncio.to_thread(create_signed_url, object_name, None, None, settings)
    return {"url": url, "available": True}


@router.get("/{user_id}/{project_id}/{asset_id}/frames")
async def get_asset_frames(
    user_id: str, project_id: str, asset_id: str = ASSET_ID_PATH
):
    """Get fresh signed frame URLs. objectNames stored in Firestore, URLs generated on-demand."""
    settings = get_settings()
    asset = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset.get("type") != "video":
        raise HTTPException(status_code=400, detail="Only video assets have sampled frames")

    state = await get_pipeline_state(user_id, project_id, asset_id, settings)
    frame_step = next(
        (s for s in state.get("steps", []) if s.get("id") == "frame-sampling"),
        None,
    )
    if not frame_step or frame_step.get("status") != "succeeded":
        return {
            "frames": [],
            "duration": asset.get("duration") or 0,
            "frameCount": 0,
        }

    meta = frame_step.get("metadata", {})
    object_names = meta.get("objectNames", [])
    duration = meta.get("duration") or asset.get("duration") or 0

    frames = []
    for i, obj in enumerate(object_names):
        url = await asyncio.to_thread(create_signed_url, obj, None, None, settings)
        ts = duration * (i + 0.5) / len(object_names) if object_names else 0
        frames.append({"url": url, "timestamp": ts, "index": i})

    return {
        "frames": frames,
        "duration": duration,
        "frameCount": len(frames),
    }


@router.post("/{user_id}/{project_id}/{asset_id}/transcode", response_model=TranscodeResponse)
async def transcode_asset(
    user_id: str,
    project_id: str,
    asset_id: str = ASSET_ID_PATH,
    body: TranscodeRequest = ...,
):
    """
    Start a transcode job for an existing asset.

    The job runs in the background. Poll the pipeline state to check progress.
    """
    settings = get_settings()

    # Get asset
    asset = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Check if it's a video
    if asset.get("type") != "video":
        raise HTTPException(status_code=400, detail="Only video assets can be transcoded")

    # Check if GCS URI exists
    gcs_uri = asset.get("gcsUri")
    if not gcs_uri:
        raise HTTPException(status_code=400, detail="Asset must be uploaded to cloud storage")

    # Build transcode params
    transcode_params: dict[str, Any] = {}
    if body.outputFormat:
        transcode_params["outputFormat"] = body.outputFormat
    if body.videoCodec:
        transcode_params["videoCodec"] = body.videoCodec
    if body.videoBitrate:
        transcode_params["videoBitrate"] = body.videoBitrate
    if body.frameRate:
        transcode_params["frameRate"] = body.frameRate
    if body.audioCodec:
        transcode_params["audioCodec"] = body.audioCodec
    if body.audioBitrate:
        transcode_params["audioBitrate"] = body.audioBitrate
    if body.sampleRate:
        transcode_params["sampleRate"] = body.sampleRate
    if body.channels:
        transcode_params["channels"] = body.channels

    try:
        queue = await get_task_queue()
        task_id = await queue.enqueue_transcode(
            user_id=user_id,
            project_id=project_id,
            asset_id=asset_id,
            asset_data=asset,
            params=transcode_params,
            trigger_pipeline_after=body.triggerPipelineAfter,
        )
        logger.info(f"Queued transcode for asset {asset_id}: task {task_id}")

        return TranscodeResponse(
            queued=True,
            jobId=task_id,
            message=f"Transcode job queued (pipeline_after={body.triggerPipelineAfter})",
        )
    except Exception as e:
        logger.exception(f"Failed to queue transcode: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to queue transcode: {e}")
