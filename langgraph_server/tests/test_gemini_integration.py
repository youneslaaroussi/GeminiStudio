"""
Real-API integration test for Gemini key rotation and model priority.
Uses .env from langgraph_server when present. Skips when GEMINI_API_KEYS / GOOGLE_API_KEY are not set.
Run from langgraph_server/: uv run python -m pytest tests/test_gemini_integration.py -v
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
GEMINI_KEYS = os.environ.get("GEMINI_API_KEYS", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


@pytest.mark.skipif(not GEMINI_KEYS, reason="GEMINI_API_KEYS or GOOGLE_API_KEY not set")
@pytest.mark.asyncio
async def test_title_generator_real_api():
    """Call real Gemini API via title generator (model list + key rotation)."""
    from langgraph_server.api_key_provider import get_current_key, init_api_key_provider
    from langgraph_server.config import get_settings
    from langgraph_server.title_generator import generate_project_title

    settings = get_settings()
    init_api_key_provider(settings)
    assert get_current_key(), "API key should be set when env is set"

    result = await generate_project_title("Make a short travel vlog about Japan", settings=settings)

    assert "accepted" in result
    if result.get("accepted") is True:
        assert result.get("title"), "Expected a title when accepted"
    else:
        assert "reason" in result


@pytest.mark.skipif(not GEMINI_KEYS, reason="GEMINI_API_KEYS or GOOGLE_API_KEY not set")
def test_chat_model_ids_from_config():
    """Config exposes chat_model_ids list (priority order)."""
    from langgraph_server.config import get_settings

    settings = get_settings()
    ids = settings.chat_model_ids
    assert isinstance(ids, list)
    assert len(ids) >= 1
    assert all(isinstance(s, str) and s for s in ids)
