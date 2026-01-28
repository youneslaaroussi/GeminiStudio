from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import auth, credentials
from firebase_admin._apps import DEFAULT_APP_NAME  # type: ignore[attr-defined]

from .config import Settings


@lru_cache(maxsize=1)
def _service_account_path(settings: Settings) -> Optional[Path]:
    if settings.firebase_service_account_json:
        path = Path(settings.firebase_service_account_json).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"Firebase service account file not found: {path}")
        return path
    return None


def initialize_firebase(settings: Settings) -> firebase_admin.App:
    if firebase_admin._apps:
        return firebase_admin.get_app()

    svc_path = _service_account_path(settings)
    if svc_path:
        cred = credentials.Certificate(str(svc_path))
        return firebase_admin.initialize_app(cred, {"projectId": settings.google_project_id})

    cred = credentials.ApplicationDefault()
    return firebase_admin.initialize_app(cred, {"projectId": settings.google_project_id})


def lookup_email_by_phone(phone_number: str, settings: Settings) -> Optional[str]:
    initialize_firebase(settings)
    try:
        user_record = auth.get_user_by_phone_number(phone_number)
    except auth.UserNotFoundError:
        return None
    return user_record.email
