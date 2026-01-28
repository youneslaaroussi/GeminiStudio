from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, TypedDict


class StoredAsset(TypedDict, total=False):
    id: str
    name: str
    fileName: str
    mimeType: str
    size: int
    uploadedAt: str
    projectId: str | None


class RemoteAsset(TypedDict, total=False):
    id: str
    name: str
    mimeType: str
    size: int
    uploadedAt: str
    projectId: str | None
    url: str
    type: str


def _workdir() -> Path:
    return Path(__file__).resolve().parents[3]


def _data_directory() -> Path:
    return _workdir() / ".data"


def _manifest_path() -> Path:
    return _data_directory() / "assets-manifest.json"


def ensure_asset_storage() -> None:
    path = _data_directory()
    path.mkdir(parents=True, exist_ok=True)


def read_manifest() -> List[StoredAsset]:
    ensure_asset_storage()
    manifest_path = _manifest_path()
    if not manifest_path.exists():
        return []
    raw = manifest_path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if isinstance(data, list):
        return data  # type: ignore[return-value]
    return []


def determine_asset_type(mime_type: str, file_name: str) -> str:
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("image/"):
        return "image"

    ext = Path(file_name).suffix.lower()
    if ext in {".mp4", ".mov", ".webm", ".mkv"}:
        return "video"
    if ext in {".mp3", ".wav", ".aac", ".ogg"}:
        return "audio"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return "image"

    return "other"


def stored_asset_to_remote(asset: StoredAsset) -> RemoteAsset:
    return {
        "id": asset.get("id", ""),
        "name": asset.get("name", ""),
        "mimeType": asset.get("mimeType", ""),
        "size": asset.get("size", 0),
        "uploadedAt": asset.get("uploadedAt", ""),
        "projectId": asset.get("projectId"),
        "url": f"/uploads/{asset.get('fileName', '')}",
        "type": determine_asset_type(asset.get("mimeType", ""), asset.get("name", "")),
    }


def format_asset_summary(asset: RemoteAsset) -> str:
    size_bytes = asset.get("size", 0)
    size_mb = size_bytes / 1024 / 1024
    precision = 2 if size_mb > 1 else 1
    rounded = round(size_mb, precision)
    if rounded == 0 and size_bytes > 0:
        rounded = max(size_mb, 1 / (10 ** precision))
    parts = [
        asset.get("name", "Unnamed asset"),
        asset.get("type", "other").upper(),
        f"{rounded:.{precision}f} MB",
    ]
    return " • ".join(parts)


def list_remote_assets(project_id: str | None = None) -> List[RemoteAsset]:
    manifest = read_manifest()
    remote_assets = []
    for entry in manifest:
        if project_id and entry.get("projectId") != project_id:
            continue
        remote_assets.append(stored_asset_to_remote(entry))
    return remote_assets
