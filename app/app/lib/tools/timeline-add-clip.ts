import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import {
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
  type Project,
  type TimelineClip,
  type Focus,
  type ClipTransition,
} from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const vectorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const focusSchema: z.ZodType<Focus> = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1, "Zoom must be at least 1"),
});

const transitionTypeSchema = z.enum([
  "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down",
  "cross-dissolve", "zoom", "blur", "dip-to-black",
]);

const clipTransitionSchema = z.object({
  type: transitionTypeSchema,
  duration: z.number().min(0.1).max(5),
});

const baseClipSchema = z.object({
  layerId: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(180, "Name must be 180 characters or fewer")
    .optional(),
  start: z.number().min(0, "Start time must be zero or greater").optional().default(0),
  duration: z.number().positive("Duration must be positive").optional(),
  offset: z.number().min(0, "Source offset must be zero or greater").optional(),
  speed: z
    .number()
    .positive("Playback speed must be positive")
    .max(8, "Playback speed must be 8x or slower")
    .optional(),
  position: vectorSchema.optional(),
  scale: vectorSchema.optional(),
  assetId: z.string().optional(),
});

const addClipSchema = baseClipSchema.extend({
  // Type is optional for media clips - can be inferred from assetId
  type: z.enum(["video", "audio", "image", "text"]).optional(),
  // Do not accept src from LLM - proxy URL is derived from assetId only
  // Media properties (video/image)
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  sourceDuration: z.number().positive().optional(),
  focus: focusSchema.optional(),
  objectFit: z.enum(["contain", "cover", "fill"]).optional(),
  // Audio properties
  volume: z
    .number()
    .min(0, "Volume must be between 0 and 1")
    .max(1, "Volume must be between 0 and 1")
    .optional(),
  // Text properties
  text: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fill: z.string().optional(),
  opacity: z
    .number()
    .min(0, "Opacity must be between 0 and 1")
    .max(1, "Opacity must be between 0 and 1")
    .optional(),
  template: z.enum(["text", "title-card", "lower-third", "caption-style"]).optional(),
  subtitle: z.string().optional(),
  backgroundColor: z.string().optional(),
  enterTransition: clipTransitionSchema.optional(),
  exitTransition: clipTransitionSchema.optional(),
});

type AddClipInput = z.infer<typeof addClipSchema>;

function applyCommonOverrides(clip: TimelineClip, input: Partial<AddClipInput>) {
  if (input.offset !== undefined) clip.offset = input.offset;
  if (input.speed !== undefined) clip.speed = input.speed;
  if (input.position) clip.position = input.position;
  if (input.scale) clip.scale = input.scale;
  if (input.assetId) clip.assetId = input.assetId;
  if (input.name) clip.name = input.name;
  if (input.enterTransition && input.enterTransition.type !== "none") {
    clip.enterTransition = input.enterTransition as ClipTransition;
  }
  if (input.exitTransition && input.exitTransition.type !== "none") {
    clip.exitTransition = input.exitTransition as ClipTransition;
  }
}

export const timelineAddClipTool: ToolDefinition<
  typeof addClipSchema,
  Project
