from __future__ import annotations

from langchain_core.tools import tool

from ..asset_store import format_asset_summary, list_remote_assets
from ..tool_manifest import get_tool_metadata


def _description() -> str:
    metadata = get_tool_metadata("listAssets")
    if not metadata:
        return "Return the uploaded assets currently available in the project."
    return metadata.get("description", "Return the uploaded assets currently available in the project.")


@tool(name="listAssets", description=_description())
def list_assets_tool(project_id: str | None = None) -> dict:
    """Return the uploaded assets for the active project."""

    assets = list_remote_assets(project_id=project_id)

    if assets:
        items = [{"type": "text", "text": format_asset_summary(asset)} for asset in assets]
        title = f"{len(assets)} asset{'s' if len(assets) != 1 else ''}"
    else:
        items = [{"type": "text", "text": "No uploaded assets found."}]
        title = "0 assets"

    return {
        "status": "success",
        "outputs": [
            {
                "type": "list",
                "title": title,
                "items": items,
            },
            {
                "type": "json",
                "data": assets,
            },
        ],
    }
