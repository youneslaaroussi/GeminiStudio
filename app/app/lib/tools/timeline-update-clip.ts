import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type {
  Project,
  TimelineClip,
  VideoClip,
  AudioClip,
  ImageClip,
  TextClip,
  Focus,
} from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const vectorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const focusSchema: z.ZodType<Focus> = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  padding: z.number().min(0),
});

const clipUpdateSchema = z.object({
  clipId: z.string().min(1, "Clip ID is required"),
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(180, "Name must be 180 characters or fewer")
    .optional(),
  start: z.number().min(0, "Start must be zero or greater").optional(),
  duration: z.number().positive("Duration must be positive").optional(),
  offset: z.number().min(0, "Offset must be zero or greater").optional(),
  speed: z
    .number()
    .positive("Speed must be positive")
    .max(8, "Speed must be 8x or slower")
    .optional(),
  position: vectorSchema.optional(),
  scale: vectorSchema.optional(),
  assetId: z.string().optional(),
  videoSettings: z
    .object({
      src: z.string().url("Provide a valid video URL").optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      objectFit: z.enum(["contain", "cover", "fill"]).optional(),
      focus: focusSchema.optional(),
    })
    .optional(),
  audioSettings: z
    .object({
      src: z.string().url("Provide a valid audio URL").optional(),
      volume: z
        .number()
        .min(0, "Volume must be between 0 and 1")
        .max(1, "Volume must be between 0 and 1")
        .optional(),
    })
    .optional(),
  imageSettings: z
    .object({
      src: z.string().url("Provide a valid image URL").optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  textSettings: z
    .object({
      text: z.string().min(1, "Text content cannot be empty").optional(),
      fontSize: z.number().positive().optional(),
      fill: z.string().optional(),
      opacity: z
        .number()
        .min(0, "Opacity must be between 0 and 1")
        .max(1, "Opacity must be between 0 and 1")
        .optional(),
    })
    .optional(),
});

type ClipUpdateInput = z.infer<typeof clipUpdateSchema>;

function buildUpdates(
  clip: TimelineClip,
  input: ClipUpdateInput
): Partial<TimelineClip> {
  const updates: Partial<TimelineClip> = {};

  if (input.name !== undefined) updates.name = input.name;
  if (input.start !== undefined) updates.start = input.start;
  if (input.duration !== undefined) updates.duration = input.duration;
  if (input.offset !== undefined) updates.offset = input.offset;
  if (input.speed !== undefined) updates.speed = input.speed;
  if (input.position) updates.position = input.position;
  if (input.scale) updates.scale = input.scale;
  if (input.assetId !== undefined) updates.assetId = input.assetId;

  switch (clip.type) {
    case "video": {
      const videoUpdates: Partial<VideoClip> = {};
      if (input.videoSettings) {
        const { src, width, height, objectFit, focus } = input.videoSettings;
        if (src !== undefined) videoUpdates.src = src;
        if (width !== undefined) videoUpdates.width = width;
        if (height !== undefined) videoUpdates.height = height;
        if (objectFit !== undefined) videoUpdates.objectFit = objectFit;
        if (focus !== undefined) videoUpdates.focus = focus;
      }
      return { ...updates, ...videoUpdates };
    }
    case "audio": {
      const audioUpdates: Partial<AudioClip> = {};
      if (input.audioSettings) {
        const { src, volume } = input.audioSettings;
        if (src !== undefined) audioUpdates.src = src;
        if (volume !== undefined) audioUpdates.volume = volume;
      }
      return { ...updates, ...audioUpdates };
    }
    case "image": {
      const imageUpdates: Partial<ImageClip> = {};
      if (input.imageSettings) {
        const { src, width, height } = input.imageSettings;
        if (src !== undefined) imageUpdates.src = src;
        if (width !== undefined) imageUpdates.width = width;
        if (height !== undefined) imageUpdates.height = height;
      }
      return { ...updates, ...imageUpdates };
    }
    case "text": {
      const textUpdates: Partial<TextClip> = {};
      if (input.textSettings) {
        const { text, fontSize, fill, opacity } = input.textSettings;
        if (text !== undefined) textUpdates.text = text;
        if (fontSize !== undefined) textUpdates.fontSize = fontSize;
        if (fill !== undefined) textUpdates.fill = fill;
        if (opacity !== undefined) textUpdates.opacity = opacity;
      }
      return { ...updates, ...textUpdates };
    }
    default:
      return updates;
  }
}

export const timelineUpdateClipTool: ToolDefinition<
  typeof clipUpdateSchema,
  Project
> = {
  name: "timelineUpdateClip",
  label: "Update Timeline Clip",
  description:
    "Adjust clip timing and type-specific settings while reusing the existing project store update action.",
  runLocation: "client",
  inputSchema: clipUpdateSchema,
  fields: [
    {
      name: "clipId",
      label: "Clip ID",
      type: "text",
      required: true,
    },
    {
      name: "name",
      label: "Clip Name",
      type: "text",
      placeholder: "Optional new name",
    },
    {
      name: "start",
      label: "Start (seconds)",
      type: "number",
    },
    {
      name: "duration",
      label: "Duration (seconds)",
      type: "number",
    },
    {
      name: "offset",
      label: "Source Offset",
      type: "number",
    },
    {
      name: "speed",
      label: "Playback Speed",
      type: "number",
    },
    {
      name: "position",
      label: "Position",
      type: "json",
      placeholder: '{"x":0,"y":0}',
    },
    {
      name: "scale",
      label: "Scale",
      type: "json",
      placeholder: '{"x":1,"y":1}',
    },
    {
      name: "videoSettings",
      label: "Video Settings",
      type: "json",
      placeholder: '{"src":"","width":1920,"height":1080,"objectFit":"contain","focus":{...}}',
    },
    {
      name: "audioSettings",
      label: "Audio Settings",
      type: "json",
      placeholder: '{"src":"","volume":1}',
    },
    {
      name: "imageSettings",
      label: "Image Settings",
      type: "json",
      placeholder: '{"src":"","width":1920,"height":1080}',
    },
    {
      name: "textSettings",
      label: "Text Settings",
      type: "json",
      placeholder: '{"text":"","fontSize":48,"fill":"#ffffff","opacity":1}',
    },
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Timeline tools are only available in the browser runtime.",
      };
    }

    const store = useProjectStore.getState();
    const clip = store.getClipById(input.clipId);
    if (!clip) {
      return {
        status: "error",
        error: `Clip "${input.clipId}" was not found.`,
      };
    }

    const beforeSnapshot = JSON.parse(JSON.stringify(clip)) as TimelineClip;
    const updates = buildUpdates(clip, input);
    if (Object.keys(updates).length === 0) {
      return {
        status: "error",
        error: "No updates were provided.",
      };
    }

    store.updateClip(input.clipId, updates as Partial<TimelineClip>);

    const updatedClip = useProjectStore
      .getState()
      .getClipById(input.clipId) as TimelineClip | undefined;

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Updated ${clip.type} clip "${updatedClip?.name ?? clip.name}".`,
      },
      {
        type: "json",
        data: {
          before: beforeSnapshot,
          after: updatedClip ?? null,
          applied: updates,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
