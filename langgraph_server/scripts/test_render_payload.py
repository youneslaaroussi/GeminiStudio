#!/usr/bin/env python3
"""
Standalone check: render job payload shape (no Firebase/HTTP).

Run from langgraph_server:
  python scripts/test_render_payload.py

Verifies the payload we send to the renderer has:
- project.layers (branch timeline, including component clips)
- timelineDuration
- variables.layers and variables.duration (explicit so headless gets them)
- componentFiles (for scene compiler)

This matches what the app sends and what the renderer expects.
"""

from __future__ import annotations

import json
import sys


def compute_timeline_duration(project_data: dict) -> float:
    layers = project_data.get("layers", [])
    max_end = 0.0
    for layer in layers:
        for clip in layer.get("clips", []):
            speed = clip.get("speed") or 1
            duration = clip.get("duration") or 0
            end = clip.get("start", 0) + duration / max(speed, 0.0001)
            max_end = max(max_end, end)
    return max_end


def build_render_payload(
    project_data: dict,
    timeline_duration: float,
    component_files: dict[str, str],
) -> dict:
    """Build the same job_payload structure as render_video_tool."""
    project_payload = dict(project_data)  # in real code we also resolve asset URLs
    project_payload.setdefault("renderScale", 1)
    project_payload.setdefault("background", "#000000")
    project_payload.setdefault("fps", 30)

    job_payload = {
        "project": project_payload,
        "output": {
            "format": "mp4",
            "fps": 30,
            "size": {"width": 1080, "height": 720},
            "quality": "web",
            "destination": "/tmp/gemini-renderer/test.mp4",
            "includeAudio": True,
        },
        "metadata": {"tags": ["gemini-agent", "renderVideo"]},
    }
    if timeline_duration > 0:
        job_payload["timelineDuration"] = timeline_duration
    layers = project_payload.get("layers", [])
    if layers and timeline_duration > 0:
        job_payload["variables"] = {
            "layers": layers,
            "duration": timeline_duration,
        }
    if component_files:
        job_payload["componentFiles"] = component_files
    return job_payload


def main() -> int:
    # Same shape as branch state with one component layer / 5s clip
    project_data = {
        "name": "h",
        "fps": 30,
        "resolution": {"width": 1080, "height": 720},
        "background": "#000000",
        "layers": [
            {
                "id": "layer-component-1",
                "name": "Component Layer",
                "type": "component",
                "clips": [
                    {
                        "id": "clip-f28889f1",
                        "type": "component",
                        "name": "New Component Clip",
                        "start": 0,
                        "duration": 5.0,
                        "offset": 0,
                        "speed": 1,
                        "position": {"x": 0, "y": 0},
                        "scale": {"x": 1, "y": 1},
                        "assetId": "823349a5-5c88-4ffa-b99e-8f2501647443",
                        "componentName": "RedSquare",
                        "inputs": {"sideLength": 200},
                    }
                ],
            }
        ],
    }
    component_files = {
        "src/components/custom/RedSquare.tsx": "import { Node } from '@motion-canvas/2d'; export class RedSquare extends Node {}",
    }

    duration = compute_timeline_duration(project_data)
    assert duration == 5.0, f"expected duration 5.0, got {duration}"

    payload = build_render_payload(project_data, duration, component_files)

    # Contract: renderer and headless expect these
    errors = []
    if not payload.get("project", {}).get("layers"):
        errors.append("payload.project.layers is missing or empty")
    if payload.get("timelineDuration") != 5.0:
        errors.append(f"payload.timelineDuration should be 5.0, got {payload.get('timelineDuration')}")
    if "variables" not in payload:
        errors.append("payload.variables is missing (needed so headless gets branch timeline)")
    else:
        if "layers" not in payload["variables"]:
            errors.append("payload.variables.layers is missing")
        if payload["variables"].get("duration") != 5.0:
            errors.append(f"payload.variables.duration should be 5.0, got {payload['variables'].get('duration')}")
    if "componentFiles" not in payload or "src/components/custom/RedSquare.tsx" not in payload.get("componentFiles", {}):
        errors.append("payload.componentFiles must include RedSquare.tsx for scene compiler")

    if errors:
        print("FAIL: payload contract violations:", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        print("\nPayload (truncated):", file=sys.stderr)
        print(json.dumps({k: v for k, v in payload.items() if k != "metadata"}, indent=2)[:1500], file=sys.stderr)
        return 1

    print("OK: render payload has project.layers, timelineDuration, variables.layers/duration, componentFiles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
