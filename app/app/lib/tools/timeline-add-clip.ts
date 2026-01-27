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
} from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const vectorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const focusSchema: z.ZodType<Focus> = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive("Focus width must be positive"),
  height: z.number().positive("Focus height must be positive"),
  padding: z.number().min(0, "Padding must be zero or greater"),
});

const baseClipSchema = z.object({
  layerId: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(180, "Name must be 180 characters or fewer")
    .optional(),
  start: z.number().min(0, "Start time must be zero or greater"),
  duration: z.number().positive("Duration must be positive"),
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

const mediaSrcSchema = z
  .string()
  .trim()
  .min(1, "Media source cannot be empty")
  .refine(
    (value) => {
      if (!value) return false;
      try {
        // Accept absolute URLs
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        // Also allow application-relative paths
        return value.startsWith("/");
      }
    },
    { message: "Provide a valid media URL or application path" },
  );

const addClipSchema = z.discriminatedUnion("type", [
  baseClipSchema.extend({
    type: z.literal("video"),
    src: mediaSrcSchema,
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    focus: focusSchema.optional(),
    objectFit: z.enum(["contain", "cover", "fill"]).optional(),
  }),
  baseClipSchema.extend({
    type: z.literal("audio"),
    src: mediaSrcSchema,
    volume: z
      .number()
      .min(0, "Volume must be between 0 and 1")
      .max(1, "Volume must be between 0 and 1")
      .optional(),
  }),
  baseClipSchema.extend({
    type: z.literal("image"),
    src: mediaSrcSchema,
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }),
  baseClipSchema.extend({
    type: z.literal("text"),
    text: z.string().min(1, "Text content cannot be empty"),
    fontSize: z.number().positive().optional(),
    fill: z.string().optional(),
    opacity: z
      .number()
      .min(0, "Opacity must be between 0 and 1")
      .max(1, "Opacity must be between 0 and 1")
      .optional(),
  }),
]);

type AddClipInput = z.infer<typeof addClipSchema>;

function applyCommonOverrides(clip: TimelineClip, input: AddClipInput) {
  if (input.offset !== undefined) clip.offset = input.offset;
  if (input.speed !== undefined) clip.speed = input.speed;
  if (input.position) clip.position = input.position;
  if (input.scale) clip.scale = input.scale;
  if (input.assetId) clip.assetId = input.assetId;
  if (input.name) clip.name = input.name;
}

export const timelineAddClipTool: ToolDefinition<
  typeof addClipSchema,
  Project
> = {
  name: "timelineAddClip",
  label: "Add Timeline Clip",
  description:
    "Insert a new clip on the timeline using the project store's existing helpers.",
  runLocation: "client",
  inputSchema: addClipSchema,
  fields: [
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
      required: true,
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
      required: true,
    },
    {
      name: "duration",
      label: "Duration (seconds)",
      type: "number",
      required: true,
    },
    {
      name: "src",
      label: "Source URL",
      type: "text",
      placeholder: "Video, audio, or image URL",
      description: "Required for media clips (video, audio, image).",
    },
    {
      name: "text",
      label: "Text Content",
      type: "textarea",
      description: "Required for text clips.",
    },
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "Optional asset metadata reference",
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
      description: "Scene position as { x, y } in pixels.",
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
      label: "Focus Area",
      type: "json",
      placeholder: '{"x":0,"y":0,"width":1,"height":1,"padding":0}',
      description: "Optional video focus region.",
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
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Timeline tools are only available when running in the browser.",
      };
    }

    const store = useProjectStore.getState();
    let clip: TimelineClip;
    const baseName = input.name?.trim();

    switch (input.type) {
      case "video": {
        clip = createVideoClip(
          input.src,
          baseName || "Video Clip",
          input.start,
          input.duration,
          {
            assetId: input.assetId,
            width: input.width,
            height: input.height,
          }
        );
        applyCommonOverrides(clip, input);
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
          input.src,
          baseName || "Audio Clip",
          input.start,
          input.duration,
          { assetId: input.assetId }
        );
        applyCommonOverrides(clip, input);
        if (input.volume !== undefined) {
          clip.volume = input.volume;
        }
        break;
      }
      case "image": {
        clip = createImageClip(
          input.src,
          baseName || "Image Clip",
          input.start,
          input.duration,
          {
            assetId: input.assetId,
            width: input.width,
            height: input.height,
          }
        );
        applyCommonOverrides(clip, input);
        break;
      }
      case "text": {
        clip = createTextClip(
          input.text,
          baseName || "Text Clip",
          input.start,
          input.duration
        );
        applyCommonOverrides(clip, input);
        if (input.fontSize !== undefined) {
          clip.fontSize = input.fontSize;
        }
        if (input.fill !== undefined) {
          clip.fill = input.fill;
        }
        if (input.opacity !== undefined) {
          clip.opacity = input.opacity;
        }
        break;
      }
      default:
        return {
          status: "error",
          error: `Unsupported clip type ${(input as { type: string }).type}.`,
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
