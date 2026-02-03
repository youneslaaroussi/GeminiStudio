import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const MIN_FPS = 1;
const MAX_FPS = 240;

const setSceneConfigSchema = z.object({
  width: z.number().int().min(MIN_WIDTH).optional(),
  height: z.number().int().min(MIN_HEIGHT).optional(),
  fps: z.number().int().min(MIN_FPS).max(MAX_FPS).optional(),
  background: z.string().optional(),
  name: z.string().optional(),
});

export type SetSceneConfigInput = z.infer<typeof setSceneConfigSchema>;

export const setSceneConfigTool: ToolDefinition<
  typeof setSceneConfigSchema,
  Project
> = {
  name: "setSceneConfig",
  label: "Set Scene Config",
  description:
    "Set the project scene configuration: dimensions (width x height), frame rate (fps), background color, or project name. Only provided fields are updated.",
  runLocation: "client",
  inputSchema: setSceneConfigSchema,
  fields: [
    {
      name: "width",
      label: "Width",
      type: "number",
      description: "Output width in pixels (min 320). Use with height to set resolution.",
    },
    {
      name: "height",
      label: "Height",
      type: "number",
      description: "Output height in pixels (min 240). Use with width to set resolution.",
    },
    {
      name: "fps",
      label: "FPS",
      type: "number",
      description: "Frames per second (1–240). Common values: 24, 25, 30, 50, 60.",
    },
    {
      name: "background",
      label: "Background",
      type: "text",
      placeholder: "#000000",
      description: "Background color as hex (e.g. #000000 for black).",
    },
    {
      name: "name",
      label: "Project Name",
      type: "text",
      description: "Project display name.",
    },
  ],
  async run(input, _context) {
    if (
      input.width === undefined &&
      input.height === undefined &&
      input.fps === undefined &&
      input.background === undefined &&
      input.name === undefined
    ) {
      return {
        status: "error" as const,
        error:
          "Provide at least one of: width, height, fps, background, name.",
      };
    }

    if (
      (input.width !== undefined && input.height === undefined) ||
      (input.width === undefined && input.height !== undefined)
    ) {
      return {
        status: "error" as const,
        error: "Provide both width and height to set resolution.",
      };
    }

    if (
      input.width !== undefined &&
      input.height !== undefined &&
      (input.width < MIN_WIDTH || input.height < MIN_HEIGHT)
    ) {
      return {
        status: "error" as const,
        error: `Resolution must be at least ${MIN_WIDTH}x${MIN_HEIGHT}.`,
      };
    }

    if (
      input.fps !== undefined &&
      (input.fps < MIN_FPS || input.fps > MAX_FPS)
    ) {
      return {
        status: "error" as const,
        error: `fps must be between ${MIN_FPS} and ${MAX_FPS}.`,
      };
    }

    const store = useProjectStore.getState();
    const project = store.project;
    if (!project) {
      return {
        status: "error" as const,
        error: "No project loaded.",
      };
    }

    const settings: Parameters<typeof store.updateProjectSettings>[0] = {};
    if (input.width !== undefined && input.height !== undefined) {
      settings.resolution = {
        width: Math.max(MIN_WIDTH, input.width),
        height: Math.max(MIN_HEIGHT, input.height),
      };
    }
    if (input.fps !== undefined) {
      settings.fps = Math.max(MIN_FPS, Math.min(MAX_FPS, input.fps));
    }
    if (input.background !== undefined) {
      settings.background = input.background;
    }
    if (input.name !== undefined) {
      settings.name = input.name || "Untitled Project";
    }

    store.updateProjectSettings(settings);

    const updated = store.project;
    const resolution = updated.resolution ?? { width: 1920, height: 1080 };
    const lines = [
      "Scene config updated.",
      `Resolution: ${resolution.width}x${resolution.height}`,
      `FPS: ${updated.fps}`,
      `Background: ${updated.background}`,
      `Name: ${updated.name}`,
    ];

    return {
      status: "success" as const,
      outputs: [
        {
          type: "text" as const,
          text: lines.join(" "),
        },
      ],
      meta: {
        config: {
          resolution: { width: resolution.width, height: resolution.height },
          fps: updated.fps,
          background: updated.background,
          name: updated.name,
        },
      },
    };
  },
};
