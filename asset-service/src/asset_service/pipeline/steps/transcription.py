"""Transcription pipeline step using Google Cloud Speech-to-Text API."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

import httpx

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state
from ...transcription.speech import get_speech_env, get_speech_access_token
from ...transcription.store import (
    TranscriptionJob,
    save_transcription_job,
    find_latest_job_for_asset,
    update_transcription_job,
)

logger = logging.getLogger(__name__)


def _parse_offset_to_ms(offset: Any) -> int:
    """Parse a Speech API time offset to milliseconds.
    
    Handles formats like "1.5s", "0s", or dict with seconds/nanos.
    """
    if isinstance(offset, (int, float)):
        return int(offset * 1000)
    if isinstance(offset, str):
        # Remove 's' suffix and parse as float seconds
        numeric_str = offset.rstrip('s')
        try:
            seconds = float(numeric_str) if numeric_str else 0.0
            return int(seconds * 1000)
        except ValueError:
            return 0
    if isinstance(offset, dict):
        seconds = offset.get("seconds", 0)
        nanos = offset.get("nanos", 0)
        if isinstance(seconds, str):
            seconds = float(seconds) if seconds else 0.0
        return int(seconds * 1000 + nanos / 1_000_000)
    return 0


async def _start_batch_recognize(
    token: str,
    project_id: str,
    location: str,
    recognizer_id: str,
    model: str,
    gcs_uri: str,
    language_codes: list[str],
) -> str:
    """Start a batch recognition job."""
    recognizer_path = f"projects/{project_id}/locations/{location}/recognizers/{recognizer_id}"

    endpoint = "speech.googleapis.com"
    if location != "global":
        endpoint = f"{location}-speech.googleapis.com"

    url = f"https://{endpoint}/v2/{recognizer_path}:batchRecognize"

    payload = {
        "recognizer": recognizer_path,
        "config": {
            "autoDecodingConfig": {},
            "languageCodes": language_codes,
            "model": model,
            "features": {
                "enableWordTimeOffsets": True,
            },
        },
        "files": [{"uri": gcs_uri}],
        "recognitionOutputConfig": {
            "inlineResponseConfig": {},
        },
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60.0,
        )

        if response.status_code != 200:
            raise RuntimeError(f"Speech-to-Text request failed: {response.text}")

        data = response.json()
        operation_name = data.get("name")
        if not operation_name:
            raise RuntimeError("Speech-to-Text API did not return an operation name")

        return operation_name


async def _poll_operation(
    token: str,
    operation_name: str,
    location: str,
) -> dict[str, Any]:
    """
    Poll a Long Running Operation to check its status.

    Returns the operation response with 'done' boolean and 'response'/'error' if complete.
    """
    endpoint = "speech.googleapis.com"
    if location != "global":
        endpoint = f"{location}-speech.googleapis.com"

    url = f"https://{endpoint}/v2/{operation_name}"

    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            raise RuntimeError(f"Failed to poll operation: {response.text}")

        return response.json()


def _parse_transcription_result(operation_response: dict[str, Any]) -> tuple[str, list[dict]]:
    """
    Parse the transcription result from a completed operation.

    The response structure for inlineResponseConfig is:
    response.results[file_uri].inline_result.transcript.results[]

    Each result contains alternatives[] with transcript, confidence, and words[].

    Returns (transcript_text, segments_with_word_timings)
    """
    results = operation_response.get("results", {})

    all_segments = []
    all_text_parts = []

    # Results are keyed by the input file URI
    for file_uri, file_result in results.items():
        # Check for inline_result (used with inlineResponseConfig)
        inline_result = file_result.get("inlineResult", {})
        transcript_data = inline_result.get("transcript", {})

        # Fallback to deprecated direct transcript field
        if not transcript_data:
            transcript_data = file_result.get("transcript", {})

        recognition_results = transcript_data.get("results", [])

        for result in recognition_results:
            alternatives = result.get("alternatives", [])
            if not alternatives:
                continue

            # Use the first (best) alternative
            best = alternatives[0]
            transcript_text = best.get("transcript", "")
            if transcript_text:
                all_text_parts.append(transcript_text)

            # Extract word timings - one segment per word in { start, speech } format
            # to match the frontend expected format
            words = best.get("words", [])
            for word_info in words:
                word_text = word_info.get("word", "").strip()
                if not word_text:
                    continue
                start_offset = word_info.get("startOffset", "0s")
                start_ms = _parse_offset_to_ms(start_offset)
                all_segments.append({
                    "start": start_ms,
                    "speech": word_text,
                })

    full_transcript = " ".join(all_text_parts)
    return full_transcript, all_segments


@register_step(
    id="transcription",
    label="Transcribe audio/video",
    description="Use Google Cloud Speech-to-Text to generate captions.",
    auto_start=True,
    supported_types=[AssetType.AUDIO, AssetType.VIDEO],
)
async def transcription_step(context: PipelineContext) -> PipelineResult:
    """Start or poll a transcription job for the asset."""
    env = get_speech_env()

    # Check for existing job
    existing_job = await find_latest_job_for_asset(
        context.user_id,
        context.project_id,
        context.asset.id,
    )

    if existing_job:
        # Job completed successfully
        if existing_job.status == "completed":
            return PipelineResult(
                status=StepStatus.SUCCEEDED,
                metadata={
                    "message": "Transcription completed",
                    "jobId": existing_job.id,
                    "createdAt": existing_job.created_at,
                    "transcript": existing_job.transcript,
                    "segments": existing_job.segments,
                },
            )

        # Job failed
        if existing_job.status == "error":
            return PipelineResult(
                status=StepStatus.FAILED,
                metadata={
                    "message": "Transcription failed",
                    "jobId": existing_job.id,
                    "error": existing_job.error,
                },
            )

        # Job still processing - poll the operation to check status
        if existing_job.status == "processing" and existing_job.operation_name:
            logger.info(f"Polling transcription operation {existing_job.operation_name}")
            token = get_speech_access_token()

            try:
                operation = await _poll_operation(
                    token=token,
                    operation_name=existing_job.operation_name,
                    location=env.location,
                )

                if operation.get("done"):
                    # Operation completed - check for error or success
                    if "error" in operation:
                        error_msg = operation["error"].get("message", "Unknown error")
                        logger.error(f"Transcription operation failed: {error_msg}")

                        await update_transcription_job(
                            context.user_id,
                            context.project_id,
                            existing_job.id,
                            {"status": "error", "error": error_msg},
                        )

                        return PipelineResult(
                            status=StepStatus.FAILED,
                            metadata={
                                "message": "Transcription failed",
                                "jobId": existing_job.id,
                                "error": error_msg,
                            },
                        )
                    else:
                        # Success - parse results
                        response = operation.get("response", {})

                        # Debug: log response structure
                        logger.debug(f"Transcription response keys: {response.keys()}")
                        for uri, result in response.get("results", {}).items():
                            logger.debug(f"Result for {uri}: keys={result.keys()}")
                            if "inlineResult" in result:
                                logger.debug(f"inlineResult keys: {result['inlineResult'].keys()}")

                        transcript, segments = _parse_transcription_result(response)

                        logger.info(
                            f"Transcription completed for job {existing_job.id}, "
                            f"{len(segments)} segments, {len(transcript)} chars"
                        )

                        await update_transcription_job(
                            context.user_id,
                            context.project_id,
                            existing_job.id,
                            {
                                "status": "completed",
                                "transcript": transcript,
                                "segments": segments,
                            },
                        )

                        return PipelineResult(
                            status=StepStatus.SUCCEEDED,
                            metadata={
                                "message": "Transcription completed",
                                "jobId": existing_job.id,
                                "createdAt": existing_job.created_at,
                                "transcript": transcript,
                                "segments": segments,
                            },
                        )
                else:
                    # Still processing
                    logger.info(f"Transcription operation {existing_job.operation_name} still processing")
                    return PipelineResult(
                        status=StepStatus.WAITING,
                        metadata={
                            "message": "Transcription in progress",
                            "jobId": existing_job.id,
                            "createdAt": existing_job.created_at,
                        },
                    )

            except Exception as e:
                logger.exception(f"Error polling transcription operation: {e}")
                # Don't fail the step, just keep waiting
                return PipelineResult(
                    status=StepStatus.WAITING,
                    metadata={
                        "message": "Transcription in progress (poll error)",
                        "jobId": existing_job.id,
                        "createdAt": existing_job.created_at,
                        "pollError": str(e),
                    },
                )

    # No existing job - start a new one

    # Get GCS URI: prefer audio-extract FLAC (reliable for Speech-to-Text), then transcode
    # output, then cloud-upload. Raw video/audio codecs are often decoded as silence by the API.
    gcs_uri = context.params.get("audioGcsUri")
    if not gcs_uri:
        state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
        steps = state.get("steps", [])

        audio_extract_step_state = next((s for s in steps if s["id"] == "audio-extract"), None)
        if audio_extract_step_state and audio_extract_step_state.get("status") == "succeeded":
            gcs_uri = (audio_extract_step_state.get("metadata") or {}).get("audioForTranscriptionGcsUri")

        if not gcs_uri:
            transcode_step = next((s for s in steps if s["id"] == "transcode"), None)
            if transcode_step and transcode_step.get("status") == "succeeded":
                gcs_uri = (transcode_step.get("metadata") or {}).get("outputGcsUri")

        if not gcs_uri:
            upload_step = next((s for s in steps if s["id"] == "cloud-upload"), None)
            gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before transcription")

    logger.info(f"Using GCS URI for transcription: {gcs_uri}")

    # Get access token
    token = get_speech_access_token()

    # Determine language codes
    language_codes = context.params.get("languageCodes")
    if not language_codes or not isinstance(language_codes, list):
        language_codes = env.language_codes

    # Create job
    now = datetime.utcnow().isoformat() + "Z"
    job = TranscriptionJob(
        id=str(uuid.uuid4()),
        asset_id=context.asset.id,
        asset_name=context.asset.name,
        file_name=context.asset.file_name,
        mime_type=context.asset.mime_type,
        gcs_uri=gcs_uri,
        status="processing",
        language_codes=language_codes,
        created_at=now,
        updated_at=now,
        user_id=context.user_id,
        project_id=context.project_id,
    )

    # Start batch recognition
    operation_name = await _start_batch_recognize(
        token=token,
        project_id=env.project_id,
        location=env.location,
        recognizer_id=env.recognizer_id,
        model=env.model,
        gcs_uri=gcs_uri,
        language_codes=language_codes,
    )

    job.operation_name = operation_name
    await save_transcription_job(job)

    return PipelineResult(
        status=StepStatus.WAITING,
        metadata={
            "jobId": job.id,
            "createdAt": job.created_at,
            "languageCodes": language_codes,
        },
    )
