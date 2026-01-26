import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { ToolDefinition, ToolOutput } from "./types";
import type { Project } from "@/app/types/timeline";

type ProjectStoreSnapshot = {
  project?: Project;
  hasUnsavedChanges?: boolean;
};

const historyActionSchema = z.object({
  action: z.enum(["status", "undo", "redo"]).default("status"),
  steps: z
    .number()
    .int("Steps must be an integer")
    .min(1, "Steps must be at least 1")
    .max(50, "Steps must be 50 or fewer")
    .optional(),
});

function summarizeProject(state: ProjectStoreSnapshot | undefined) {
  const project = state?.project;
  if (!project) {
    return "No project snapshot available.";
  }
  const layerCount = Array.isArray(project.layers) ? project.layers.length : 0;
  const clipCount = Array.isArray(project.layers)
    ? project.layers.reduce(
        (total, layer) =>
          total + (Array.isArray(layer.clips) ? layer.clips.length : 0),
        0
      )
    : 0;

  const unsaved =
    state?.hasUnsavedChanges !== undefined
      ? state.hasUnsavedChanges
        ? "unsaved changes"
        : "saved"
      : "unknown save status";

  return `${project.name ?? "Untitled"} • layers: ${layerCount} • clips: ${clipCount} • ${unsaved}`;
}

export const projectHistoryTool: ToolDefinition<
  typeof historyActionSchema,
  Project
> = {
  name: "projectHistory",
  label: "Project History",
  description:
    "Inspect the undo/redo history of the current project or trigger undo and redo operations using the existing Zustand temporal store.",
  runLocation: "client",
  inputSchema: historyActionSchema,
  fields: [
    {
      name: "action",
      label: "Action",
      type: "select",
      description: "Choose whether to view history, undo, or redo.",
      options: [
        { value: "status", label: "Show History Status" },
        { value: "undo", label: "Undo" },
        { value: "redo", label: "Redo" },
      ],
      required: true,
      defaultValue: "status",
    },
    {
      name: "steps",
      label: "Steps",
      type: "number",
      placeholder: "1",
      description:
        "How many steps to undo or redo (defaults to 1). Ignored when showing status.",
    },
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Project history tooling is only available in the browser.",
      };
    }

    const temporalStore = useProjectStore.temporal;
    if (!temporalStore) {
      return {
        status: "error",
        error: "Project history store is not available yet. Try again shortly.",
      };
    }

    const stepsRequested = input.steps ?? 1;
    const initialTemporalState = temporalStore.getState();
    let message: string | null = null;

    if (input.action === "undo") {
      const available = initialTemporalState.pastStates.length;
      if (available === 0) {
        message = "Nothing to undo.";
      } else {
        temporalStore.getState().undo(stepsRequested);
        const afterUndo = temporalStore.getState();
        const applied = Math.max(
          0,
          available - afterUndo.pastStates.length
        );
        message = `Undid ${applied} ${applied === 1 ? "step" : "steps"}.`;
      }
    } else if (input.action === "redo") {
      const available = initialTemporalState.futureStates.length;
      if (available === 0) {
        message = "Nothing to redo.";
      } else {
        temporalStore.getState().redo(stepsRequested);
        const afterRedo = temporalStore.getState();
        const applied = Math.max(
          0,
          available - afterRedo.futureStates.length
        );
        message = `Redid ${applied} ${applied === 1 ? "step" : "steps"}.`;
      }
    }

    const latestTemporalState = temporalStore.getState();
    const projectState = useProjectStore.getState();

    const pastStates = latestTemporalState.pastStates;
    const recentPast = pastStates.slice(-5);
    const pastStartIndex = pastStates.length - recentPast.length;
    const pastSummaries = recentPast.map((state, index) => ({
      type: "text" as const,
      text: `Past ${pastStartIndex + index + 1}: ${summarizeProject(
        state as ProjectStoreSnapshot
      )}`,
    }));

    const futureSummaries = latestTemporalState.futureStates
      .slice(0, 5)
      .map((state, index) => ({
        type: "text" as const,
        text: `Future ${index + 1}: ${summarizeProject(
          state as ProjectStoreSnapshot
        )}`,
      }));

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text:
          message ??
          "History status retrieved without changing the current project.",
      },
      {
        type: "list",
        title: "History Overview",
        items: [
          {
            type: "text",
            text: `Past states: ${latestTemporalState.pastStates.length}`,
          },
          {
            type: "text",
            text: `Future states: ${latestTemporalState.futureStates.length}`,
          },
          {
            type: "text",
            text: `Tracking: ${
              latestTemporalState.isTracking ? "enabled" : "paused"
            }`,
          },
          {
            type: "text",
            text: `Current project: ${summarizeProject(
              projectState as ProjectStoreSnapshot
            )}`,
          },
        ],
      },
    ];

    if (pastSummaries.length > 0) {
      outputs.push({
        type: "list",
        title: "Recent Undo Stack (latest last)",
        items: pastSummaries,
      });
    }

    if (futureSummaries.length > 0) {
      outputs.push({
        type: "list",
        title: "Upcoming Redo Stack (next first)",
        items: futureSummaries,
      });
    }

    outputs.push({
      type: "json",
      data: {
        pastStates: latestTemporalState.pastStates.length,
        futureStates: latestTemporalState.futureStates.length,
        isTracking: latestTemporalState.isTracking,
        action: input.action,
        stepsRequested,
      },
    });

    return {
      status: "success",
      outputs,
    };
  },
};
