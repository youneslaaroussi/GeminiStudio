"""Tests for the time tool."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from langgraph_server.tools.time_tool import get_current_time_utc


class TestGetCurrentTimeUtc:
    """Tests for get_current_time_utc tool."""

    def test_returns_iso_format(self):
        """Should return a valid ISO8601 timestamp."""
        result = get_current_time_utc.invoke({})
        
        # Should be parseable as ISO format
        parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
        assert parsed is not None

    def test_returns_utc_timezone(self):
        """Should return time in UTC timezone."""
        result = get_current_time_utc.invoke({})
        
        # Should contain timezone info indicating UTC
        assert "+" in result or "Z" in result or "UTC" in result

    def test_returns_recent_time(self):
        """Should return a time close to now."""
        before = datetime.now(timezone.utc)
        result = get_current_time_utc.invoke({})
        after = datetime.now(timezone.utc)
        
        # Parse the result
        parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
        
        # Should be between before and after
        assert before <= parsed <= after

    def test_returns_string(self):
        """Should return a string type."""
        result = get_current_time_utc.invoke({})
        assert isinstance(result, str)
