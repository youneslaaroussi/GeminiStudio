"""Firestore storage for transcode jobs."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from google.cloud import firestore

from ..config import get_settings
from ..storage.firestore import get_firestore_client

logger = logging.getLogger(__name__)


@dataclass
class TranscodeJob:
    """A transcode job record."""

    id: str
    asset_id: str
    asset_name: str
    file_name: str
    mime_type: str
    input_gcs_uri: str
    output_gcs_uri: str | None = None
    status: str = "pending"  # pending, processing, completed, error
    job_name: str | None = None  # Transcoder API job name
    config: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""
    user_id: str = ""
    project_id: str = ""

    # Output metadata (populated on completion)
    output_signed_url: str | None = None
    output_file_name: str | None = None
    output_size: int | None = None
    output_duration: float | None = None


def _get_job_collection(user_id: str, project_id: str) -> Any:
    """Get Firestore collection for transcode jobs."""
    db = get_firestore_client()
    return db.collection("users").document(user_id).collection("projects").document(project_id).collection("transcodeJobs")


async def save_transcode_job(job: TranscodeJob) -> None:
    """Save a transcode job to Firestore."""
    collection = _get_job_collection(job.user_id, job.project_id)

    data = {
        "id": job.id,
        "assetId": job.asset_id,
        "assetName": job.asset_name,
        "fileName": job.file_name,
        "mimeType": job.mime_type,
        "inputGcsUri": job.input_gcs_uri,
        "outputGcsUri": job.output_gcs_uri,
        "status": job.status,
        "jobName": job.job_name,
        "config": job.config,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }

    if job.error:
        data["error"] = job.error
    if job.output_signed_url:
        data["outputSignedUrl"] = job.output_signed_url
    if job.output_file_name:
        data["outputFileName"] = job.output_file_name
    if job.output_size:
        data["outputSize"] = job.output_size
    if job.output_duration:
        data["outputDuration"] = job.output_duration

    collection.document(job.id).set(data)
    logger.info(f"Saved transcode job {job.id} for asset {job.asset_id}")


async def get_transcode_job(user_id: str, project_id: str, job_id: str) -> TranscodeJob | None:
    """Get a transcode job by ID."""
    collection = _get_job_collection(user_id, project_id)
    doc = collection.document(job_id).get()

    if not doc.exists:
        return None

    data = doc.to_dict()
    return _doc_to_job(data, user_id, project_id)


async def update_transcode_job(
    user_id: str,
    project_id: str,
    job_id: str,
    updates: dict[str, Any],
) -> None:
    """Update a transcode job."""
    collection = _get_job_collection(user_id, project_id)
    updates["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    collection.document(job_id).update(updates)
    logger.info(f"Updated transcode job {job_id}: {list(updates.keys())}")


async def find_latest_transcode_job_for_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    config_hash: str | None = None,
) -> TranscodeJob | None:
    """
    Find the latest transcode job for an asset.

    If config_hash is provided, only return jobs with matching config.
    """
    collection = _get_job_collection(user_id, project_id)

    query = collection.where("assetId", "==", asset_id).order_by(
        "createdAt", direction=firestore.Query.DESCENDING
    ).limit(10)

    docs = query.stream()

    for doc in docs:
        data = doc.to_dict()
        job = _doc_to_job(data, user_id, project_id)

        # If config_hash specified, check if it matches
        if config_hash:
            job_config_hash = data.get("config", {}).get("hash")
            if job_config_hash != config_hash:
                continue

        return job

    return None


async def list_transcode_jobs_for_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    limit: int = 10,
) -> list[TranscodeJob]:
    """List all transcode jobs for an asset."""
    collection = _get_job_collection(user_id, project_id)

    query = collection.where("assetId", "==", asset_id).order_by(
        "createdAt", direction=firestore.Query.DESCENDING
    ).limit(limit)

    docs = query.stream()
    return [_doc_to_job(doc.to_dict(), user_id, project_id) for doc in docs]


def _doc_to_job(data: dict[str, Any], user_id: str, project_id: str) -> TranscodeJob:
    """Convert Firestore document to TranscodeJob."""
    return TranscodeJob(
        id=data["id"],
        asset_id=data["assetId"],
        asset_name=data.get("assetName", ""),
        file_name=data.get("fileName", ""),
        mime_type=data.get("mimeType", ""),
        input_gcs_uri=data.get("inputGcsUri", ""),
        output_gcs_uri=data.get("outputGcsUri"),
        status=data.get("status", "pending"),
        job_name=data.get("jobName"),
        config=data.get("config", {}),
        error=data.get("error"),
        created_at=data.get("createdAt", ""),
        updated_at=data.get("updatedAt", ""),
        user_id=user_id,
        project_id=project_id,
        output_signed_url=data.get("outputSignedUrl"),
        output_file_name=data.get("outputFileName"),
        output_size=data.get("outputSize"),
        output_duration=data.get("outputDuration"),
    )
