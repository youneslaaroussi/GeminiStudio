"""Google Cloud Storage operations."""

from __future__ import annotations

import hashlib
import hmac
import base64
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

from google.cloud import storage
from google.oauth2 import service_account

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)


def _get_credentials(settings: Settings):
    """Get GCP credentials from service account key."""
    key_path = settings.google_service_account_key or settings.firebase_service_account_key
    if not key_path:
        return None

    path = Path(key_path).expanduser()
    if path.exists():
        return service_account.Credentials.from_service_account_file(str(path))

    # Try parsing as JSON
    import json
    try:
        key_data = json.loads(key_path)
        return service_account.Credentials.from_service_account_info(key_data)
    except json.JSONDecodeError:
        raise ValueError(f"Invalid service account key: {key_path}")


def _get_storage_client(settings: Settings | None = None) -> storage.Client:
    """Get a GCS client."""
    settings = settings or get_settings()
    credentials = _get_credentials(settings)
    return storage.Client(project=settings.google_project_id, credentials=credentials)


def upload_to_gcs(
    data: bytes | BinaryIO,
    destination: str,
    mime_type: str,
    settings: Settings | None = None,
) -> dict:
    """
    Upload data to GCS.

    Args:
        data: File data as bytes or file-like object
        destination: Object name in bucket (e.g., "assets/{id}/file.mp4")
        mime_type: MIME type of the file
        settings: Optional settings override

    Returns:
        Dict with gcs_uri, bucket, object_name
    """
    settings = settings or get_settings()
    client = _get_storage_client(settings)
    bucket = client.bucket(settings.asset_gcs_bucket)
    blob = bucket.blob(destination)

    if isinstance(data, bytes):
        blob.upload_from_string(data, content_type=mime_type)
    else:
        blob.upload_from_file(data, content_type=mime_type)

    gcs_uri = f"gs://{settings.asset_gcs_bucket}/{destination}"
    logger.info(f"Uploaded to {gcs_uri}")

    return {
        "gcs_uri": gcs_uri,
        "bucket": settings.asset_gcs_bucket,
        "object_name": destination,
    }


def download_from_gcs(
    gcs_uri: str,
    settings: Settings | None = None,
) -> bytes:
    """Download data from GCS."""
    settings = settings or get_settings()

    # Parse gs:// URI
    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    bucket_name, object_name = parts

    client = _get_storage_client(settings)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)

    return blob.download_as_bytes()


def create_signed_url(
    object_name: str,
    bucket: str | None = None,
    expires_in_seconds: int | None = None,
    settings: Settings | None = None,
) -> str:
    """
    Create a signed URL for reading an object.

    Args:
        object_name: Object name in bucket
        bucket: Bucket name (defaults to asset bucket)
        expires_in_seconds: URL expiration (defaults to settings)
        settings: Optional settings override

    Returns:
        Signed URL string
    """
    settings = settings or get_settings()
    bucket = bucket or settings.asset_gcs_bucket
    expires_in_seconds = expires_in_seconds or settings.signed_url_ttl_seconds

    client = _get_storage_client(settings)
    bucket_obj = client.bucket(bucket)
    blob = bucket_obj.blob(object_name)

    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_in_seconds),
        method="GET",
    )

    return url


def delete_from_gcs(
    gcs_uri: str,
    settings: Settings | None = None,
) -> bool:
    """
    Delete an object from GCS.

    Returns True if deleted, False if not found.
    """
    settings = settings or get_settings()

    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    bucket_name, object_name = parts

    client = _get_storage_client(settings)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)

    try:
        blob.delete()
        logger.info(f"Deleted {gcs_uri}")
        return True
    except Exception as e:
        if "404" in str(e):
            return False
        raise


def check_exists(
    gcs_uri: str,
    settings: Settings | None = None,
) -> bool:
    """Check if an object exists in GCS."""
    settings = settings or get_settings()

    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    bucket_name, object_name = parts

    client = _get_storage_client(settings)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)

    return blob.exists()
