"""Tests for the get project summary tool."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from langgraph_server.tools.get_project_summary_tool import getProjectSummary


class TestGetProjectSummary:
    """Tests for getProjectSummary tool."""

    def test_requires_user_id(self):
        """Should return error if user_id is missing."""
        result = getProjectSummary.invoke({
            "user_id": None,
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_returns_summary_on_success(
        self, mock_fetch, mock_get_settings, mock_settings, sample_project_data, sample_branch_info
    ):
        """Should return project summary on success."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = [
            {
                "id": "proj-123",
                "name": "Test Project",
                "_projectData": sample_project_data,
                "_branch": sample_branch_info,
            }
        ]
        
        result = getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "success"
        assert "outputs" in result
        
        # Check text output contains key info
        text_output = next(o for o in result["outputs"] if o["type"] == "text")
        assert "Test Project" in text_output["text"]
        assert "1920x1080" in text_output["text"]
        assert "30fps" in text_output["text"]

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_returns_json_data(
        self, mock_fetch, mock_get_settings, mock_settings, sample_project_data, sample_branch_info
    ):
        """Should include structured JSON data in response."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = [
            {
                "id": "proj-123",
                "name": "Test Project",
                "_projectData": sample_project_data,
                "_branch": sample_branch_info,
            }
        ]
        
        result = getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        json_output = next(o for o in result["outputs"] if o["type"] == "json")
        data = json_output["data"]
        
        assert data["name"] == "Test Project"
        assert data["resolution"]["width"] == 1920
        assert data["resolution"]["height"] == 1080
        assert data["fps"] == 30
        assert data["totalLayers"] == 2
        assert data["totalClips"] == 2

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_handles_no_projects(self, mock_fetch, mock_get_settings, mock_settings):
        """Should handle user with no projects."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = []
        
        result = getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "No project found" in result["message"]

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_handles_missing_project_data(self, mock_fetch, mock_get_settings, mock_settings):
        """Should handle project without timeline data."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = [
            {
                "id": "proj-123",
                "name": "Empty Project",
                "_projectData": None,
                "_branch": {},
            }
        ]
        
        result = getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "success"
        text_output = next(o for o in result["outputs"] if o["type"] == "text")
        assert "no timeline data" in text_output["text"].lower()

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_uses_branch_when_provided(self, mock_fetch, mock_get_settings, mock_settings, sample_project_data):
        """Should use branch_id when provided."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = [
            {
                "id": "proj-123",
                "name": "Test Project",
                "_projectData": sample_project_data,
                "_branch": {"branchId": "feature_chat_abc"},
            }
        ]
        
        getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
            "branch_id": "feature_chat_abc",
        })
        
        # Verify fetch was called with branch_id
        mock_fetch.assert_called_once()
        call_kwargs = mock_fetch.call_args
        assert call_kwargs[1].get("branch_id") == "feature_chat_abc"

    @patch("langgraph_server.tools.get_project_summary_tool.get_settings")
    @patch("langgraph_server.tools.get_project_summary_tool.fetch_user_projects")
    def test_calculates_total_duration(
        self, mock_fetch, mock_get_settings, mock_settings, sample_project_data, sample_branch_info
    ):
        """Should correctly calculate total timeline duration."""
        mock_get_settings.return_value = mock_settings
        mock_fetch.return_value = [
            {
                "id": "proj-123",
                "name": "Test Project",
                "_projectData": sample_project_data,
                "_branch": sample_branch_info,
            }
        ]
        
        result = getProjectSummary.invoke({
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        json_output = next(o for o in result["outputs"] if o["type"] == "json")
        # Video clip: 0+10=10s, Audio clip: 0+30=30s, max=30s
        assert json_output["data"]["totalDuration"] == 30.0
