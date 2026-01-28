"""Google Cloud Speech-to-Text configuration and utilities."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from google.oauth2 import service_account
import google.auth
import google.auth.transport.requests

from ..config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class SpeechEnv:
    """Speech-to-Text environment configuration."""

    project_id: str
    location: str
    recognizer_id: str
    model: str
    language_codes: list[str]
    bucket: str


def get_speech_env() -> SpeechEnv:
    """Get Speech-to-Text environment configuration."""
    settings = get_settings()

    project_id = settings.effective_speech_project_id
    if not project_id:
        raise ValueError("SPEECH_PROJECT_ID or GOOGLE_PROJECT_ID must be configured")

    bucket = settings.effective_speech_bucket
    if not bucket:
        raise ValueError("SPEECH_GCS_BUCKET or ASSET_GCS_BUCKET must be configured")

    return SpeechEnv(
        project_id=project_id,
        location=settings.speech_location,
        recognizer_id=settings.speech_recognizer_id,
        model=settings.speech_model,
        language_codes=settings.speech_language_codes_list,
        bucket=bucket,
    )


def get_speech_access_token() -> str:
    """Get an access token for Speech-to-Text API."""
    settings = get_settings()
    key_path = (
        settings.speech_service_account_key
        or settings.google_service_account_key
        or settings.firebase_service_account_key
    )

    if key_path:
        path = Path(key_path).expanduser()
        if path.exists():
            credentials = service_account.Credentials.from_service_account_file(
                str(path),
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
        else:
            # Try parsing as JSON
            key_data = json.loads(key_path)
            credentials = service_account.Credentials.from_service_account_info(
                key_data,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
    else:
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )

    # Refresh credentials to get token
    request = google.auth.transport.requests.Request()
    credentials.refresh(request)

    return credentials.token
