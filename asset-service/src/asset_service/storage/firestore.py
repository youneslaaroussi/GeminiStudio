"""Firestore operations for asset metadata."""

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


def _get_credentials(settings: Settings):
    """Get Firebase credentials from service account key."""
    key_path = settings.firebase_service_account_key or settings.google_service_account_key
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


# Asset document structure:
# users/{userId}/projects/{projectId}/assets/{assetId}
# {
#   id: string
#   name: string
#   mimeType: string
#   size: number
#   type: "video" | "audio" | "image" | "other"
#   gcsUri: string
#   signedUrl: string (optional, refreshed on access)
#   width: number (optional)
#   height: number (optional)
#   duration: number (optional)
#   uploadedAt: string (ISO)
#   updatedAt: string (ISO)
#   source: "web" | "telegram" | "api"
#   pipelineState: object (optional, denormalized for quick access)
# }


def save_asset(
    user_id: str,
    project_id: str,
    asset_data: dict[str, Any],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Save an asset to Firestore.

    Args:
        user_id: User ID
        project_id: Project ID
        asset_data: Asset data dict (must include 'id')
        settings: Optional settings override

    Returns:
        The saved asset data
    """
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    asset_id = asset_data.get("id")
    if not asset_id:
        raise ValueError("asset_data must include 'id'")

    now = datetime.utcnow().isoformat() + "Z"
    asset_data.setdefault("uploadedAt", now)
    asset_data["updatedAt"] = now

    doc_ref = db.collection("users").document(user_id).collection("projects").document(project_id).collection("assets").document(asset_id)
    doc_ref.set(asset_data)

    logger.info(f"Saved asset {asset_id} for user {user_id} project {project_id}")
    return asset_data


def get_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    """Get an asset by ID."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = db.collection("users").document(user_id).collection("projects").document(project_id).collection("assets").document(asset_id)
    doc = doc_ref.get()

    if not doc.exists:
        return None

    data = doc.to_dict()
    data["id"] = doc.id
    return data


def list_assets(
    user_id: str,
    project_id: str,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """List all assets for a project."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    collection_ref = db.collection("users").document(user_id).collection("projects").document(project_id).collection("assets")
    docs = collection_ref.stream()

    assets = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        assets.append(data)

    return assets


def update_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    updates: dict[str, Any],
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    """Update an asset."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = db.collection("users").document(user_id).collection("projects").document(project_id).collection("assets").document(asset_id)
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


def delete_asset(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> bool:
    """Delete an asset. Returns True if deleted, False if not found."""
    settings = settings or get_settings()
    db = get_firestore_client(settings)

    doc_ref = db.collection("users").document(user_id).collection("projects").document(project_id).collection("assets").document(asset_id)
    doc = doc_ref.get()

    if not doc.exists:
        return False

    doc_ref.delete()
    logger.info(f"Deleted asset {asset_id}")
    return True
