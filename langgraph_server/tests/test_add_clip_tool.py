"""Tests for the add clip tool."""

from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

import pytest

from tests.helpers import agent_context, invoke_with_context
from langgraph_server.tools.add_clip_tool import (
    addClipToTimeline,
    _find_or_create_layer,
    _get_project_data,
    _set_project_data,
)


class TestFindOrCreateLayer:
    """Tests for the _find_or_create_layer helper."""

    def test_finds_existing_layer_by_id(self):
        """Should find layer by explicit layer_id."""
        project_data = {
            "layers": [
                {"id": "layer-1", "name": "Video", "type": "video", "clips": []},
                {"id": "layer-2", "name": "Audio", "type": "audio", "clips": []},
            ]
        }
        
        layer = _find_or_create_layer(project_data, "video", "layer-2")
        
        assert layer["id"] == "layer-2"

    def test_finds_existing_layer_by_type(self):
        """Should find layer by clip type if no layer_id."""
        project_data = {
            "layers": [
                {"id": "layer-1", "name": "Video", "type": "video", "clips": []},
                {"id": "layer-2", "name": "Audio", "type": "audio", "clips": []},
            ]
        }
        
        layer = _find_or_create_layer(project_data, "audio", None)
        
        assert layer["type"] == "audio"

    def test_creates_new_layer_if_not_found(self):
        """Should create new layer if no matching layer exists."""
        project_data = {"layers": []}
        
        layer = _find_or_create_layer(project_data, "text", None)
        
        assert layer["type"] == "text"
        assert "Text" in layer["name"]
        assert layer in project_data["layers"]

    def test_creates_layers_list_if_missing(self):
        """Should create layers list if missing from project data."""
        project_data = {}
        
        layer = _find_or_create_layer(project_data, "video", None)
        
        assert "layers" in project_data
        assert layer in project_data["layers"]


