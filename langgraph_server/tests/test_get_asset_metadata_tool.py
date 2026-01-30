"""Tests for the get asset metadata tool."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
import httpx

from langgraph_server.tools.get_asset_metadata_tool import getAssetMetadata


@pytest.fixture
def sample_pipeline_state():
    """Sample pipeline state with metadata."""
    return {
        "assetId": "asset-123",
        "steps": [
            {
                "id": "metadata",
                "label": "File Metadata",
                "status": "succeeded",
                "metadata": {
                    "duration": 45.5,
                    "width": 1920,
                    "height": 1080,
                    "videoCodec": "h264",
                },
                "updatedAt": "2024-01-15T10:30:00Z",
            },
            {
                "id": "face-detection",
                "label": "Face Detection",
                "status": "succeeded",
                "metadata": {
                    "faceCount": 3,
                    "faces": [
                        {"faceIndex": 0, "trackCount": 5},
                        {"faceIndex": 1, "trackCount": 3},
                        {"faceIndex": 2, "trackCount": 2},
                    ],
                },
                "updatedAt": "2024-01-15T10:31:00Z",
            },
            {
                "id": "shot-detection",
                "label": "Shot Detection",
                "status": "succeeded",
                "metadata": {
                    "shotCount": 7,
                    "shots": [
                        {"index": 0, "start": 0, "end": 5.5, "duration": 5.5},
                    ],
                },
                "updatedAt": "2024-01-15T10:32:00Z",
            },
            {
                "id": "transcription",
                "label": "Transcription",
                "status": "running",
                "metadata": {},
                "updatedAt": "2024-01-15T10:33:00Z",
            },
        ],
        "updatedAt": "2024-01-15T10:33:00Z",
    }


class TestGetAssetMetadata:
    """Tests for getAssetMetadata tool."""

    def test_requires_user_id(self, mock_settings):
        """Should return error if user_id is missing."""
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": None,
        })
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_requires_project_id(self, mock_settings):
        """Should return error if project_id is missing."""
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": None,
            "user_id": "user-123",
        })
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_requires_asset_id(self, mock_settings):
        """Should return error if asset_id is missing."""
        result = getAssetMetadata.invoke({
            "asset_id": "",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "error"
        assert "asset_id" in result["message"].lower()

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_returns_metadata_on_success(
        self, mock_get, mock_get_settings, mock_settings, sample_pipeline_state
    ):
        """Should return formatted metadata on success."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_pipeline_state
        mock_get.return_value = mock_response
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "success"
        assert "outputs" in result
        
        # Check list output
        list_output = next(o for o in result["outputs"] if o["type"] == "list")
        assert "asset-123" in list_output["title"]
        
        # Check JSON output
        json_output = next(o for o in result["outputs"] if o["type"] == "json")
        assert json_output["data"]["assetId"] == "asset-123"
        assert "face-detection" in json_output["data"]["metadata"]
        assert "shot-detection" in json_output["data"]["metadata"]

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_filters_by_metadata_type(
        self, mock_get, mock_get_settings, mock_settings, sample_pipeline_state
    ):
        """Should filter by metadata type when specified."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_pipeline_state
        mock_get.return_value = mock_response
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
            "metadata_type": "face-detection",
        })
        
        assert result["status"] == "success"
        json_output = next(o for o in result["outputs"] if o["type"] == "json")
        # Should only have face-detection
        assert "face-detection" in json_output["data"]["metadata"]
        assert "shot-detection" not in json_output["data"]["metadata"]

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_handles_running_step(
        self, mock_get, mock_get_settings, mock_settings, sample_pipeline_state
    ):
        """Should show 'Processing...' for running steps."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_pipeline_state
        mock_get.return_value = mock_response
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "success"
        list_output = next(o for o in result["outputs"] if o["type"] == "list")
        # Check that transcription shows processing
        items_text = " ".join(item["text"] for item in list_output["items"])
        assert "Processing" in items_text

    def test_invalid_metadata_type(self, mock_settings):
        """Should return error for invalid metadata type."""
        with patch("langgraph_server.tools.get_asset_metadata_tool.get_settings") as mock_get_settings:
            mock_get_settings.return_value = mock_settings
            
            result = getAssetMetadata.invoke({
                "asset_id": "asset-123",
                "project_id": "proj-123",
                "user_id": "user-123",
                "metadata_type": "invalid-type",
            })
            
            assert result["status"] == "error"
            assert "invalid" in result["message"].lower()

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_handles_404_not_found(self, mock_get, mock_get_settings, mock_settings):
        """Should handle 404 responses gracefully."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = "Not found"
        mock_get.return_value = mock_response
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "error"
        assert "not found" in result["message"].lower()

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_handles_http_error(self, mock_get, mock_get_settings, mock_settings):
        """Should handle HTTP errors gracefully."""
        mock_get_settings.return_value = mock_settings
        mock_get.side_effect = httpx.HTTPError("Connection failed")
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "error"
        assert "reach" in result["message"].lower() or "could not" in result["message"].lower()

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    def test_handles_missing_asset_service_url(self, mock_get_settings):
        """Should handle missing asset service URL."""
        settings = MagicMock()
        settings.asset_service_url = None
        mock_get_settings.return_value = settings
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "error"
        assert "not configured" in result["message"].lower()

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_calls_correct_endpoint(self, mock_get, mock_get_settings, mock_settings):
        """Should call the correct pipeline endpoint."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"assetId": "asset-123", "steps": []}
        mock_get.return_value = mock_response
        
        getAssetMetadata.invoke({
            "asset_id": "asset-456",
            "project_id": "proj-789",
            "user_id": "user-012",
        })
        
        mock_get.assert_called_once()
        call_url = mock_get.call_args[0][0]
        assert "user-012" in call_url
        assert "proj-789" in call_url
        assert "asset-456" in call_url
        assert "/api/pipeline/" in call_url

    @patch("langgraph_server.tools.get_asset_metadata_tool.get_settings")
    @patch("langgraph_server.tools.get_asset_metadata_tool.httpx.get")
    def test_handles_empty_pipeline_state(self, mock_get, mock_get_settings, mock_settings):
        """Should handle empty pipeline state gracefully."""
        mock_get_settings.return_value = mock_settings
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"assetId": "asset-123", "steps": []}
        mock_get.return_value = mock_response
        
        result = getAssetMetadata.invoke({
            "asset_id": "asset-123",
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        
        assert result["status"] == "success"
        # Should indicate no metadata available
        text_output = result["outputs"][0]
        assert "no metadata" in text_output["text"].lower() or "pipeline" in text_output["text"].lower()
