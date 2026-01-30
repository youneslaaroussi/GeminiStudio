"""Firestore operations for video effect jobs."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None

# Collection path: video-effects-jobs/{jobId}
COLLECTION_NAME = "video-effects-jobs"


def _get_credentials(settings: Settings):
    """Get Firebase credentials from service account key."""
    key_path = settings.firebase_service_account_key
    if not key_path:
        return None

    path = Path(key_path).expanduser()
    if path.exists():
        return credentials.Certificate(str(path))

    # Try parsing as JSON
    import json

    try:
        key_data = json.loads(key_path)
        return credentials.Certificate(key_data)
    except json.JSONDecodeError:
        raise ValueError(f"Invalid service account key: {key_path}")


def _initialize_firebase(settings: Settings) -> firebase_admin.App:
    """Initialize Firebase Admin SDK."""
    global _app
    if _app is not None:
        return _app

    if firebase_admin._apps:
        _app = firebase_admin.get_app()
        return _app

    cred = _get_credentials(settings)
    if cred:
        _app = firebase_admin.initialize_app(cred)
    else:
        _app = firebase_admin.initialize_app()

    return _app


def get_firestore_client(settings: Settings | None = None):
    """Get a Firestore client."""
    settings = settings or get_settings()
    _initialize_firebase(settings)
    return firestore.client()


def save_job(job_data: dict[str, Any], settings: Settings | None = None) -> dict[str, Any]:
    """
    Save a video effect job to Firestore.

    Args:
        job_data: Job data dict (must include 'id')
        settings: Optional settings override

    Returns:
        The saved job data
    """
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    job_id = job_data.get("id")
    if not job_id:
        raise ValueError("job_data must include 'id'")

    now = datetime.utcnow().isoformat() + "Z"
    job_data.setdefault("createdAt", now)
    job_data["updatedAt"] = now

    doc_ref = db.collection(COLLECTION_NAME).document(job_id)
    doc_ref.set(job_data)

    logger.info(f"Saved video effect job {job_id}")
    return job_data


def get_job(job_id: str, settings: Settings | None = None) -> dict[str, Any] | None:
    """Get a job by ID."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = db.collection(COLLECTION_NAME).document(job_id)
    doc = doc_ref.get()

    if not doc.exists:
        return None

    data = doc.to_dict()
    data["id"] = doc.id
    return data


def update_job(
    job_id: str,
    updates: dict[str, Any],
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    """Update a job."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = db.collection(COLLECTION_NAME).document(job_id)
    doc = doc_ref.get()

    if not doc.exists:
        return None

    updates["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    doc_ref.update(updates)

    # Return updated document
    updated_doc = doc_ref.get()
    data = updated_doc.to_dict()
    data["id"] = updated_doc.id
    return data


def list_jobs_by_asset(
    asset_id: str,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """List all jobs for an asset, ordered by creation time (newest first)."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    collection_ref = db.collection(COLLECTION_NAME)
    query = collection_ref.where("assetId", "==", asset_id).order_by(
        "createdAt", direction=firestore.Query.DESCENDING
    )
    docs = query.stream()

    jobs = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        jobs.append(data)

    return jobs
