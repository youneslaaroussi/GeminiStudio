"""Tests for the subscribeToAssetPipeline tool."""

import pytest
from unittest.mock import AsyncMock, patch

from tests.helpers import ainvoke_with_context
from langgraph_server.tools.subscribe_pipeline_tool import subscribeToAssetPipeline


class TestSubscribeToAssetPipeline:
    """Test suite for subscribeToAssetPipeline tool."""

    @pytest.mark.asyncio
    @patch("langgraph_server.pipeline_events.subscribe_to_asset_pipeline")
    @patch("langgraph_server.tools.subscribe_pipeline_tool.get_settings")
    async def test_subscribe_success(self, mock_get_settings, mock_subscribe):
        """Should successfully subscribe to an asset pipeline."""
        mock_subscribe.return_value = None
        mock_get_settings.return_value = AsyncMock()

        result = await ainvoke_with_context(
            subscribeToAssetPipeline,
            thread_id="telegram-456",
            project_id="proj-789",
            asset_id="asset-abc",
            asset_name="test-video.mp4",
        )

        assert result["status"] == "subscribed"
        assert result["assetId"] == "asset-abc"
        assert result["assetName"] == "test-video.mp4"
        assert "watching" in result["message"].lower()

        mock_subscribe.assert_called_once_with(
            asset_id="asset-abc",
            thread_id="telegram-456",
            user_id="user-123",
            project_id="proj-789",
            asset_name="test-video.mp4",
            branch_id="main",
        )

    @pytest.mark.asyncio
    @patch("langgraph_server.tools.subscribe_pipeline_tool.get_settings")
    async def test_missing_user_id(self, mock_get_settings):
        """Should return error when user_id is missing."""
        mock_get_settings.return_value = AsyncMock()

        result = await ainvoke_with_context(
            subscribeToAssetPipeline,
            user_id=None,
            thread_id="telegram-456",
            project_id="proj-789",
            asset_id="asset-abc",
        )

        assert result["status"] == "error"
        assert result["reason"] == "missing_user"

    @pytest.mark.asyncio
    @patch("langgraph_server.tools.subscribe_pipeline_tool.get_settings")
    async def test_missing_thread_id(self, mock_get_settings):
        """Should return error when thread_id is missing."""
        mock_get_settings.return_value = AsyncMock()

        result = await ainvoke_with_context(
            subscribeToAssetPipeline,
            asset_id="asset-abc",
            # no thread_id -> context has no thread_id
        )

        assert result["status"] == "error"
        assert result["reason"] == "missing_thread"

    @pytest.mark.asyncio
    @patch("langgraph_server.tools.subscribe_pipeline_tool.get_settings")
    async def test_invalid_asset_id(self, mock_get_settings):
        """Should return error when asset_id is invalid."""
        mock_get_settings.return_value = AsyncMock()

        result = await ainvoke_with_context(
            subscribeToAssetPipeline,
            thread_id="telegram-456",
            project_id="proj-789",
            asset_id="  ",  # whitespace only
        )

        assert result["status"] == "error"
        assert result["reason"] == "invalid_asset_id"
