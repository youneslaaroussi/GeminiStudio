"""HMAC authentication utilities for service-to-service communication."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Dict

from .config import get_settings


def sign_request(body: str, timestamp: int, secret: str) -> str:
    """Sign a request body with HMAC-SHA256."""
    payload = f"{timestamp}.{body}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def get_asset_service_headers(body: str = "") -> Dict[str, str]:
    """Get headers for authenticated asset service requests.
    
    Returns headers with HMAC signature if shared secret is configured,
    otherwise returns empty dict (dev mode).
    """
    settings = get_settings()
    headers: Dict[str, str] = {}
    
    if settings.asset_service_shared_secret:
        timestamp = int(time.time() * 1000)
        signature = sign_request(body, timestamp, settings.asset_service_shared_secret)
        headers["X-Signature"] = signature
        headers["X-Timestamp"] = str(timestamp)
    
    return headers


def get_asset_service_upload_headers(file_bytes: bytes) -> Dict[str, str]:
    """Get headers for authenticated file upload requests to asset service.
    
    For multipart uploads, we include a hash of the file content in the signature
    to ensure file integrity.
    """
    settings = get_settings()
    headers: Dict[str, str] = {}
    
    if settings.asset_service_shared_secret:
        # Compute hash of the entire request body (will be computed by httpx for multipart)
        # For simplicity, we hash just the file bytes - the server will hash the full body
        body_hash = hashlib.sha256(file_bytes).hexdigest()
        
        timestamp = int(time.time() * 1000)
        # Sign the body hash instead of empty string
        signature = sign_request(body_hash, timestamp, settings.asset_service_shared_secret)
        
        headers["X-Signature"] = signature
        headers["X-Timestamp"] = str(timestamp)
        headers["X-Body-Hash"] = body_hash
    
    return headers


def get_renderer_headers(body: str) -> Dict[str, str]:
    """Get headers for authenticated renderer requests."""
    settings = get_settings()
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    
    if settings.renderer_shared_secret:
        timestamp = int(time.time() * 1000)
        signature = sign_request(body, timestamp, settings.renderer_shared_secret)
        headers["X-Signature"] = signature
        headers["X-Timestamp"] = str(timestamp)
    
    return headers


def get_scene_compiler_headers(body: str) -> Dict[str, str]:
    """Get headers for authenticated scene compiler requests."""
    settings = get_settings()
    headers: Dict[str, str] = {"Content-Type": "application/json"}

    if settings.scene_compiler_shared_secret:
        timestamp = int(time.time() * 1000)
        signature = sign_request(body, timestamp, settings.scene_compiler_shared_secret)
        headers["X-Signature"] = signature
        headers["X-Timestamp"] = str(timestamp)

    return headers
