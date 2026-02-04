"""Video effect definitions registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

# Replicate versions
REPLICATE_VERSION_SAM2 = "meta/sam-2-video:33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d"
REPLICATE_VERSION_BACKGROUND_REMOVER = "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"


@dataclass
class FieldOption:
    """Option for a select field."""

    value: str
    label: str


@dataclass
class FieldDefinition:
    """Definition of a form field for an effect."""

    name: str
    label: str
    type: str  # text, number, textarea, select
    description: str | None = None
    placeholder: str | None = None
    required: bool = False
    options: list[FieldOption] | None = None


@dataclass
class VideoEffectDefinition:
    """Definition of a video effect."""

    id: str
    label: str
    provider: str
    version: str
    description: str | None = None
    fields: list[FieldDefinition] = field(default_factory=list)
    default_values: dict[str, Any] = field(default_factory=dict)
    build_provider_input: Callable[[str, str, dict[str, Any]], dict[str, Any]] = field(
        default=lambda url, name, params: {}
    )
    extract_result: Callable[[Any, str], dict[str, Any]] = field(
        default=lambda output, status: {}
    )


def _normalize_comma_list(value: str) -> str | None:
    """Normalize a comma-separated list string."""
    trimmed = value.strip() if value else ""
    return trimmed if trimmed else None


def _build_sam2_input(asset_url: str, asset_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Build provider input for SAM-2 Video effect."""
    input_data: dict[str, Any] = {
        "input_video": asset_url,
        "mask_type": params.get("maskType", "highlighted"),
        "video_fps": params.get("videoFps", 25),
        "output_video": params.get("outputVideo", True),
    }

    click_frames = _normalize_comma_list(params.get("clickFrames", ""))
    if click_frames:
        input_data["click_frames"] = click_frames

    click_object_ids = _normalize_comma_list(params.get("clickObjectIds", ""))
    if click_object_ids:
        input_data["click_object_ids"] = click_object_ids

    click_coordinates = _normalize_comma_list(params.get("clickCoordinates", ""))
    if click_coordinates:
        input_data["click_coordinates"] = click_coordinates

    return input_data


def _extract_sam2_result(provider_output: Any, provider_status: str) -> dict[str, Any]:
    """Extract result from SAM-2 Video effect output."""
    if provider_status == "succeeded" and isinstance(provider_output, list) and len(provider_output) > 0:
        # Find the MP4 video URL in the output
        video_url = next(
            (url for url in provider_output if isinstance(url, str) and url.endswith(".mp4")),
            None,
        )
        return {"result_url": video_url}

    if provider_status == "failed":
        if isinstance(provider_output, str):
            return {"error": provider_output}
        if isinstance(provider_output, list):
            return {"error": "\n".join(str(item) for item in provider_output)}
        return {"error": "Replicate job failed"}

    return {}


# SAM-2 Video Segmentation effect definition
SAM2_VIDEO_DEFINITION = VideoEffectDefinition(
    id="replicate.meta.sam2-video",
    label="Segment Anything v2 (Video)",
    description="Interactively segments objects in a video using Meta's SAM 2 model. Provide click coordinates to highlight or isolate subjects.",
    provider="replicate",
    version=REPLICATE_VERSION_SAM2,
    fields=[
        FieldDefinition(
            name="maskType",
            label="Mask Type",
            type="select",
            options=[
                FieldOption(value="highlighted", label="Highlight objects"),
                FieldOption(value="binary", label="Binary mask"),
            ],
            description="Choose whether to highlight selected objects or output a binary mask.",
            required=True,
        ),
        FieldDefinition(
            name="videoFps",
            label="Output FPS",
            type="number",
            description="Frames per second for the processed video.",
        ),
        FieldDefinition(
            name="clickFrames",
            label="Click Frames",
            type="text",
            placeholder="1,15,30",
            description="Frame numbers where clicks are applied. Leave blank to use the first frame only.",
        ),
        FieldDefinition(
            name="clickObjectIds",
            label="Click Object IDs",
            type="text",
            placeholder="bee_1,bee_2",
            description="Optional labels for objects corresponding to each click.",
        ),
        FieldDefinition(
            name="clickCoordinates",
            label="Click Coordinates",
            type="textarea",
            placeholder="[391,239],[178,320]",
            description="Coordinates for clicks in [x,y] format. One coordinate per click frame.",
            required=True,
        ),
        FieldDefinition(
            name="outputVideo",
            label="Return Video Output",
            type="select",
            options=[
                FieldOption(value="true", label="Yes"),
                FieldOption(value="false", label="No"),
            ],
            description="If disabled, the model may return only masks. Default is enabled.",
        ),
    ],
    default_values={
        "maskType": "binary",
        "videoFps": 25,
        "clickFrames": "1",
        "clickObjectIds": "",
        "clickCoordinates": "",
        "outputVideo": True,
    },
    build_provider_input=_build_sam2_input,
    extract_result=_extract_sam2_result,
)


