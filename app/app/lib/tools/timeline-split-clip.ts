import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { ToolDefinition, ToolOutput } from "./types";
import type { Project, TimelineClip } from "@/app/types/timeline";

const splitClipSchema = z.object({
  clipId: z.string().min(1, "Clip ID is required"),
  time: z
    .number()
    .min(0, "Split time must be zero or greater")
    .describe("Timeline timestamp in seconds"),
});

function findClipById(clips: TimelineClip[], id: string) {
  return clips.find((clip) => clip.id === id);
}

function flattenClips(project: Project) {
  return project.layers.flatMap((layer) => layer.clips);
}

export const timelineSplitClipTool: ToolDefinition<
  typeof splitClipSchema,
  Project
> = {
  name: "timelineSplitClip",
  label: "Split Timeline Clip",
  description:
    "Split an existing clip using the project store's split action to preserve history.",
  runLocation: "client",
  inputSchema: splitClipSchema,
  fields: [
    {
      name: "clipId",
      label: "Clip ID",
      type: "text",
      required: true,
    },
    {
      name: "time",
      label: "Split Time (seconds)",
      type: "number",
      required: true,
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
    const preClips = flattenClips(store.project);
    const originalClip = findClipById(preClips, input.clipId);
    if (!originalClip) {
      return {
        status: "error",
        error: `Clip "${input.clipId}" was not found.`,
      };
    }

    const clipEnd = originalClip.start + originalClip.duration / originalClip.speed;
    if (input.time <= originalClip.start || input.time >= clipEnd) {
      return {
        status: "error",
        error: `Split time must fall within the clip range (${originalClip.start.toFixed(
          2
        )}s – ${clipEnd.toFixed(2)}s).`,
      };
    }

    store.splitClipAtTime(input.clipId, input.time);

    const postClips = flattenClips(useProjectStore.getState().project);
    const updatedOriginal = findClipById(postClips, input.clipId);
    const candidateNew = postClips.find(
      (clip) =>
        clip.id !== input.clipId &&
        clip.start === input.time &&
        clip.name === originalClip.name
    );

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Split clip "${originalClip.name}" at ${input.time.toFixed(2)}s.`,
      },
      {
        type: "json",
        data: {
          originalClipBefore: originalClip,
          originalClipAfter: updatedOriginal ?? null,
          newClip: candidateNew ?? null,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
