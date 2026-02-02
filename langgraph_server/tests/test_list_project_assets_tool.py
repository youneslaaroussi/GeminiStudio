"""Tests for the list project assets tool."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
import httpx

from tests.helpers import agent_context, invoke_with_context
from langgraph_server.tools.list_project_assets_tool import listProjectAssets


class TestListProjectAssets:
    """Tests for listProjectAssets tool."""

    def test_requires_user_id(self, mock_settings):
        """Should return error if user_id is missing."""
        result = invoke_with_context(listProjectAssets, user_id=None)
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_requires_project_id(self, mock_settings):
        """Should return error if project_id is missing."""
        result = invoke_with_context(listProjectAssets, project_id=None)
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    @patch("langgraph_server.tools.list_project_assets_tool.httpx.get")
    def test_returns_assets_on_success(self, mock_get, mock_get_settings, mock_settings, sample_assets):
        """Should return formatted asset list on success."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_assets
        mock_get.return_value = mock_response
        
        result = invoke_with_context(listProjectAssets)
        
        assert result["status"] == "success"
        assert "outputs" in result
        
        # Check list output
        list_output = next(o for o in result["outputs"] if o["type"] == "list")
        assert "3 assets" in list_output["title"]
        
        # Check JSON output
        json_output = next(o for o in result["outputs"] if o["type"] == "json")
        assert len(json_output["data"]) == 3

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    @patch("langgraph_server.tools.list_project_assets_tool.httpx.get")
    def test_handles_empty_assets(self, mock_get, mock_get_settings, mock_settings):
        """Should handle empty asset list gracefully."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []
        mock_get.return_value = mock_response
        
        result = invoke_with_context(listProjectAssets)
        
        assert result["status"] == "success"
        list_output = next(o for o in result["outputs"] if o["type"] == "list")
        assert "0 assets" in list_output["title"]

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    @patch("langgraph_server.tools.list_project_assets_tool.httpx.get")
    def test_handles_http_error(self, mock_get, mock_get_settings, mock_settings):
        """Should handle HTTP errors gracefully."""
        mock_get_settings.return_value = mock_settings
        mock_get.side_effect = httpx.HTTPError("Connection failed")
        
        result = invoke_with_context(listProjectAssets)
        
        assert result["status"] == "error"
        assert "reach" in result["message"].lower() or "contact" in result["message"].lower()

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    @patch("langgraph_server.tools.list_project_assets_tool.httpx.get")
    def test_handles_non_200_response(self, mock_get, mock_get_settings, mock_settings):
        """Should handle non-200 HTTP responses."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = "Not found"
        mock_get.return_value = mock_response
        
        result = invoke_with_context(listProjectAssets)
        
        assert result["status"] == "error"
        assert "404" in result["message"]

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    def test_handles_missing_asset_service_url(self, mock_get_settings):
        """Should handle missing asset service URL."""
        settings = MagicMock()
        settings.asset_service_url = None
        mock_get_settings.return_value = settings
        
        result = invoke_with_context(listProjectAssets)
        
        assert result["status"] == "error"
        assert "not configured" in result["message"].lower()

    @patch("langgraph_server.tools.list_project_assets_tool.get_settings")
    @patch("langgraph_server.tools.list_project_assets_tool.httpx.get")
    def test_calls_correct_endpoint(self, mock_get, mock_get_settings, mock_settings):
        """Should call the correct asset service endpoint."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []
        mock_get.return_value = mock_response
        
        invoke_with_context(listProjectAssets, user_id="user-456", project_id="proj-123")
        
        mock_get.assert_called_once()
        call_url = mock_get.call_args[0][0]
        assert "user-456" in call_url
        assert "proj-123" in call_url
        assert "/api/assets/" in call_url
