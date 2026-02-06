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
  ClipTransition,
  TransitionType,
} from "@/app/types/timeline";
import { DEFAULT_COLOR_GRADING } from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const vectorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const focusSchema: z.ZodType<Focus> = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1),
});

/** Color grading: exposure -2 to 2; contrast/saturation/temperature/tint/highlights/shadows -100 to 100 (use 15-50 for visible effect, never 0-1). */
const colorGradingSchema = z
  .object({
    exposure: z.number().min(-2).max(2).optional().describe("Range -2 to 2 only"),
    contrast: z.number().min(-100).max(100).optional().describe("Range -100 to 100. Use 15-50 for visible effect (not 0.1)."),
    saturation: z.number().min(-100).max(100).optional().describe("Range -100 to 100. Use 15-50 for visible effect (not 0.15)."),
    temperature: z.number().min(-100).max(100).optional().describe("Range -100 to 100 (cool to warm). Use 15-50 for visible effect (not 0.2)."),
    tint: z.number().min(-100).max(100).optional().describe("Range -100 to 100 (green to magenta). Use 15-50 for visible effect."),
    highlights: z.number().min(-100).max(100).optional().describe("Range -100 to 100. Use 15-50 for visible effect."),
    shadows: z.number().min(-100).max(100).optional().describe("Range -100 to 100. Use 15-50 for visible effect."),
  })
  .optional()
  .describe("Exposure: -2 to 2. All others: -100 to 100. Use 20-50 for visible change—never 0.1 or 0.2.");

