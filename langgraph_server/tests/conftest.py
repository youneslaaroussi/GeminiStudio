"""Shared test fixtures and configuration."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def mock_settings():
    """Create mock settings for testing."""
    settings = MagicMock()
    settings.asset_service_url = "http://localhost:8081"
    settings.google_project_id = "test-project"
    settings.google_cloud_storage_bucket = "test-bucket"
    settings.firebase_service_account_key = None
    settings.renderer_base_url = "http://localhost:4000"
    settings.render_event_topic = "test-topic"
    settings.render_event_subscription = "test-sub"
    settings.pipeline_event_topic = "test-pipeline-topic"
    settings.pipeline_event_subscription = "test-pipeline-sub"
    return settings


@pytest.fixture
def mock_firestore_client():
    """Create a mock Firestore client."""
    client = MagicMock()
    return client


@pytest.fixture
def sample_project_data():
    """Sample project data structure."""
    return {
        "name": "Test Project",
        "fps": 30,
        "resolution": {"width": 1920, "height": 1080},
        "background": "#000000",
        "layers": [
            {
                "id": "layer-video-1",
                "name": "Video Layer",
                "type": "video",
                "clips": [
                    {
                        "id": "clip-1",
                        "type": "video",
                        "name": "Intro Video",
                        "start": 0,
                        "duration": 10,
                        "src": "https://example.com/video.mp4",
                        "assetId": "asset-123",
                    }
                ],
            },
            {
                "id": "layer-audio-1",
                "name": "Audio Layer",
                "type": "audio",
                "clips": [
                    {
                        "id": "clip-2",
                        "type": "audio",
                        "name": "Background Music",
                        "start": 0,
                        "duration": 30,
                        "src": "https://example.com/music.mp3",
                        "volume": 0.8,
                    }
                ],
            },
        ],
    }


@pytest.fixture
def sample_assets():
    """Sample asset library data."""
    return [
        {
            "id": "asset-1",
            "name": "beach_sunset.mp4",
            "type": "video",
            "mimeType": "video/mp4",
            "duration": 45.5,
            "width": 1920,
            "height": 1080,
            "size": 15000000,
            "signedUrl": "https://storage.example.com/asset-1.mp4",
        },
        {
            "id": "asset-2",
            "name": "logo.png",
            "type": "image",
            "mimeType": "image/png",
            "width": 512,
            "height": 512,
            "size": 50000,
            "signedUrl": "https://storage.example.com/asset-2.png",
        },
        {
            "id": "asset-3",
            "name": "intro_music.mp3",
            "type": "audio",
            "mimeType": "audio/mpeg",
            "duration": 120.0,
            "size": 3000000,
            "signedUrl": "https://storage.example.com/asset-3.mp3",
        },
    ]


@pytest.fixture
def sample_branch_info():
    """Sample branch metadata."""
    return {
        "branchId": "feature_chat_test123",
        "commitId": "abc123def456",
        "timestamp": "2024-01-15T10:30:00Z",
        "author": "user-123",
        "hasAutomergeState": True,
    }
