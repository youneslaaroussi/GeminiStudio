"""Transcription job storage in Firestore."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..config import Settings, get_settings
from ..storage.firestore import get_firestore_client

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionJob:
    """Transcription job data."""

    id: str
    asset_id: str
    asset_name: str
    file_name: str
    mime_type: str
    gcs_uri: str
    status: str  # "processing", "succeeded", "failed"
    language_codes: list[str]
    created_at: str
    updated_at: str
    user_id: str
    project_id: str
    operation_name: str | None = None
    transcript: str | None = None
    error: str | None = None
    segments: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TranscriptionJob:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            asset_id=data.get("assetId", data.get("asset_id", "")),
            asset_name=data.get("assetName", data.get("asset_name", "")),
            file_name=data.get("fileName", data.get("file_name", "")),
            mime_type=data.get("mimeType", data.get("mime_type", "")),
            gcs_uri=data.get("gcsUri", data.get("gcs_uri", "")),
            status=data.get("status", "processing"),
            language_codes=data.get("languageCodes", data.get("language_codes", [])),
            created_at=data.get("createdAt", data.get("created_at", "")),
            updated_at=data.get("updatedAt", data.get("updated_at", "")),
            user_id=data.get("userId", data.get("user_id", "")),
            project_id=data.get("projectId", data.get("project_id", "")),
            operation_name=data.get("operationName", data.get("operation_name")),
            transcript=data.get("transcript"),
            error=data.get("error"),
            segments=data.get("segments", []),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (camelCase for Firestore)."""
        result = {
            "id": self.id,
            "assetId": self.asset_id,
            "assetName": self.asset_name,
            "fileName": self.file_name,
            "mimeType": self.mime_type,
            "gcsUri": self.gcs_uri,
            "status": self.status,
            "languageCodes": self.language_codes,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "userId": self.user_id,
            "projectId": self.project_id,
        }
        if self.operation_name:
            result["operationName"] = self.operation_name
        if self.transcript:
            result["transcript"] = self.transcript
        if self.error:
            result["error"] = self.error
        if self.segments:
            result["segments"] = self.segments
        return result


async def save_transcription_job(
    job: TranscriptionJob,
    settings: Settings | None = None,
) -> TranscriptionJob:
    """Save a transcription job to Firestore."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(job.user_id)
        .collection("projects")
        .document(job.project_id)
        .collection("transcriptions")
        .document(job.id)
    )

    await asyncio.to_thread(doc_ref.set, job.to_dict())
    logger.info(f"Saved transcription job {job.id}")
    return job


async def get_transcription_job(
    user_id: str,
    project_id: str,
    job_id: str,
    settings: Settings | None = None,
) -> TranscriptionJob | None:
    """Get a transcription job by ID."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("transcriptions")
        .document(job_id)
    )

    doc = await asyncio.to_thread(doc_ref.get)
    if not doc.exists:
        return None

    data = doc.to_dict()
    data["id"] = doc.id
    return TranscriptionJob.from_dict(data)


async def find_latest_job_for_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> TranscriptionJob | None:
    """Find the latest transcription job for an asset."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    collection_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("transcriptions")
    )

    query = (
        collection_ref
        .where("assetId", "==", asset_id)
        .order_by("createdAt", direction="DESCENDING")
        .limit(1)
    )

    docs = await asyncio.to_thread(lambda: list(query.stream()))
    if not docs:
        return None

    data = docs[0].to_dict()
    data["id"] = docs[0].id
    return TranscriptionJob.from_dict(data)


async def update_transcription_job(
    user_id: str,
    project_id: str,
    job_id: str,
    updates: dict[str, Any],
    settings: Settings | None = None,
) -> TranscriptionJob | None:
    """Update a transcription job."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("transcriptions")
        .document(job_id)
    )

    doc = await asyncio.to_thread(doc_ref.get)
    if not doc.exists:
        return None

    updates["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    await asyncio.to_thread(doc_ref.update, updates)

    updated_doc = await asyncio.to_thread(doc_ref.get)
    data = updated_doc.to_dict()
    data["id"] = updated_doc.id
    return TranscriptionJob.from_dict(data)


async def list_transcription_jobs(
    user_id: str,
    project_id: str,
    settings: Settings | None = None,
) -> list[TranscriptionJob]:
    """List all transcription jobs for a project."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    collection_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("transcriptions")
    )

    docs = await asyncio.to_thread(lambda: list(collection_ref.stream()))
    jobs = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        jobs.append(TranscriptionJob.from_dict(data))

    return jobs
