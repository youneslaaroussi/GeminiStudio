import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { ToolDefinition, ToolOutput } from "./types";
import type { Project } from "@/app/types/timeline";

const getStateSchema = z.object({
  includeClipDetails: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include detailed clip information"),
});

export const getTimelineStateTool: ToolDefinition<
  typeof getStateSchema,
  Project
> = {
  name: "getTimelineState",
  label: "Get Timeline State",
  description:
    "Get the current state of the project timeline including all layers and clips with their IDs, positions, and properties.",
  runLocation: "client",
  inputSchema: getStateSchema,
  fields: [
    {
      name: "includeClipDetails",
      label: "Include Clip Details",
      type: "select",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No (summary only)" },
      ],
      defaultValue: "true",
      description: "Whether to include detailed clip information",
    },
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Timeline tools require the browser runtime.",
      };
    }

    const store = useProjectStore.getState();
    const project = store.project;

    const totalClips = project.layers.reduce(
      (sum, layer) => sum + layer.clips.length,
      0
    );

    const layerSummaries = project.layers.map((layer) => {
      const clipSummaries = layer.clips.map((clip) => {
        if (input.includeClipDetails) {
          return {
            id: clip.id,
            name: clip.name ?? "Unnamed",
            type: clip.type,
            start: clip.start,
            duration: clip.duration,
            end: clip.start + clip.duration / clip.speed,
            speed: clip.speed,
            ...(clip.type === "video" && clip.src ? { src: clip.src } : {}),
            ...(clip.type === "audio" && clip.src ? { src: clip.src } : {}),
            ...(clip.type === "image" && clip.src ? { src: clip.src } : {}),
            ...(clip.type === "text" && clip.text ? { text: clip.text } : {}),
            ...(clip.assetId ? { assetId: clip.assetId } : {}),
          };
        }
        return {
          id: clip.id,
          name: clip.name ?? "Unnamed",
          type: clip.type,
        };
      });

      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        clipCount: layer.clips.length,
        clips: clipSummaries,
      };
    });

    // Calculate timeline duration
    let timelineDuration = 0;
    for (const layer of project.layers) {
      for (const clip of layer.clips) {
        const clipEnd = clip.start + clip.duration / clip.speed;
        if (clipEnd > timelineDuration) {
          timelineDuration = clipEnd;
        }
      }
    }

    const summary = {
      projectName: project.name,
      resolution: project.resolution,
      fps: project.fps,
      layerCount: project.layers.length,
      totalClips,
      timelineDuration: Math.round(timelineDuration * 100) / 100,
      layers: layerSummaries,
    };

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Timeline has ${project.layers.length} layer(s) with ${totalClips} clip(s). Duration: ${summary.timelineDuration}s.`,
      },
      {
        type: "json",
        data: summary,
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
