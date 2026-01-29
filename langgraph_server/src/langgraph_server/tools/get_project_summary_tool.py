"""Tool to get a summary of the current project and timeline state."""

from __future__ import annotations

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import fetch_user_projects


@tool
def getProjectSummary(
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Return a summary of the current project including name, resolution, fps, layers, and clips.

    Uses the session's branch when provided, so the summary reflects the timeline
    state for this conversation's branch (not necessarily main).
    """

    if not user_id:
        return {
            "status": "error",
            "message": "User context is required to fetch project summary.",
        }

    settings = get_settings()

    # Fetch project data (uses branch if provided)
    if branch_id and project_id:
        projects = fetch_user_projects(user_id, settings, branch_id=branch_id, project_id=project_id)
    else:
        projects = fetch_user_projects(user_id, settings)

    # Find target project
    target_project = None
    for proj in projects:
        if project_id and proj.get("id") == project_id:
            target_project = proj
            break
    if not target_project and projects:
        target_project = projects[0]

    if not target_project:
        return {
            "status": "error",
            "message": "No project found for the current user.",
        }

    project_data = target_project.get("_projectData", {})
    branch_info = target_project.get("_branch", {})

    if not project_data:
        return {
            "status": "success",
            "outputs": [
                {
                    "type": "text",
                    "text": f"Project '{target_project.get('name', 'Untitled')}' exists but has no timeline data yet.",
                }
            ],
        }

    # Extract key info
    name = project_data.get("name") or target_project.get("name") or "Untitled"
    resolution = project_data.get("resolution", {})
    width = resolution.get("width", 1920)
    height = resolution.get("height", 1080)
    fps = project_data.get("fps", 30)
    background = project_data.get("background", "#000000")

    layers = project_data.get("layers", [])

    # Build layer/clip summary
    layer_summaries = []
    total_clips = 0
    total_duration = 0.0

    for layer in layers:
        layer_name = layer.get("name", "Unnamed Layer")
        layer_type = layer.get("type", "unknown")
        clips = layer.get("clips", [])
        clip_count = len(clips)
        total_clips += clip_count

        # Calculate layer duration (end of last clip)
        layer_end = 0.0
        for clip in clips:
            clip_end = clip.get("start", 0) + clip.get("duration", 0)
            if clip_end > layer_end:
                layer_end = clip_end
            if clip_end > total_duration:
                total_duration = clip_end

        layer_summaries.append({
            "name": layer_name,
            "type": layer_type,
            "clipCount": clip_count,
            "duration": round(layer_end, 2),
        })

    # Human-readable output
    lines = [
        f"**{name}**",
        f"Resolution: {width}x{height} @ {fps}fps",
        f"Background: {background}",
        f"Branch: {branch_info.get('branchId', 'main')}",
        "",
        f"**Timeline** ({len(layers)} layer{'s' if len(layers) != 1 else ''}, {total_clips} clip{'s' if total_clips != 1 else ''}, {total_duration:.1f}s total)",
    ]

    for ls in layer_summaries:
        lines.append(f"  - {ls['name']} ({ls['type']}): {ls['clipCount']} clip{'s' if ls['clipCount'] != 1 else ''}, {ls['duration']}s")

    summary_text = "\n".join(lines)

    # Structured data for agent
    summary_data = {
        "projectId": target_project.get("id"),
        "name": name,
        "resolution": {"width": width, "height": height},
        "fps": fps,
        "background": background,
        "branchId": branch_info.get("branchId", "main"),
        "commitId": branch_info.get("commitId"),
        "totalLayers": len(layers),
        "totalClips": total_clips,
        "totalDuration": round(total_duration, 2),
        "layers": layer_summaries,
    }

    return {
        "status": "success",
        "outputs": [
            {"type": "text", "text": summary_text},
            {"type": "json", "data": summary_data},
        ],
    }
