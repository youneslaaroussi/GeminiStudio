import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { ToolDefinition, ToolOutput } from "./types";
import type { Project, TimelineClip } from "@/app/types/timeline";

const deleteClipSchema = z.object({
  clipIds: z
    .array(z.string().min(1))
    .min(1, "At least one clip ID is required")
    .describe("List of clip IDs to delete from the timeline"),
});

function findClipById(project: Project, id: string): { clip: TimelineClip; layerId: string } | null {
  for (const layer of project.layers) {
    const clip = layer.clips.find((c) => c.id === id);
    if (clip) {
      return { clip, layerId: layer.id };
    }
  }
  return null;
}

export const timelineDeleteClipTool: ToolDefinition<
  typeof deleteClipSchema,
  Project
> = {
  name: "timelineDeleteClip",
  label: "Delete Timeline Clip",
  description:
    "Remove one or more clips from the timeline by their IDs.",
  runLocation: "client",
  inputSchema: deleteClipSchema,
  fields: [
    {
      name: "clipIds",
      label: "Clip IDs",
      type: "json",
      placeholder: '["clip-abc123", "clip-def456"]',
      description: "JSON array of clip IDs to delete",
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
    const project = store.project;

    // Validate and collect clips to delete
    const toDelete: Array<{ id: string; clip: TimelineClip; layerId: string }> = [];
    const notFound: string[] = [];

    for (const clipId of input.clipIds) {
      const found = findClipById(project, clipId);
      if (found) {
        toDelete.push({ id: clipId, ...found });
      } else {
        notFound.push(clipId);
      }
    }

    if (toDelete.length === 0) {
      return {
        status: "error",
        error: `No clips found with the given IDs: ${notFound.join(", ")}. Use getTimelineState to discover valid clip IDs.`,
      };
    }

    // Delete each clip
    for (const { id } of toDelete) {
      store.deleteClip(id);
    }

    const deleted = toDelete.map(({ id, clip, layerId }) => ({
      id,
      name: clip.name ?? "Unnamed",
      type: clip.type,
      layerId,
    }));

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Deleted ${deleted.length} clip(s): ${deleted.map((d) => d.name).join(", ")}.${
          notFound.length > 0
            ? ` ${notFound.length} ID(s) not found: ${notFound.join(", ")}.`
            : ""
        }`,
      },
      {
        type: "json",
        data: {
          deleted,
          notFound: notFound.length > 0 ? notFound : undefined,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