class TestAddClipToTimeline:
    """Tests for addClipToTimeline tool."""

    def test_requires_user_id(self):
        """Should return error if user_id is missing."""
        result = invoke_with_context(
            addClipToTimeline, user_id=None,
            clip_type="video", start=0, duration=5, src="https://example.com/video.mp4",
        )
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_requires_project_id(self):
        """Should return error if project_id is missing."""
        result = invoke_with_context(
            addClipToTimeline, project_id=None,
            clip_type="video", start=0, duration=5, src="https://example.com/video.mp4",
        )
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_validates_clip_type(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should reject invalid clip types."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        result = invoke_with_context(addClipToTimeline, clip_type="invalid_type", start=0, duration=5)
        assert result["status"] == "error"
        assert "Invalid clip_type" in result["message"]

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_requires_asset_id_for_media_clips(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should require asset_id for video/audio/image clips."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        for clip_type in ["video", "audio", "image"]:
            result = invoke_with_context(addClipToTimeline, clip_type=clip_type, start=0, duration=5)
            assert result["status"] == "error"
            assert "asset_id" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_requires_text_for_text_clips(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should require text content for text clips."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        result = invoke_with_context(
            addClipToTimeline, clip_type="text", start=0, duration=5, text=None,
        )
        assert result["status"] == "error"
        assert "text" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_validates_start_time(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should reject negative start times."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        result = invoke_with_context(
            addClipToTimeline, clip_type="text", start=-1, duration=5, text="Hello",
        )
        assert result["status"] == "error"
        assert "start" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_validates_duration(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should reject zero or negative duration when explicitly provided."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        result = invoke_with_context(
            addClipToTimeline, clip_type="text", start=0, duration=0, text="Hello",
        )
        assert result["status"] == "error"
        assert "duration" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.add_clip_tool.get_branch_data")
    @patch("langgraph_server.tools.add_clip_tool.set_branch_data")
    @patch("langgraph_server.tools.add_clip_tool._load_automerge_doc")
    @patch("langgraph_server.tools.add_clip_tool._get_project_data")
    @patch("langgraph_server.tools.add_clip_tool._set_project_data")
    @patch("langgraph_server.tools.add_clip_tool._save_automerge_doc")
    def test_adds_video_clip_successfully(
        self,
        mock_save_doc,
        mock_set_data,
        mock_get_data,
        mock_load_doc,
        mock_set_branch_data,
        mock_get_branch_data,
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
        sample_project_data,
    ):
        """Should successfully add a video clip (with asset_id and optional offset)."""
        mock_get_settings.return_value = mock_settings
        mock_get_branch_data.return_value = {"automergeState": "base64_state_here"}

        # Firestore: only used for assets in add_clip
        mock_asset_doc = MagicMock()
        mock_asset_doc.exists = True
        mock_asset_doc.to_dict.return_value = {
            "type": "video",
            "duration": 5,
            "name": "new_video.mp4",
        }
        mock_assets_coll = MagicMock()
        mock_assets_coll.document.return_value.get.return_value = mock_asset_doc
        mock_projects_doc = MagicMock()
        mock_projects_doc.collection.return_value = mock_assets_coll
        mock_db = MagicMock()
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = mock_projects_doc
        mock_get_firestore.return_value = mock_db

        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = sample_project_data
        mock_save_doc.return_value = "new_base64_state"

        result = invoke_with_context(
            addClipToTimeline, branch_id="main",
            clip_type="video", start=10, duration=5, asset_id="asset-123", name="New Video Clip",
        )

        assert result["status"] == "success"
        assert "clip" in result
        assert result["clip"]["type"] == "video"
        assert result["clip"]["start"] == 10
        assert result["clip"]["duration"] == 5
        assert result["clip"]["offset"] == 0
        mock_set_branch_data.assert_called_once()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.add_clip_tool.get_branch_data")
    @patch("langgraph_server.tools.add_clip_tool.set_branch_data")
    @patch("langgraph_server.tools.add_clip_tool._load_automerge_doc")
    @patch("langgraph_server.tools.add_clip_tool._get_project_data")
    @patch("langgraph_server.tools.add_clip_tool._set_project_data")
    @patch("langgraph_server.tools.add_clip_tool._save_automerge_doc")
    def test_adds_text_clip_with_defaults(
        self,
        mock_save_doc,
        mock_set_data,
        mock_get_data,
        mock_load_doc,
        mock_set_branch_data,
        mock_get_branch_data,
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should add text clip with default styling."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        mock_get_branch_data.return_value = {"automergeState": "base64_state_here"}

        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = {"layers": []}
        mock_save_doc.return_value = "new_base64_state"

        result = invoke_with_context(
            addClipToTimeline, clip_type="text", start=0, duration=3, text="Hello World",
        )

        assert result["status"] == "success"
        assert result["clip"]["type"] == "text"

        mock_set_data.assert_called_once()
        project_data = mock_set_data.call_args[0][1]
        text_layer = next(l for l in project_data["layers"] if l["type"] == "text")
        text_clip = text_layer["clips"][0]

        assert text_clip["text"] == "Hello World"
        assert text_clip["fontSize"] == 48
        assert text_clip["fill"] == "#ffffff"
        mock_set_branch_data.assert_called_once()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.add_clip_tool.get_branch_data")
    def test_handles_missing_branch(self, mock_get_branch_data, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing branch gracefully."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        mock_get_branch_data.return_value = None

        result = invoke_with_context(
            addClipToTimeline, branch_id="nonexistent_branch",
            clip_type="text", start=0, duration=3, text="Hello",
        )

        assert result["status"] == "error"
        assert "not found" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.add_clip_tool.get_branch_data")
    def test_handles_missing_automerge_state(self, mock_get_branch_data, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing Automerge state on non-main branch."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        mock_get_branch_data.return_value = {"name": "Other"}  # Branch exists but no automergeState

        result = invoke_with_context(
            addClipToTimeline, branch_id="other",  # non-main so we don't call ensure_main_branch_exists
            clip_type="text", start=0, duration=3, text="Hello",
        )

        assert result["status"] == "error"
        assert "no timeline data" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.add_clip_tool.get_branch_data")
    @patch("langgraph_server.tools.add_clip_tool.set_branch_data")
    @patch("langgraph_server.tools.add_clip_tool._load_automerge_doc")
    @patch("langgraph_server.tools.add_clip_tool._get_project_data")
    @patch("langgraph_server.tools.add_clip_tool._set_project_data")
    @patch("langgraph_server.tools.add_clip_tool._save_automerge_doc")
    def test_uses_default_branch_when_not_specified(
        self,
        mock_save_doc,
        mock_set_data,
        mock_get_data,
        mock_load_doc,
        mock_set_branch_data,
        mock_get_branch_data,
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should use 'main' branch when branch_id not specified."""
        mock_get_settings.return_value = mock_settings
        mock_get_firestore.return_value = MagicMock()
        mock_get_branch_data.return_value = {"automergeState": "state"}

        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = {"layers": []}
        mock_save_doc.return_value = "new_state"

        invoke_with_context(
            addClipToTimeline,  # branch_id defaults to "main"
            clip_type="text", start=0, duration=3, text="Hello",
        )

        # Verify get_branch_data was called with branch "main" (default)
        mock_get_branch_data.assert_called()
        call_kwargs = mock_get_branch_data.call_args
        assert call_kwargs[0][2] == "main"  # 3rd positional arg is branch_id
        mock_set_branch_data.assert_called_once()
