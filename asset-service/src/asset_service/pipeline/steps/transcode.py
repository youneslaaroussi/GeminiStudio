"""Transcode pipeline step using Google Cloud Transcoder API."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any

from ..types import AssetType, PipelineContext, PipelineResult, PipelineStepState, StoredAsset, StepStatus
from ..store import update_pipeline_step
from ...config import get_settings
from ...metadata.ffprobe import extract_metadata
from ...storage.gcs import create_signed_url, download_from_gcs
from ...storage.firestore import update_asset
from ...transcode.service import (
    create_transcode_job,
    get_transcode_job_status,
    TranscodeConfig,
    TranscodeJobStatus,
    OutputFormat,
    VideoCodec,
    AudioCodec,
)
from ...transcode.store import (
    TranscodeJob,
    save_transcode_job,
    find_latest_transcode_job_for_asset,
    update_transcode_job,
)

logger = logging.getLogger(__name__)

# Maximum time to wait for transcode to complete (10 minutes)
MAX_TRANSCODE_WAIT_SECONDS = 600
# Poll interval for transcode status
TRANSCODE_POLL_INTERVAL_SECONDS = 5


def _config_hash(config: dict[str, Any]) -> str:
    """Create a hash of the transcode config for deduplication."""
    # Sort keys for consistent hashing
    config_str = json.dumps(config, sort_keys=True)
    return hashlib.md5(config_str.encode()).hexdigest()[:12]


def _parse_transcode_params(params: dict[str, Any], *, has_audio: bool = True) -> TranscodeConfig:
    """Parse transcode parameters into TranscodeConfig.

    Note: width/height params are intentionally ignored to ALWAYS preserve aspect ratio.
    The target height is controlled by TRANSCODE_TARGET_HEIGHT envvar (e.g. 720 or 1080).

    Args:
        params: Transcode parameters dict
        has_audio: Whether the input file has an audio track. If False, audio stream
                   will be omitted from the transcode config to avoid API errors.
    """
    settings = get_settings()
    config = TranscodeConfig()

    # Set whether input has audio
    config.has_audio = has_audio

    # Set target height from envvar (only height - width auto-calculated to preserve aspect ratio)
    if settings.transcode_target_height:
        config.target_height = settings.transcode_target_height

    # Defaults when no params: aspect-preserving, 2.5 Mbps, 30 fps
    if not params.get("videoBitrate") and not params.get("videoBitrateBps"):
        config.video_bitrate_bps = 2_500_000
    if not params.get("frameRate"):
        config.frame_rate = 30.0

    # Output format
    if params.get("outputFormat"):
        format_map = {
            "mp4": OutputFormat.MP4,
            "hls": OutputFormat.HLS,
            "dash": OutputFormat.DASH,
        }
        config.output_format = format_map.get(params["outputFormat"].lower(), OutputFormat.MP4)

    # Video settings
    if params.get("videoCodec"):
        codec_map = {
            "h264": VideoCodec.H264,
            "h265": VideoCodec.H265,
            "hevc": VideoCodec.H265,
            "vp9": VideoCodec.VP9,
        }
        config.video_codec = codec_map.get(params["videoCodec"].lower(), VideoCodec.H264)

    if params.get("videoBitrate"):
        # Accept kbps or bps
        bitrate = params["videoBitrate"]
        if isinstance(bitrate, str):
            bitrate = int(bitrate.replace("k", "000").replace("K", "000"))
        elif bitrate < 100000:  # Assume kbps if small
            bitrate = bitrate * 1000
        config.video_bitrate_bps = bitrate

    if params.get("frameRate"):
        config.frame_rate = float(params["frameRate"])

    # Audio settings (only relevant if has_audio is True)
    if params.get("audioCodec"):
        codec_map = {
            "aac": AudioCodec.AAC,
            "mp3": AudioCodec.MP3,
            "opus": AudioCodec.OPUS,
        }
        config.audio_codec = codec_map.get(params["audioCodec"].lower(), AudioCodec.AAC)

    if params.get("audioBitrate"):
        bitrate = params["audioBitrate"]
        if isinstance(bitrate, str):
            bitrate = int(bitrate.replace("k", "000").replace("K", "000"))
        elif bitrate < 10000:  # Assume kbps if small
            bitrate = bitrate * 1000
        config.audio_bitrate_bps = bitrate

    if params.get("sampleRate"):
        config.sample_rate_hz = int(params["sampleRate"])
    if params.get("channels"):
        config.channels = int(params["channels"])

    return config


async def _poll_until_complete(
    job_name: str,
    job_id: str,
    user_id: str,
    project_id: str,
    output_gcs_uri: str,
    config_dict: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    """
    Poll transcode job until completion.
    
    Returns:
        Tuple of (success: bool, metadata: dict)
    """
    settings = get_settings()
    elapsed_seconds = 0
    
    while elapsed_seconds < MAX_TRANSCODE_WAIT_SECONDS:
        try:
            status, poll_metadata = await get_transcode_job_status(job_name)
            
            if status == TranscodeJobStatus.SUCCEEDED:
                output_signed_url = None
                output_object_name = None
                output_filename = "output.mp4"
                if output_gcs_uri and output_gcs_uri.startswith("gs://"):
                    parts = output_gcs_uri[5:].split("/", 1)
                    if len(parts) > 1:
                        output_object_name = parts[1].rstrip("/") + "/" + output_filename
                        output_gcs_uri_full = f"gs://{parts[0]}/{output_object_name}"
                        try:
                            output_signed_url = create_signed_url(output_object_name, settings=settings)
                        except Exception as e:
                            logger.warning(f"Failed to create signed URL for output: {e}")
                await update_transcode_job(user_id, project_id, job_id, {
                    "status": "completed",
                    "outputSignedUrl": output_signed_url,
                    "outputFileName": output_filename,
                })
                return True, {
                    "message": "Transcoding completed",
                    "jobId": job_id,
                    "outputGcsUri": output_gcs_uri_full if output_object_name else output_gcs_uri,
                    "outputObjectName": output_object_name,
                    "outputSignedUrl": output_signed_url,
                    "outputFileName": output_filename,
                    "config": config_dict,
                }
            
            elif status == TranscodeJobStatus.FAILED:
                error_msg = poll_metadata.get("error", "Unknown error")
                await update_transcode_job(user_id, project_id, job_id, {
                    "status": "error",
                    "error": error_msg,
                })
                return False, {
                    "message": "Transcoding failed",
                    "jobId": job_id,
                    "error": error_msg,
                    "config": config_dict,
                }
            
            else:
                # Still processing
                logger.info(f"Transcode job {job_name} is {status.value}, waiting... ({elapsed_seconds}s elapsed)")
        
        except Exception as e:
            logger.warning(f"Error polling transcode job: {e}")
        
        await asyncio.sleep(TRANSCODE_POLL_INTERVAL_SECONDS)
        elapsed_seconds += TRANSCODE_POLL_INTERVAL_SECONDS
    
    # Timeout
    return False, {
        "message": f"Transcoding timed out after {MAX_TRANSCODE_WAIT_SECONDS}s",
        "jobId": job_id,
        "config": config_dict,
    }


def _mp4_display_name(original_name: str) -> str:
    base, _ = os.path.splitext(original_name or "video")
    return f"{base}.mp4"


async def _update_asset_transcode_status(
    user_id: str,
    project_id: str,
    asset_id: str,
    status: str,
    error: str | None = None,
) -> None:
    """Update the asset document with transcode status.

    Args:
        user_id: User ID
        project_id: Project ID
        asset_id: Asset ID
        status: One of "pending", "processing", "completed", "error"
        error: Error message (only set when status is "error")
    """
    settings = get_settings()
    updates: dict[str, Any] = {"transcodeStatus": status}
    if error:
        updates["transcodeError"] = error
    elif status in ("completed", "processing", "pending"):
        # Clear previous error when status is not error
        updates["transcodeError"] = None

    await asyncio.to_thread(update_asset, user_id, project_id, asset_id, updates, settings)
    logger.info(f"Updated asset {asset_id} transcodeStatus={status}" + (f", error={error}" if error else ""))


async def _reextract_and_save_metadata(
    user_id: str,
    project_id: str,
    asset_id: str,
    transcoded_gcs_uri: str,
) -> dict[str, Any] | None:
    """
    Re-extract metadata from transcoded file and update asset + pipeline step.
    
    This fixes dimension extraction failures on MOV files by re-running
    ffprobe on the transcoded MP4.
    
    Returns:
        Extracted metadata dict if successful, None otherwise.
    """
    import tempfile
    
    settings = get_settings()
    
    try:
        # Download transcoded file
        logger.info(f"Downloading transcoded file for metadata re-extraction: {transcoded_gcs_uri}")
        content = await asyncio.to_thread(download_from_gcs, transcoded_gcs_uri, settings)
        
        # Write to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
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
            if extracted.duration is not None:
                metadata_updates["duration"] = extracted.duration
            if extracted.codec is not None:
                metadata_updates["videoCodec"] = extracted.codec
            if extracted.audio_codec is not None:
                metadata_updates["audioCodec"] = extracted.audio_codec
            if extracted.sample_rate is not None:
                metadata_updates["sampleRate"] = extracted.sample_rate
            if extracted.channels is not None:
                metadata_updates["channels"] = extracted.channels
            if extracted.bitrate is not None:
                metadata_updates["bitrate"] = extracted.bitrate
            if extracted.format_name is not None:
                metadata_updates["formatName"] = extracted.format_name
            if extracted.size is not None:
                metadata_updates["fileSize"] = extracted.size
            
            if metadata_updates:
                # Update asset document
                await asyncio.to_thread(
                    update_asset, user_id, project_id, asset_id, metadata_updates, settings
                )
                logger.info(
                    f"Updated asset {asset_id} with re-extracted metadata: "
                    f"width={metadata_updates.get('width')}, height={metadata_updates.get('height')}, "
                    f"duration={metadata_updates.get('duration')}"
                )
                
                # Also update the metadata pipeline step
                from datetime import datetime
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
                            "reextractedAfterTranscode": True,
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
        logger.warning(f"Failed to re-extract metadata after transcode: {e}")
        return None


async def _update_asset_with_transcoded_url(
    user_id: str,
    project_id: str,
    asset_id: str,
    original_gcs_uri: str,
    original_object_name: str,
    original_signed_url: str | None,
    transcoded_gcs_uri: str,
    transcoded_object_name: str,
    transcoded_signed_url: str | None,
    current_file_name: str | None = None,
) -> None:
    """Update the asset document so the asset points at the transcoded file (MP4)."""
    if not (transcoded_object_name and transcoded_object_name.strip()):
        raise ValueError("transcoded_object_name is required; transcode must update the asset")
    settings = get_settings()

    updates = {
        "originalGcsUri": original_gcs_uri,
        "originalObjectName": original_object_name,
        "originalSignedUrl": original_signed_url,
        "gcsUri": transcoded_gcs_uri,
        "objectName": transcoded_object_name,
        "signedUrl": transcoded_signed_url,
        "mimeType": "video/mp4",
        "transcoded": True,
        "transcodedAt": datetime.utcnow().isoformat() + "Z",
        "transcodeStatus": "completed",
        "transcodeError": None,  # Clear any previous error
    }
    if current_file_name:
        display_name = _mp4_display_name(current_file_name)
        updates["name"] = display_name
        updates["fileName"] = display_name

    await asyncio.to_thread(update_asset, user_id, project_id, asset_id, updates, settings)
    logger.info(f"Updated asset {asset_id} with transcoded URL, backed up original")


async def _detect_has_audio(asset_doc: dict[str, Any], settings) -> bool:
    """
    Detect if an asset has an audio track.
    
    First checks if audioCodec is already in the asset document (from previous metadata extraction).
    If not present, downloads the file from GCS and probes it with ffprobe.
    
    Returns True if audio track is detected, False otherwise.
    """
    import tempfile
    
    # Check if already extracted
    if asset_doc.get("audioCodec"):
        logger.info(f"Asset {asset_doc['id']} has audio (from metadata: {asset_doc['audioCodec']})")
        return True
    
    # If audioCodec is explicitly None or not present, we need to probe the file
    gcs_uri = asset_doc.get("gcsUri")
    if not gcs_uri:
        logger.warning(f"Asset {asset_doc['id']} has no GCS URI, assuming has audio")
        return True  # Default to true to avoid breaking existing behavior
    
    try:
        logger.info(f"Probing asset {asset_doc['id']} for audio track")
        content = await asyncio.to_thread(download_from_gcs, gcs_uri, settings)
        
        # Write to temp file and probe
        suffix = os.path.splitext(asset_doc.get("fileName", "video"))[1] or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            temp_path = tmp.name
        
        try:
            extracted = extract_metadata(temp_path)
            has_audio = extracted.audio_codec is not None
            logger.info(
                f"Asset {asset_doc['id']} audio probe result: "
                f"has_audio={has_audio}, audio_codec={extracted.audio_codec}"
            )
            return has_audio
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        logger.warning(f"Failed to probe asset {asset_doc['id']} for audio: {e}, assuming has audio")
        return True  # Default to true on error to avoid breaking


async def run_transcode_for_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    params: dict[str, Any],
) -> PipelineResult:
    """
    Run transcode for an asset (on-demand). Updates the asset with transcoded URL.
    Does not update pipeline step metadata.
    """
    from ...storage.firestore import get_asset

    settings = get_settings()
    asset_doc = await asyncio.to_thread(get_asset, user_id, project_id, asset_id, settings)
    if not asset_doc:
        raise ValueError(f"Asset {asset_id} not found")
    asset = StoredAsset.from_dict(asset_doc)
    asset_type = AssetType(asset_doc.get("type", "video"))

    # Detect if asset has audio track (probes file if not in metadata)
    has_audio = await _detect_has_audio(asset_doc, settings)

    # Merge has_audio info into params for _transcode_impl
    merged_params = {**(params or {}), "_has_audio": has_audio}

    context = PipelineContext(
        asset=asset,
        asset_path="",
        asset_type=asset_type,
        step_state=PipelineStepState(id="transcode", label="Transcode video", status=StepStatus.IDLE),
        user_id=user_id,
        project_id=project_id,
        params=merged_params,
    )
    return await _transcode_impl(context, update_cloud_upload_metadata=False)


async def _transcode_impl(
    context: PipelineContext,
    *,
    update_cloud_upload_metadata: bool = False,
) -> PipelineResult:
    """
    Transcode video and update asset to use transcoded version.

    This step:
    1. Starts a transcode job via Google Cloud Transcoder API
    2. Polls until the job completes (blocking)
    3. Updates the asset record to use the transcoded URL
    4. Backs up the original URL in the asset record

    Subsequent pipeline steps will use the transcoded version.

    Target height is controlled by TRANSCODE_TARGET_HEIGHT envvar (e.g. 720 or 1080).
    Width is auto-calculated to preserve the original aspect ratio.

    Params can include:
    - outputFormat: "mp4", "hls", "dash"
    - videoCodec: "h264", "h265", "vp9"
    - videoBitrate: Video bitrate in bps or kbps
    - frameRate: Output frame rate
    - audioCodec: "aac", "mp3", "opus"
    - audioBitrate: Audio bitrate in bps or kbps
    - sampleRate: Audio sample rate in Hz
    - channels: Number of audio channels
    """
    settings = get_settings()

    # Check if input file has audio (passed via params or default to True for backward compat)
    has_audio = context.params.get("_has_audio", True)
    if not has_audio:
        logger.info(f"Asset {context.asset.id} has no audio track, creating video-only transcode config")

    transcode_config = _parse_transcode_params(context.params or {}, has_audio=has_audio)

    # Create config hash for deduplication
    config_dict = {
        "outputFormat": transcode_config.output_format.value,
        "videoCodec": transcode_config.video_codec.value,
        "videoBitrate": transcode_config.video_bitrate_bps,
        "targetHeight": transcode_config.target_height,
        "frameRate": transcode_config.frame_rate,
        "hasAudio": transcode_config.has_audio,
    }
    # Only add audio settings to config hash if has_audio is True
    if transcode_config.has_audio:
        config_dict["audioCodec"] = transcode_config.audio_codec.value
        config_dict["audioBitrate"] = transcode_config.audio_bitrate_bps
        config_dict["sampleRate"] = transcode_config.sample_rate_hz
        config_dict["channels"] = transcode_config.channels
    config_dict = {k: v for k, v in config_dict.items() if v is not None}
    config_hash = _config_hash(config_dict)

    # Check for existing completed job with same config
    existing_job = await find_latest_transcode_job_for_asset(
        context.user_id,
        context.project_id,
        context.asset.id,
        config_hash=config_hash,
    )

    if existing_job:
        if existing_job.status == "completed":
            logger.info(f"Using existing completed transcode job {existing_job.id}")

            # Build full object name and GCS URI (folder + output filename), not folder only
            output_folder_uri = (existing_job.output_gcs_uri or "").rstrip("/")
            output_filename = existing_job.output_file_name or "output.mp4"
            transcoded_object_name = ""
            transcoded_gcs_uri_full = output_folder_uri
            if output_folder_uri.startswith("gs://"):
                parts = output_folder_uri[5:].split("/", 1)
                if len(parts) > 1:
                    folder_path = parts[1].rstrip("/")
                    transcoded_object_name = f"{folder_path}/{output_filename}"
                    transcoded_gcs_uri_full = f"gs://{parts[0]}/{transcoded_object_name}"

            # Signed URL: use stored one, or create from object name for older jobs
            transcoded_signed_url = existing_job.output_signed_url
            if not transcoded_signed_url and transcoded_object_name:
                try:
                    transcoded_signed_url = create_signed_url(transcoded_object_name, settings=settings)
                except Exception as e:
                    logger.warning(f"Could not create signed URL for existing job output: {e}")

            # Update asset if not already updated (transcode must change the asset)
            if not getattr(context.asset, "transcoded", False):
                if not (transcoded_object_name and transcoded_object_name.strip()):
                    return PipelineResult(
                        status=StepStatus.FAILED,
                        metadata={
                            "message": "Could not resolve transcoded output path for existing job",
                            "jobId": existing_job.id,
                            "config": config_dict,
                        },
                        error="Could not resolve transcoded output path",
                    )
                await _update_asset_with_transcoded_url(
                    user_id=context.user_id,
                    project_id=context.project_id,
                    asset_id=context.asset.id,
                    original_gcs_uri=existing_job.input_gcs_uri,
                    original_object_name=context.asset.object_name or "",
                    original_signed_url=context.asset.signed_url,
                    transcoded_gcs_uri=transcoded_gcs_uri_full,
                    transcoded_object_name=transcoded_object_name,
                    transcoded_signed_url=transcoded_signed_url,
                    current_file_name=context.asset.file_name,
                )
                
                # Re-extract metadata from transcoded file (fixes MOV dimension issues)
                await _reextract_and_save_metadata(
                    context.user_id,
                    context.project_id,
                    context.asset.id,
                    transcoded_gcs_uri_full,
                )

            return PipelineResult(
                status=StepStatus.SUCCEEDED,
                metadata={
                    "message": "Transcoding completed (cached)",
                    "jobId": existing_job.id,
                    "outputGcsUri": transcoded_gcs_uri_full,
                    "outputSignedUrl": transcoded_signed_url,
                    "outputFileName": output_filename,
                    "config": config_dict,
                },
            )

        if existing_job.status == "error":
            return PipelineResult(
                status=StepStatus.FAILED,
                metadata={
                    "message": "Transcoding failed (previous attempt)",
                    "jobId": existing_job.id,
                    "error": existing_job.error,
                    "config": config_dict,
                },
                error=existing_job.error,
            )

        # Job still processing - poll until complete
        if existing_job.status == "processing" and existing_job.job_name:
            logger.info(f"Resuming poll for transcode job {existing_job.job_name}")
            
            success, metadata = await _poll_until_complete(
                job_name=existing_job.job_name,
                job_id=existing_job.id,
                user_id=context.user_id,
                project_id=context.project_id,
                output_gcs_uri=existing_job.output_gcs_uri or "",
                config_dict=config_dict,
            )
            
            if success:
                output_object_name = metadata.get("outputObjectName") or ""
                if not output_object_name.strip():
                    return PipelineResult(
                        status=StepStatus.FAILED,
                        metadata=metadata,
                        error="Transcode completed but output path missing; asset not updated",
                    )
                await _update_asset_with_transcoded_url(
                    user_id=context.user_id,
                    project_id=context.project_id,
                    asset_id=context.asset.id,
                    original_gcs_uri=existing_job.input_gcs_uri,
                    original_object_name=context.asset.object_name or "",
                    original_signed_url=context.asset.signed_url,
                    transcoded_gcs_uri=metadata.get("outputGcsUri", ""),
                    transcoded_object_name=output_object_name,
                    transcoded_signed_url=metadata.get("outputSignedUrl"),
                    current_file_name=context.asset.file_name,
                )
                
                # Re-extract metadata from transcoded file (fixes MOV dimension issues)
                await _reextract_and_save_metadata(
                    context.user_id,
                    context.project_id,
                    context.asset.id,
                    metadata.get("outputGcsUri", ""),
                )
                
                return PipelineResult(status=StepStatus.SUCCEEDED, metadata=metadata)
            else:
                # Update asset with error status
                error_msg = metadata.get("error", metadata.get("message", "Unknown transcode error"))
                await _update_asset_transcode_status(
                    context.user_id, context.project_id, context.asset.id, "error", error_msg
                )
                return PipelineResult(
                    status=StepStatus.FAILED,
                    metadata=metadata,
                    error=error_msg,
                )

    # No existing job - start a new one
    input_gcs_uri = context.asset.gcs_uri
    if not input_gcs_uri:
        raise ValueError("Asset must be uploaded to GCS before transcoding")

    # Generate output path
    output_path = f"{context.user_id}/{context.project_id}/transcoded/{context.asset.id}/{config_hash}/"
    output_gcs_uri = f"gs://{settings.asset_gcs_bucket}/{output_path}"

    # Create transcode job
    try:
        job_name = await create_transcode_job(
            input_uri=input_gcs_uri,
            output_uri=output_gcs_uri,
            config=transcode_config,
        )
    except Exception as e:
        error_msg = f"Failed to create transcode job: {e}"
        logger.exception(error_msg)
        # Update asset with error status
        await _update_asset_transcode_status(
            context.user_id, context.project_id, context.asset.id, "error", error_msg
        )
        return PipelineResult(
            status=StepStatus.FAILED,
            metadata={"message": error_msg, "config": config_dict},
            error=error_msg,
        )

    # Save job to Firestore
    now = datetime.utcnow().isoformat() + "Z"
    job = TranscodeJob(
        id=str(uuid.uuid4()),
        asset_id=context.asset.id,
        asset_name=context.asset.name,
        file_name=context.asset.file_name,
        mime_type=context.asset.mime_type,
        input_gcs_uri=input_gcs_uri,
        output_gcs_uri=output_gcs_uri,
        status="processing",
        job_name=job_name,
        config={**config_dict, "hash": config_hash},
        created_at=now,
        updated_at=now,
        user_id=context.user_id,
        project_id=context.project_id,
    )

    await save_transcode_job(job)
    logger.info(f"Started transcode job {job.id} for asset {context.asset.id}")

    # Mark asset as processing
    await _update_asset_transcode_status(
        context.user_id, context.project_id, context.asset.id, "processing"
    )

    # Poll until complete (blocking)
    success, metadata = await _poll_until_complete(
        job_name=job_name,
        job_id=job.id,
        user_id=context.user_id,
        project_id=context.project_id,
        output_gcs_uri=output_gcs_uri,
        config_dict=config_dict,
    )

    if success:
        output_object_name = metadata.get("outputObjectName") or ""
        if not output_object_name.strip():
            return PipelineResult(
                status=StepStatus.FAILED,
                metadata=metadata,
                error="Transcode completed but output path missing; asset not updated",
            )
        await _update_asset_with_transcoded_url(
            user_id=context.user_id,
            project_id=context.project_id,
            asset_id=context.asset.id,
            original_gcs_uri=input_gcs_uri,
            original_object_name=context.asset.object_name or "",
            original_signed_url=context.asset.signed_url,
            transcoded_gcs_uri=metadata.get("outputGcsUri", ""),
            transcoded_object_name=output_object_name,
            transcoded_signed_url=metadata.get("outputSignedUrl"),
            current_file_name=context.asset.file_name,
        )
        
        # Re-extract metadata from transcoded file (fixes MOV dimension issues)
        await _reextract_and_save_metadata(
            context.user_id,
            context.project_id,
            context.asset.id,
            metadata.get("outputGcsUri", ""),
        )
        
        if update_cloud_upload_metadata:
            await update_pipeline_step(
                context.user_id,
                context.project_id,
                context.asset.id,
                "cloud-upload",
                {
                    "id": "cloud-upload",
                    "label": "Cloud Upload",
                    "status": "succeeded",
                    "metadata": {
                        "gcsUri": metadata.get("outputGcsUri"),
                        "signedUrl": metadata.get("outputSignedUrl"),
                        "transcoded": True,
                        "originalGcsUri": input_gcs_uri,
                    },
                    "updatedAt": datetime.utcnow().isoformat() + "Z",
                },
            )
        return PipelineResult(status=StepStatus.SUCCEEDED, metadata=metadata)
    else:
        # Update asset with error status
        error_msg = metadata.get("error", metadata.get("message", "Unknown transcode error"))
        await _update_asset_transcode_status(
            context.user_id, context.project_id, context.asset.id, "error", error_msg
        )
        return PipelineResult(
            status=StepStatus.FAILED,
            metadata=metadata,
            error=error_msg,
        )
