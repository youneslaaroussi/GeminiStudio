"""Transcription pipeline step using Google Cloud Speech-to-Text API."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

import httpx

from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus
from ..store import get_pipeline_state
from ...transcription.speech import get_speech_env, get_speech_access_token
from ...transcription.store import (
    TranscriptionJob,
    save_transcription_job,
    find_latest_job_for_asset,
)

logger = logging.getLogger(__name__)


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


@register_step(
    id="transcription",
    label="Transcribe audio/video",
    description="Use Google Cloud Speech-to-Text to generate captions.",
    auto_start=False,  # Not auto-start - requires explicit trigger
    supported_types=[AssetType.AUDIO, AssetType.VIDEO],
)
async def transcription_step(context: PipelineContext) -> PipelineResult:
    """Start a transcription job for the asset."""
    # Check for existing processing job
    existing_job = await find_latest_job_for_asset(
        context.user_id,
        context.project_id,
        context.asset.id,
    )

    if existing_job and existing_job.status == "processing":
        return PipelineResult(
            status=StepStatus.WAITING,
            metadata={
                "message": "Transcription already running",
                "jobId": existing_job.id,
                "createdAt": existing_job.created_at,
            },
        )

    # Get GCS URI - either from params or from upload step
    gcs_uri = context.params.get("audioGcsUri")
    if not gcs_uri:
        state = await get_pipeline_state(context.user_id, context.project_id, context.asset.id)
        upload_step = next((s for s in state.get("steps", []) if s["id"] == "cloud-upload"), None)
        gcs_uri = upload_step.get("metadata", {}).get("gcsUri") if upload_step else None

    if not gcs_uri:
        raise ValueError("Cloud upload step must complete before transcription")

    # Get speech environment
    env = get_speech_env()
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
