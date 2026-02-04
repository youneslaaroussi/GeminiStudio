"""HMAC authentication for asset service requests."""

from __future__ import annotations

import hashlib
import hmac
import time

from .config import get_settings


def _sign_request(body: str, timestamp: int, secret: str) -> str:
    """Sign a request body with HMAC-SHA256."""
    payload = f"{timestamp}.{body}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def get_asset_service_headers(body: str = "") -> dict[str, str]:
    """Get headers for authenticated asset service GET requests.
    Returns empty dict if shared secret not configured.
    """
    settings = get_settings()
    if not settings.asset_service_shared_secret:
        return {}
    timestamp = int(time.time() * 1000)
    signature = _sign_request(body, timestamp, settings.asset_service_shared_secret)
    return {
        "X-Signature": signature,
        "X-Timestamp": str(timestamp),
    }


def get_asset_service_upload_headers(file_bytes: bytes) -> dict[str, str]:
    """Get headers for authenticated asset service file uploads."""
    settings = get_settings()
    if not settings.asset_service_shared_secret:
        return {}
    body_hash = hashlib.sha256(file_bytes).hexdigest()
    timestamp = int(time.time() * 1000)
    signature = _sign_request(body_hash, timestamp, settings.asset_service_shared_secret)
    return {
        "X-Signature": signature,
        "X-Timestamp": str(timestamp),
        "X-Body-Hash": body_hash,
    }
