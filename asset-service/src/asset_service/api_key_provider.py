"""Thread-safe Gemini API key provider with rotation on 429 (quota exhausted)."""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import Settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_keys: list[str] = []
_index: int = 0
_initialized: bool = False


def _get_keys_list(settings: Settings) -> list[str]:
    """Resolve list of API keys from settings. Prefer GEMINI_API_KEYS; fallback to GEMINI_API_KEY."""
    if settings.gemini_api_keys:
        keys = [k.strip() for k in settings.gemini_api_keys.split(",") if k.strip()]
        if keys:
            return keys
    if settings.gemini_api_key:
        return [settings.gemini_api_key]
    return []


def init_api_key_provider(settings: Settings) -> None:
    """Initialize the global API key provider from settings. Safe to call multiple times."""
    global _keys, _index, _initialized
    keys = _get_keys_list(settings)
    with _lock:
        _keys = keys
        _index = 0
        _initialized = True
    if len(keys) > 1:
        logger.info("[API_KEY_PROVIDER] Using %d Gemini API keys (rotation on 429)", len(keys))
    elif keys:
        logger.debug("[API_KEY_PROVIDER] Using single Gemini API key")
    else:
        logger.warning("[API_KEY_PROVIDER] No Gemini API keys configured")


def get_current_key() -> str | None:
    """Return the current API key, or None if none configured."""
    with _lock:
        if not _keys:
            return None
        return _keys[_index % len(_keys)]


def rotate_next_key() -> None:
    """Switch to the next API key (e.g. after 429). Wraps around."""
    global _index
    with _lock:
        if not _keys:
            return
        n = len(_keys)
        if n > 1:
            old_idx = _index
            _index = (_index + 1) % n
            logger.info("[API_KEY_PROVIDER] Rotated to key index %s (was %s)", _index, old_idx)


def keys_count() -> int:
    """Return number of configured keys."""
    with _lock:
        return len(_keys)


def is_quota_exhausted(exc: BaseException | int) -> bool:
    """Return True if the exception or status code indicates Gemini quota exhausted (429)."""
    if isinstance(exc, int):
        return exc == 429
    msg = str(exc).upper()
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "QUOTA" in msg
