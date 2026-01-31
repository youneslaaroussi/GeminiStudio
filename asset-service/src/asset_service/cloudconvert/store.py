"""Firestore storage for CloudConvert conversion jobs."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, asdict
from typing import Any

from ..config import get_settings
from ..storage.firestore import get_firestore_client

logger = logging.getLogger(__name__)


@dataclass
class ConversionJob:
    """Represents a CloudConvert conversion job."""
    id: str
    asset_id: str
    asset_name: str
    file_name: str | None
    mime_type: str
    input_format: str
    output_format: str
    input_gcs_uri: str
    output_gcs_uri: str | None
    output_signed_url: str | None
    output_file_name: str | None
    status: str  # "pending", "processing", "completed", "error"
    cloudconvert_job_id: str | None
    config: dict[str, Any]
    error: str | None
    created_at: str
    updated_at: str
    user_id: str
    project_id: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ConversionJob:
        return cls(
            id=data.get("id", ""),
            asset_id=data.get("asset_id", ""),
            asset_name=data.get("asset_name", ""),
            file_name=data.get("file_name"),
            mime_type=data.get("mime_type", ""),
            input_format=data.get("input_format", ""),
            output_format=data.get("output_format", ""),
            input_gcs_uri=data.get("input_gcs_uri", ""),
            output_gcs_uri=data.get("output_gcs_uri"),
            output_signed_url=data.get("output_signed_url"),
            output_file_name=data.get("output_file_name"),
            status=data.get("status", "pending"),
            cloudconvert_job_id=data.get("cloudconvert_job_id"),
            config=data.get("config", {}),
            error=data.get("error"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            user_id=data.get("user_id", ""),
            project_id=data.get("project_id", ""),
        )


def _get_collection_path(user_id: str, project_id: str) -> str:
    """Get the Firestore collection path for conversion jobs."""
    return f"users/{user_id}/projects/{project_id}/conversionJobs"


async def save_conversion_job(job: ConversionJob) -> None:
    """Save a conversion job to Firestore."""
    settings = get_settings()
    db = get_firestore_client(settings)
    
    def _save():
        collection_path = _get_collection_path(job.user_id, job.project_id)
        doc_ref = db.collection(collection_path).document(job.id)
        doc_ref.set(job.to_dict())
        logger.info(f"Saved conversion job {job.id}")
    
    await asyncio.to_thread(_save)


async def get_conversion_job(
    user_id: str,
    project_id: str,
    job_id: str,
) -> ConversionJob | None:
    """Get a conversion job by ID."""
    settings = get_settings()
    db = get_firestore_client(settings)
    
    def _get():
        collection_path = _get_collection_path(user_id, project_id)
        doc = db.collection(collection_path).document(job_id).get()
        if doc.exists:
            return ConversionJob.from_dict(doc.to_dict())
        return None
    
    return await asyncio.to_thread(_get)


async def update_conversion_job(
    user_id: str,
    project_id: str,
    job_id: str,
    updates: dict[str, Any],
) -> None:
    """Update a conversion job."""
    settings = get_settings()
    db = get_firestore_client(settings)
    
    def _update():
        collection_path = _get_collection_path(user_id, project_id)
        doc_ref = db.collection(collection_path).document(job_id)
        doc_ref.update(updates)
        logger.debug(f"Updated conversion job {job_id}")
    
    await asyncio.to_thread(_update)


async def find_latest_conversion_job_for_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    *,
    output_format: str | None = None,
) -> ConversionJob | None:
    """
    Find the latest conversion job for an asset.
    
    Optionally filter by output format.
    """
    settings = get_settings()
    db = get_firestore_client(settings)
    
    def _find():
        collection_path = _get_collection_path(user_id, project_id)
        query = db.collection(collection_path).where("asset_id", "==", asset_id)
        
        if output_format:
            query = query.where("output_format", "==", output_format)
        
        query = query.order_by("created_at", direction="DESCENDING").limit(1)
        
        docs = list(query.stream())
        if docs:
            return ConversionJob.from_dict(docs[0].to_dict())
        return None
    
    return await asyncio.to_thread(_find)
