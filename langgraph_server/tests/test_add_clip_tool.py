"""Tests for the add clip tool."""

from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

import pytest

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
        result = addClipToTimeline.invoke({
            "clip_type": "video",
            "start": 0,
            "duration": 5,
            "src": "https://example.com/video.mp4",
            "user_id": None,
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_requires_project_id(self):
        """Should return error if project_id is missing."""
        result = addClipToTimeline.invoke({
            "clip_type": "video",
            "start": 0,
            "duration": 5,
            "src": "https://example.com/video.mp4",
            "user_id": "user-123",
            "project_id": None,
        })
        
        assert result["status"] == "error"
        assert "required" in result["message"].lower()

    def test_validates_clip_type(self):
        """Should reject invalid clip types."""
        result = addClipToTimeline.invoke({
            "clip_type": "invalid_type",
            "start": 0,
            "duration": 5,
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "Invalid clip_type" in result["message"]

    def test_requires_src_for_media_clips(self):
        """Should require src for video/audio/image clips."""
        for clip_type in ["video", "audio", "image"]:
            result = addClipToTimeline.invoke({
                "clip_type": clip_type,
                "start": 0,
                "duration": 5,
                "src": None,
                "user_id": "user-123",
                "project_id": "proj-123",
            })
            
            assert result["status"] == "error"
            assert "src" in result["message"].lower()

    def test_requires_text_for_text_clips(self):
        """Should require text content for text clips."""
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 5,
            "text": None,
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "text" in result["message"].lower()

    def test_validates_start_time(self):
        """Should reject negative start times."""
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": -1,
            "duration": 5,
            "text": "Hello",
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "start" in result["message"].lower()

    def test_validates_duration(self):
        """Should reject zero or negative duration."""
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 0,
            "text": "Hello",
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "duration" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
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
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
        sample_project_data,
    ):
        """Should successfully add a video clip."""
        mock_get_settings.return_value = mock_settings
        
        # Setup Firestore mock
        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {"automergeState": "base64_state_here"}
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db
        
        # Setup Automerge mocks
        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = sample_project_data
        mock_save_doc.return_value = "new_base64_state"
        
        result = addClipToTimeline.invoke({
            "clip_type": "video",
            "start": 10,
            "duration": 5,
            "src": "https://example.com/new_video.mp4",
            "name": "New Video Clip",
            "user_id": "user-123",
            "project_id": "proj-123",
            "branch_id": "main",
        })
        
        assert result["status"] == "success"
        assert "clip" in result
        assert result["clip"]["type"] == "video"
        assert result["clip"]["start"] == 10
        assert result["clip"]["duration"] == 5

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
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
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should add text clip with default styling."""
        mock_get_settings.return_value = mock_settings
        
        # Setup Firestore mock
        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {"automergeState": "base64_state_here"}
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db
        
        # Setup Automerge mocks with empty project
        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = {"layers": []}
        mock_save_doc.return_value = "new_base64_state"
        
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 3,
            "text": "Hello World",
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "success"
        assert result["clip"]["type"] == "text"
        
        # Verify _set_project_data was called with text clip defaults
        mock_set_data.assert_called_once()
        project_data = mock_set_data.call_args[0][1]
        text_layer = next(l for l in project_data["layers"] if l["type"] == "text")
        text_clip = text_layer["clips"][0]
        
        assert text_clip["text"] == "Hello World"
        assert text_clip["fontSize"] == 48
        assert text_clip["fill"] == "#ffffff"

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_handles_missing_branch(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing branch gracefully."""
        mock_get_settings.return_value = mock_settings
        
        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = False
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db
        
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 3,
            "text": "Hello",
            "user_id": "user-123",
            "project_id": "proj-123",
            "branch_id": "nonexistent_branch",
        })
        
        assert result["status"] == "error"
        assert "not found" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
    def test_handles_missing_automerge_state(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing Automerge state."""
        mock_get_settings.return_value = mock_settings
        
        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {}  # No automergeState
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db
        
        result = addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 3,
            "text": "Hello",
            "user_id": "user-123",
            "project_id": "proj-123",
        })
        
        assert result["status"] == "error"
        assert "no timeline data" in result["message"].lower()

    @patch("langgraph_server.tools.add_clip_tool.get_settings")
    @patch("langgraph_server.tools.add_clip_tool.get_firestore_client")
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
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should use 'main' branch when branch_id not specified."""
        mock_get_settings.return_value = mock_settings
        
        mock_db = MagicMock()
        mock_branch_ref = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {"automergeState": "state"}
        mock_branch_ref.get.return_value = mock_branch_doc
        
        # Track the branch document path
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value = mock_branch_ref
        mock_get_firestore.return_value = mock_db
        
        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        mock_get_data.return_value = {"layers": []}
        mock_save_doc.return_value = "new_state"
        
        addClipToTimeline.invoke({
            "clip_type": "text",
            "start": 0,
            "duration": 3,
            "text": "Hello",
            "user_id": "user-123",
            "project_id": "proj-123",
            # branch_id not specified
        })
        
        # Verify "main" was used
        calls = mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.call_args_list
        assert any("main" in str(call) for call in calls)
