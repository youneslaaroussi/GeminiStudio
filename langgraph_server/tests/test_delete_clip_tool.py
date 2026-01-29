"""Tests for the delete clip tool."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from langgraph_server.tools.delete_clip_tool import deleteClipFromTimeline


class TestDeleteClipFromTimeline:
    """Tests for deleteClipFromTimeline tool."""

    def test_requires_user_id(self):
        """Should return error if user_id is missing."""
        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-abc123"],
            "project_id": "proj-123",
            "user_id": None,
        })
        assert result["status"] == "error"
        assert "required" in result["message"].lower() or "context" in result["message"].lower()

    def test_requires_project_id(self):
        """Should return error if project_id is missing."""
        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-abc123"],
            "project_id": None,
            "user_id": "user-123",
        })
        assert result["status"] == "error"
        assert "required" in result["message"].lower() or "context" in result["message"].lower()

    def test_requires_clip_ids(self):
        """Should return error if clip_ids is empty or missing."""
        result = deleteClipFromTimeline.invoke({
            "clip_ids": [],
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        assert result["status"] == "error"
        assert "clip" in result["message"].lower()

    def test_requires_valid_clip_ids(self):
        """Should return error if clip_ids has no valid entries."""
        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["", "  "],
            "project_id": "proj-123",
            "user_id": "user-123",
        })
        assert result["status"] == "error"
        assert "valid" in result["message"].lower()

    @patch("langgraph_server.tools.delete_clip_tool.get_settings")
    @patch("langgraph_server.tools.delete_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.delete_clip_tool._load_automerge_doc")
    @patch("langgraph_server.tools.delete_clip_tool._get_project_data")
    @patch("langgraph_server.tools.delete_clip_tool._set_project_data")
    @patch("langgraph_server.tools.delete_clip_tool._save_automerge_doc")
    def test_deletes_clips_successfully(
        self,
        mock_save_doc,
        mock_set_data,
        mock_get_data,
        mock_load_doc,
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should delete clips and update Firestore."""
        mock_get_settings.return_value = mock_settings

        mock_db = MagicMock()
        mock_branch_ref = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {"automergeState": "base64_state"}
        mock_branch_ref.get.return_value = mock_branch_doc
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value = mock_branch_ref
        mock_get_firestore.return_value = mock_db

        mock_doc = MagicMock()
        mock_load_doc.return_value = mock_doc
        project_data = {
            "layers": [
                {
                    "id": "layer-v1",
                    "name": "Video",
                    "type": "video",
                    "clips": [
                        {"id": "clip-abc123", "name": "Clip A", "type": "video", "start": 0, "duration": 5},
                        {"id": "clip-keep", "name": "Keep", "type": "video", "start": 5, "duration": 3},
                    ],
                },
            ],
        }
        mock_get_data.return_value = project_data
        mock_save_doc.return_value = "new_state"

        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-abc123"],
            "project_id": "proj-123",
            "user_id": "user-123",
        })

        assert result["status"] == "success"
        assert len(result["deleted"]) == 1
        assert result["deleted"][0]["id"] == "clip-abc123"
        assert result["deleted"][0]["name"] == "Clip A"

        layer = project_data["layers"][0]
        assert len(layer["clips"]) == 1
        assert layer["clips"][0]["id"] == "clip-keep"

        mock_set_data.assert_called_once()
        mock_save_doc.assert_called_once()
        mock_branch_ref.update.assert_called_once()

    @patch("langgraph_server.tools.delete_clip_tool.get_settings")
    @patch("langgraph_server.tools.delete_clip_tool.get_firestore_client")
    @patch("langgraph_server.tools.delete_clip_tool._load_automerge_doc")
    @patch("langgraph_server.tools.delete_clip_tool._get_project_data")
    def test_no_clips_found(
        self,
        mock_get_data,
        mock_load_doc,
        mock_get_firestore,
        mock_get_settings,
        mock_settings,
    ):
        """Should return error when none of the requested clip IDs exist."""
        mock_get_settings.return_value = mock_settings

        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {"automergeState": "state"}
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db

        mock_load_doc.return_value = MagicMock()
        mock_get_data.return_value = {"layers": [{"id": "L1", "clips": [{"id": "clip-other"}]}]}

        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-nonexistent"],
            "project_id": "proj-123",
            "user_id": "user-123",
        })

        assert result["status"] == "error"
        assert "no clips found" in result["message"].lower() or "not found" in result["message"].lower()

    @patch("langgraph_server.tools.delete_clip_tool.get_settings")
    @patch("langgraph_server.tools.delete_clip_tool.get_firestore_client")
    def test_handles_missing_branch(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing branch gracefully."""
        mock_get_settings.return_value = mock_settings

        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = False
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db

        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-abc"],
            "project_id": "proj-123",
            "user_id": "user-123",
            "branch_id": "nonexistent",
        })

        assert result["status"] == "error"
        assert "not found" in result["message"].lower()

    @patch("langgraph_server.tools.delete_clip_tool.get_settings")
    @patch("langgraph_server.tools.delete_clip_tool.get_firestore_client")
    def test_handles_missing_automerge_state(self, mock_get_firestore, mock_get_settings, mock_settings):
        """Should handle missing Automerge state."""
        mock_get_settings.return_value = mock_settings

        mock_db = MagicMock()
        mock_branch_doc = MagicMock()
        mock_branch_doc.exists = True
        mock_branch_doc.to_dict.return_value = {}
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_branch_doc
        mock_get_firestore.return_value = mock_db

        result = deleteClipFromTimeline.invoke({
            "clip_ids": ["clip-abc"],
            "project_id": "proj-123",
            "user_id": "user-123",
        })

        assert result["status"] == "error"
        assert "no timeline data" in result["message"].lower()