/** Chroma key: key color (hex), threshold and smoothness 0–1 */
const chromaKeySchema = z
  .object({
    color: z.string().regex(/^#[0-9a-fA-F]{3,6}$/, "Key color as hex e.g. #00ff00"),
    threshold: z.number().min(0).max(1),
    smoothness: z.number().min(0).max(1).optional(),
  })
  .optional();

const transitionTypeSchema = z.enum([
  "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down",
  "cross-dissolve", "zoom", "blur", "dip-to-black",
]);

const clipTransitionSchema = z.object({
  type: transitionTypeSchema,
  duration: z.number().min(0.1).max(5),
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
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      objectFit: z.enum(["contain", "cover", "fill"]).optional(),
      focus: focusSchema.optional(),
      colorGrading: colorGradingSchema,
      chromaKey: chromaKeySchema,
      audioVolume: z.number().min(0).max(1).optional(),
    })
    .optional(),
  audioSettings: z
    .object({
      volume: z
        .number()
        .min(0, "Volume must be between 0 and 1")
        .max(1, "Volume must be between 0 and 1")
        .optional(),
    })
    .optional(),
  imageSettings: z
    .object({
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      colorGrading: colorGradingSchema,
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
      template: z
        .enum(["text", "title-card", "lower-third", "caption-style"])
        .optional(),
      subtitle: z.string().optional(),
      backgroundColor: z.string().optional(),
    })
    .optional(),
  enterTransition: clipTransitionSchema.optional().nullable(),
  exitTransition: clipTransitionSchema.optional().nullable(),
  animation: z.enum(["none", "hover", "pulse", "float", "glow"]).optional().nullable(),
  animationIntensity: z.number().min(0).max(5).optional(),
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

  // Enter/exit transitions (apply to all clip types)
  if (input.enterTransition !== undefined) {
    if (input.enterTransition === null || input.enterTransition.type === "none") {
      updates.enterTransition = undefined;
    } else {
      updates.enterTransition = input.enterTransition as ClipTransition;
    }
  }
  if (input.exitTransition !== undefined) {
    if (input.exitTransition === null || input.exitTransition.type === "none") {
      updates.exitTransition = undefined;
    } else {
      updates.exitTransition = input.exitTransition as ClipTransition;
    }
  }

  // Animation (video, text, image only—not audio). Use assertion because
  // Partial<TimelineClip> doesn't allow animation (AudioClip has no animation).
  if (clip.type !== "audio") {
    const visualUpdates = updates as Partial<VideoClip | TextClip | ImageClip>;
    if (input.animation !== undefined) {
      if (input.animation === null || input.animation === "none" || !input.animation) {
        visualUpdates.animation = undefined;
      } else {
        visualUpdates.animation = input.animation as "hover" | "pulse" | "float" | "glow";
      }
    }
    if (input.animationIntensity !== undefined) {
      visualUpdates.animationIntensity = Math.max(0, Math.min(5, input.animationIntensity));
    }
  }

  switch (clip.type) {
    case "video": {
      const videoUpdates: Partial<VideoClip> = {};
      if (input.videoSettings) {
        const { width, height, objectFit, focus, colorGrading, chromaKey, audioVolume } = input.videoSettings;
        if (width !== undefined) videoUpdates.width = width;
        if (height !== undefined) videoUpdates.height = height;
        if (objectFit !== undefined) videoUpdates.objectFit = objectFit;
        if (focus !== undefined) videoUpdates.focus = focus;
        if (colorGrading !== undefined) {
          const current = (clip as VideoClip).colorGrading ?? {};
          videoUpdates.colorGrading = { ...DEFAULT_COLOR_GRADING, ...current, ...colorGrading };
        }
        if (chromaKey !== undefined) videoUpdates.chromaKey = chromaKey;
        if (audioVolume !== undefined) videoUpdates.audioVolume = audioVolume;
      }
      return { ...updates, ...videoUpdates };
    }
    case "audio": {
      const audioUpdates: Partial<AudioClip> = {};
      if (input.audioSettings) {
        const { volume } = input.audioSettings;
        if (volume !== undefined) audioUpdates.volume = volume;
      }
      return { ...updates, ...audioUpdates };
    }
    case "image": {
      const imageUpdates: Partial<ImageClip> = {};
      if (input.imageSettings) {
        const { width, height, colorGrading } = input.imageSettings;
        if (width !== undefined) imageUpdates.width = width;
        if (height !== undefined) imageUpdates.height = height;
        if (colorGrading !== undefined) {
          const current = (clip as ImageClip).colorGrading ?? {};
          imageUpdates.colorGrading = { ...DEFAULT_COLOR_GRADING, ...current, ...colorGrading };
        }
      }
      return { ...updates, ...imageUpdates };
    }
    case "text": {
      const textUpdates: Partial<TextClip> = {};
      if (input.textSettings) {
        const { text, fontSize, fill, opacity, template, subtitle, backgroundColor } = input.textSettings;
        if (text !== undefined) textUpdates.text = text;
        if (fontSize !== undefined) textUpdates.fontSize = fontSize;
        if (fill !== undefined) textUpdates.fill = fill;
        if (opacity !== undefined) textUpdates.opacity = opacity;
        if (template !== undefined) textUpdates.template = template;
        if (subtitle !== undefined) textUpdates.subtitle = subtitle;
        if (backgroundColor !== undefined) textUpdates.backgroundColor = backgroundColor;
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
    "Adjust clip timing and type-specific settings. For text clips, use textSettings with template, subtitle, backgroundColor. Use enterTransition and exitTransition to set fade/slide/zoom in/out effects (type, duration 0.1-5s). Use animation (none|hover|pulse|float|glow) and animationIntensity (0-5x) for idle animations on video, text, and image clips. COLOR GRADING: contrast, saturation, temperature, tint, highlights, shadows use range -100 to 100 (NOT 0–1). Use 20–50 for visible effect—values like 0.1 or 0.2 are too small. exposure is -2 to 2.",
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
      description:
        "Scene position in pixels. Center origin: (0,0) = center; x positive = right, negative = left; y positive = down (bottom of frame), negative = up (top of frame).",
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
      placeholder:
        '{"width":1920,"height":1080,"objectFit":"contain","focus":{"x":0.5,"y":0.5,"zoom":1},"colorGrading":{"temperature":25,"saturation":30,"contrast":15},"chromaKey":{...},"audioVolume":1}',
      description:
        "Do not pass src—media URL is derived from clip's assetId. focus: center (x,y 0–1) and zoom (1 = full frame, 2 = 2×). colorGrading: contrast, saturation, temperature, tint, highlights, shadows MUST use -100 to 100 (NOT 0–1). Example for slightly warmer/more saturated: {\"temperature\":25,\"saturation\":30,\"contrast\":15}. Never use 0.1, 0.2, etc—use 15–50. exposure: -2 to 2 only. chromaKey: key color (hex), threshold and smoothness 0–1. audioVolume: 0–1.",
    },
    {
      name: "audioSettings",
      label: "Audio Settings",
      type: "json",
      placeholder: '{"volume":1}',
      description: "Do not pass src—media URL is derived from clip's assetId.",
    },
    {
      name: "imageSettings",
      label: "Image Settings",
      type: "json",
      placeholder: '{"width":1920,"height":1080}',
      description:
        "Do not pass src—media URL is derived from clip's assetId. colorGrading: contrast, saturation, temperature, tint, highlights, shadows use -100 to 100 (NOT 0–1). Use 15–50 for visible effect. exposure: -2 to 2 only.",
    },
    {
      name: "textSettings",
      label: "Text Settings",
      type: "json",
      placeholder: '{"text":"","fontSize":48,"fill":"#ffffff","opacity":1,"template":"lower-third","subtitle":"","backgroundColor":"rgba(0,0,0,0.8)"}',
      description: "For text clips: template (text|title-card|lower-third|caption-style), subtitle, backgroundColor.",
    },
    {
      name: "enterTransition",
      label: "Enter Transition",
      type: "json",
      placeholder: '{"type":"fade","duration":0.5}',
      description: "In transition when clip starts. Type: fade, slide-left, slide-right, slide-up, slide-down, zoom, dip-to-black. Duration 0.1-5s. Omit or type:none to clear.",
    },
    {
      name: "exitTransition",
      label: "Exit Transition",
      type: "json",
      placeholder: '{"type":"fade","duration":0.5}',
      description: "Out transition when clip ends. Same types as enter. Omit or type:none to clear.",
    },
    {
      name: "animation",
      label: "Animation",
      type: "text",
      placeholder: "none | hover | pulse | float | glow",
      description: "Idle animation while clip is visible (video, text, image only). none to clear.",
    },
    {
      name: "animationIntensity",
      label: "Animation Intensity",
      type: "number",
      placeholder: "1",
      description: "Animation strength 0–5x (1 = normal). Only applies when animation is set.",
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

    // For video/audio clips, enforce source duration constraint
    if (clip.type === "video" || clip.type === "audio") {
      const typedClip = clip as VideoClip | AudioClip;
      const sourceDuration = typedClip.sourceDuration;
      if (sourceDuration != null) {
        const newOffset = updates.offset ?? clip.offset;
        const newDuration = updates.duration ?? clip.duration;
        if (newOffset + newDuration > sourceDuration) {
          // Clamp duration to not exceed source
          const maxDuration = Math.max(0.1, sourceDuration - newOffset);
          if (newDuration > maxDuration) {
            updates.duration = maxDuration;
          }
        }
        // Also ensure offset doesn't exceed source - min duration
        if (newOffset > sourceDuration - 0.1) {
          updates.offset = Math.max(0, sourceDuration - 0.1);
        }
      }
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
