from __future__ import annotations

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import fetch_user_projects


@tool
def listAssets(
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Return the media assets currently in the user's project timeline. Uses the session's branch when provided."""

    if not user_id:
        # Gracefully handle - agent should use project context instead
        return {
            "status": "success",
            "outputs": [{"type": "text", "text": "Asset information is available in the project context above. Please refer to the Media Assets section."}],
        }

    settings = get_settings()
    # When branch_id is set (chat session branch), only that branch's data is used
    if branch_id and project_id:
        projects = fetch_user_projects(user_id, settings, branch_id=branch_id, project_id=project_id)
    else:
        projects = fetch_user_projects(user_id, settings)

    # Find the matching project or use the first one
    target_project = None
    for proj in projects:
        if project_id and proj.get("id") == project_id:
            target_project = proj
            break
    if not target_project and projects:
        target_project = projects[0]

    if not target_project:
        return {
            "status": "success",
            "outputs": [{"type": "text", "text": "No projects found for user."}],
        }

    # Extract assets from project data
    project_data = target_project.get("_projectData", {})
    if not project_data:
        return {
            "status": "success",
            "outputs": [{"type": "text", "text": "Project data not available."}],
        }

    # Collect assets from all layers/clips
    assets = []
    layers = project_data.get("layers", [])
    for layer in layers:
        for clip in layer.get("clips", []):
            assets.append({
                "id": clip.get("assetId", clip.get("id", "")),
                "name": clip.get("name", "Untitled"),
                "type": clip.get("type", "unknown"),
                "duration": clip.get("duration", 0),
                "src": clip.get("src", ""),
                "layer": layer.get("name", "Unknown Layer"),
            })

    if assets:
        items = [
            {"type": "text", "text": f"{a['name']} ({a['type']}, {a['duration']}s) on {a['layer']}"}
            for a in assets
        ]
        title = f"{len(assets)} asset{'s' if len(assets) != 1 else ''}"
    else:
        items = [{"type": "text", "text": "No media assets on the timeline."}]
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
