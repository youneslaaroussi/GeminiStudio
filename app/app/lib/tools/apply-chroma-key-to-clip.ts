import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { Project, VideoClip, ImageClip } from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const applyChromaKeySchema = z.object({
  clipId: z.string().min(1, "Clip ID is required"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,6}$/, "Key color as hex e.g. #00ff00 (green) or #0000ff (blue)")
    .describe("Key color to make transparent (hex)"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.4)
    .describe("Tolerance 0–1: higher = more pixels become transparent"),
  smoothness: z
    .number()
    .min(0)
    .max(1)
    .default(0.1)
    .optional()
    .describe("Edge softness 0–1 (optional)"),
});

type ApplyChromaKeyInput = z.infer<typeof applyChromaKeySchema>;

export const applyChromaKeyToClipTool: ToolDefinition<
  typeof applyChromaKeySchema,
  Project
> = {
  name: "applyChromaKeyToClip",
  label: "Apply Chroma Key to Clip",
  description:
    "Apply a chroma key (green screen) effect to a video or image clip. Makes the chosen key color transparent so you can composite over another background. Use getTimelineState to find clip IDs.",
  runLocation: "client",
  inputSchema: applyChromaKeySchema,
  fields: [
    { name: "clipId", label: "Clip ID", type: "text", required: true, description: "ID of the video or image clip to key" },
    {
      name: "color",
      label: "Key color",
      type: "text",
      placeholder: "#00ff00",
      required: true,
      description: "Hex color to make transparent (e.g. #00ff00 green, #0000ff blue)",
    },
    {
      name: "threshold",
      label: "Threshold",
      type: "number",
      placeholder: "0.4",
      description: "0–1: higher = more of the key color becomes transparent (default 0.4)",
    },
    {
      name: "smoothness",
      label: "Smoothness",
      type: "number",
      placeholder: "0.1",
      description: "0–1: edge softness (default 0.1)",
    },
  ],
  async run(input: ApplyChromaKeyInput) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Chroma key tool is only available in the browser.",
      };
    }

    const store = useProjectStore.getState();
    const clip = store.getClipById(input.clipId);
    if (!clip) {
      return {
        status: "error",
        error: `Clip "${input.clipId}" not found. Use getTimelineState to list clips.`,
      };
    }

    if (clip.type !== "video" && clip.type !== "image") {
      return {
        status: "error",
        error: "Chroma key can only be applied to video or image clips.",
      };
    }

    const chromaKey = {
      color: input.color,
      threshold: input.threshold,
      smoothness: input.smoothness ?? 0.1,
    };

    const updates: Partial<VideoClip> | Partial<ImageClip> = { chromaKey };
    store.updateClip(input.clipId, updates);

    const updated = store.getClipById(input.clipId);
    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Applied chroma key to ${clip.type} clip "${updated?.name ?? clip.name}" (key color ${input.color}, threshold ${input.threshold}).`,
      },
      {
        type: "json",
        data: { clipId: input.clipId, chromaKey },
      },
    ];

    return { status: "success", outputs };
  },
};