def _build_background_remover_input(asset_url: str, asset_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Build provider input for background-remover effect."""
    return {"image": asset_url}


def _extract_background_remover_result(provider_output: Any, provider_status: str) -> dict[str, Any]:
    """Extract result from background-remover output (PNG URL)."""
    if provider_status == "succeeded":
        url: str | None = None
        if isinstance(provider_output, str):
            url = provider_output
        elif isinstance(provider_output, dict) and "url" in provider_output:
            url = provider_output.get("url")
        elif isinstance(provider_output, list) and len(provider_output) > 0:
            first = provider_output[0]
            url = first if isinstance(first, str) else first.get("url") if isinstance(first, dict) else None
        if url:
            return {"result_url": url}

    if provider_status == "failed":
        if isinstance(provider_output, str):
            return {"error": provider_output}
        if isinstance(provider_output, list):
            return {"error": "\n".join(str(item) for item in provider_output)}
        return {"error": "Replicate job failed"}

    return {}


# Background Remover (image effect)
BACKGROUND_REMOVER_DEFINITION = VideoEffectDefinition(
    id="replicate.851-labs.background-remover",
    label="Remove Background",
    description="Remove the background from an image using AI. Output is a PNG with transparent background.",
    provider="replicate",
    version=REPLICATE_VERSION_BACKGROUND_REMOVER,
    fields=[],
    default_values={},
    build_provider_input=_build_background_remover_input,
    extract_result=_extract_background_remover_result,
)


# Registry of all effect definitions
EFFECT_DEFINITIONS: list[VideoEffectDefinition] = [
    SAM2_VIDEO_DEFINITION,
    BACKGROUND_REMOVER_DEFINITION,
]

EFFECT_DEFINITIONS_MAP: dict[str, VideoEffectDefinition] = {
    definition.id: definition for definition in EFFECT_DEFINITIONS
}


def get_effect_definition(effect_id: str) -> VideoEffectDefinition | None:
    """Get an effect definition by ID."""
    return EFFECT_DEFINITIONS_MAP.get(effect_id)


def get_effect_definitions() -> list[VideoEffectDefinition]:
    """Get all effect definitions."""
    return EFFECT_DEFINITIONS


def get_effect_definitions_for_api() -> list[dict[str, Any]]:
    """Get effect definitions in API response format."""
    return [
        {
            "id": definition.id,
            "label": definition.label,
            "description": definition.description,
            "provider": definition.provider,
            "fields": [
                {
                    "name": field.name,
                    "label": field.label,
                    "type": field.type,
                    "description": field.description,
                    "placeholder": field.placeholder,
                    "required": field.required,
                    "options": (
                        [{"value": opt.value, "label": opt.label} for opt in field.options]
                        if field.options
                        else None
                    ),
                }
                for field in definition.fields
            ],
            "defaultValues": definition.default_values,
        }
        for definition in EFFECT_DEFINITIONS
    ]