> = {
  name: "timelineAddClip",
  label: "Add Timeline Clip",
  description:
    "Insert a new clip on the timeline. For media clips (video/audio/image), provide type and assetId only—do not pass src (proxy URL is derived from assetId). For text clips, provide type='text' and text content. Use template, subtitle, backgroundColor for text styling. Use enterTransition and exitTransition for fade/slide/zoom in/out (type, duration 0.1-5s).",
  runLocation: "client",
  inputSchema: addClipSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "Asset ID from listAssets or generateImage",
      description: "Required for media clips. Proxy URL is derived from assetId—do not pass src.",
    },
    {
      name: "type",
      label: "Clip Type",
      type: "select",
      options: [
        { value: "video", label: "Video" },
        { value: "audio", label: "Audio" },
        { value: "image", label: "Image" },
        { value: "text", label: "Text" },
      ],
      description: "Required for media clips. Optional if assetId is provided (will be inferred from asset).",
    },
    {
      name: "layerId",
      label: "Layer ID",
      type: "text",
      placeholder: "Optional layer ID (defaults to matching layer type)",
    },
    {
      name: "name",
      label: "Clip Name",
      type: "text",
      placeholder: "Friendly clip name",
    },
    {
      name: "start",
      label: "Start (seconds)",
      type: "number",
      description: "Defaults to 0 if not provided.",
    },
    {
      name: "duration",
      label: "Duration (seconds)",
      type: "number",
      description: "Optional: defaults to asset duration or 5s for images.",
    },
    {
      name: "text",
      label: "Text Content",
      type: "textarea",
      description: "Required for text clips.",
    },
    {
      name: "offset",
      label: "Source Offset",
      type: "number",
      description: "Trim the beginning of the source by this many seconds.",
    },
    {
      name: "speed",
      label: "Playback Speed",
      type: "number",
      description: "Playback speed multiplier (defaults to 1).",
    },
    {
      name: "position",
      label: "Position",
      type: "json",
      placeholder: '{"x":0,"y":0}',
      description:
        "Scene position as { x, y } in pixels. Uses center origin: (0,0) is center of frame; x positive = right, negative = left; y positive = above center (top), negative = below center (bottom).",
    },
    {
      name: "scale",
      label: "Scale",
      type: "json",
      placeholder: '{"x":1,"y":1}',
      description: "Scale multiplier as { x, y }.",
    },
    {
      name: "width",
      label: "Width",
      type: "number",
      description: "Optional intrinsic media width (video/image).",
    },
    {
      name: "height",
      label: "Height",
      type: "number",
      description: "Optional intrinsic media height (video/image).",
    },
    {
      name: "objectFit",
      label: "Object Fit",
      type: "select",
      description: "Video object-fit behavior.",
      options: [
        { value: "contain", label: "Contain" },
        { value: "cover", label: "Cover" },
        { value: "fill", label: "Fill" },
      ],
    },
    {
      name: "focus",
      label: "Focus / Zoom",
      type: "json",
      placeholder: '{"x":0.5,"y":0.5,"zoom":1}',
      description: "Optional video focus: center (x,y 0–1) and zoom ratio (1 = full frame, 2 = 2×).",
    },
    {
      name: "volume",
      label: "Volume",
      type: "number",
      description: "Audio volume (0-1).",
    },
    {
      name: "fontSize",
      label: "Font Size",
      type: "number",
      description: "Text clip font size in pixels.",
    },
    {
      name: "fill",
      label: "Fill Color",
      type: "text",
      placeholder: "#ffffff",
    },
    {
      name: "opacity",
      label: "Opacity",
      type: "number",
      description: "Text opacity (0-1).",
    },
    {
      name: "template",
      label: "Text Template",
      type: "select",
      description: "Template style: text (default), title-card, lower-third, caption-style.",
      options: [
        { value: "text", label: "Plain Text" },
        { value: "title-card", label: "Title Card" },
        { value: "lower-third", label: "Lower Third" },
        { value: "caption-style", label: "Caption Style" },
      ],
    },
    {
      name: "subtitle",
      label: "Subtitle",
      type: "text",
      description: "For title-card and lower-third templates.",
    },
    {
      name: "backgroundColor",
      label: "Background Color",
      type: "text",
      placeholder: "rgba(0,0,0,0.8) or #1a1a2e",
      description: "For templates with backgrounds.",
    },
    {
      name: "enterTransition",
      label: "Enter Transition",
      type: "json",
      placeholder: '{"type":"fade","duration":0.5}',
      description: "In transition when clip starts. Type: fade, slide-left, slide-right, slide-up, slide-down, zoom, dip-to-black. Duration 0.1-5s.",
    },
    {
      name: "exitTransition",
      label: "Exit Transition",
      type: "json",
      placeholder: '{"type":"fade","duration":0.5}',
      description: "Out transition when clip ends. Same types as enter.",
    },
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Timeline tools are only available when running in the browser.",
      };
    }

    const store = useProjectStore.getState();
    const projectId = store.projectId;

    // Resolve asset details from assetId only—never use LLM-provided src (breaks proxy)
    let resolvedSrc: string | undefined;
    let resolvedType = input.type;
    let resolvedDuration = input.duration;
    let resolvedWidth = input.width;
    let resolvedHeight = input.height;
    let resolvedSourceDuration = input.sourceDuration;

    if (input.assetId) {
      const { useAssetsStore } = await import("@/app/lib/store/assets-store");
      const assetsStore = useAssetsStore.getState();
      const asset = assetsStore.assets.find((a) => a.id === input.assetId);

      if (asset) {
        if (!resolvedType) {
          const assetType = asset.type?.toLowerCase();
          if (assetType === "video" || assetType === "audio" || assetType === "image") {
            resolvedType = assetType;
          }
        }
        // Always use asset's proxy URL (asset.url), never signed URLs
        resolvedSrc = asset.url;

        if (!resolvedWidth && asset.width) resolvedWidth = asset.width;
        if (!resolvedHeight && asset.height) resolvedHeight = asset.height;
        if (!resolvedSourceDuration && asset.duration) {
          resolvedSourceDuration = asset.duration;
          if (!resolvedDuration) resolvedDuration = asset.duration;
        }
      } else if (projectId) {
        // Asset not in store yet (e.g. just generated)—build proxy URL from assetId
        resolvedSrc = `/api/assets/${input.assetId}/file?projectId=${encodeURIComponent(projectId)}`;
      }
    }

    // Default duration for images if still not set
    if (!resolvedDuration) {
      resolvedDuration = resolvedType === "image" ? 5 : 10;
    }

    // Validate we have the required fields
    if (!resolvedType) {
      return {
        status: "error",
        error: "Could not determine clip type. Provide 'type' or a valid 'assetId'.",
      };
    }

    if (resolvedType !== "text" && !resolvedSrc) {
      return {
        status: "error",
        error: "For media clips provide type and assetId (proxy URL is derived from assetId). Do not pass src.",
      };
    }

    if (resolvedType === "text" && !input.text) {
      return {
        status: "error",
        error: "Text clips require 'text' content.",
      };
    }

    let clip: TimelineClip;
    const baseName = input.name?.trim();
    const start = input.start ?? 0;

    switch (resolvedType) {
      case "video": {
        clip = createVideoClip(
          resolvedSrc!,
          baseName || "Video Clip",
          start,
          resolvedDuration,
          {
            assetId: input.assetId,
            width: resolvedWidth,
            height: resolvedHeight,
            sourceDuration: resolvedSourceDuration,
          }
        );
        applyCommonOverrides(clip, { ...input, type: resolvedType, start, duration: resolvedDuration });
        if (input.objectFit) {
          clip.objectFit = input.objectFit;
        }
        if (input.focus) {
          clip.focus = input.focus;
        }
        break;
      }
      case "audio": {
        clip = createAudioClip(
          resolvedSrc!,
          baseName || "Audio Clip",
          start,
          resolvedDuration,
          { assetId: input.assetId, sourceDuration: resolvedSourceDuration }
        );
        applyCommonOverrides(clip, { ...input, type: resolvedType, start, duration: resolvedDuration });
        if (input.volume !== undefined) {
          clip.volume = input.volume;
        }
        break;
      }
      case "image": {
        clip = createImageClip(
          resolvedSrc!,
          baseName || "Image Clip",
          start,
          resolvedDuration,
          {
            assetId: input.assetId,
            width: resolvedWidth,
            height: resolvedHeight,
          }
        );
        applyCommonOverrides(clip, { ...input, type: resolvedType, start, duration: resolvedDuration });
        break;
      }
      case "text": {
        clip = createTextClip(
          input.text!,
          baseName || "Text Clip",
          start,
          resolvedDuration
        );
        applyCommonOverrides(clip, { ...input, type: resolvedType, start, duration: resolvedDuration });
        if (input.fontSize !== undefined) {
          clip.fontSize = input.fontSize;
        }
        if (input.fill !== undefined) {
          clip.fill = input.fill;
        }
        if (input.opacity !== undefined) {
          clip.opacity = input.opacity;
        }
        if (input.template !== undefined) {
          clip.template = input.template;
        }
        if (input.subtitle !== undefined) {
          clip.subtitle = input.subtitle;
        }
        if (input.backgroundColor !== undefined) {
          clip.backgroundColor = input.backgroundColor;
        }
        break;
      }
      default:
        return {
          status: "error",
          error: `Unsupported clip type ${resolvedType}.`,
        };
    }

    store.addClip(clip, input.layerId);

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Added ${clip.type} clip "${clip.name}" starting at ${clip.start.toFixed(
          2
        )}s.`,
      },
      {
        type: "json",
        data: {
          clip,
          targetLayerId: input.layerId ?? null,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
