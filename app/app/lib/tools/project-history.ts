import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { ToolDefinition, ToolOutput } from "./types";

const historyActionSchema = z.object({
  action: z.enum(["status", "undo", "redo"]).default("status"),
  steps: z
    .number()
    .int("Steps must be an integer")
    .min(1, "Steps must be at least 1")
    .max(50, "Steps must be 50 or fewer")
    .optional(),
});

export const projectHistoryTool: ToolDefinition<
  typeof historyActionSchema
> = {
  name: "projectHistory",
  label: "Project History",
  description:
    "Inspect the undo/redo history of the current project or trigger undo and redo operations.",
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

    const { syncManager, undo, redo } = useProjectStore.getState();
    if (!syncManager) {
      return {
        status: "error",
        error: "Sync manager not initialized. Open a project to use history.",
      };
    }

    const stepsRequested = input.steps ?? 1;
    let message: string | null = null;

    if (input.action === "undo") {
      if (!syncManager.canUndo()) {
        message = "Nothing to undo.";
      } else {
        for (let i = 0; i < stepsRequested; i++) {
          undo();
        }
        message = `Undid ${stepsRequested} ${stepsRequested === 1 ? "step" : "steps"}.`;
      }
    } else if (input.action === "redo") {
      if (!syncManager.canRedo()) {
        message = "Nothing to redo.";
      } else {
        for (let i = 0; i < stepsRequested; i++) {
          redo();
        }
        message = `Redid ${stepsRequested} ${stepsRequested === 1 ? "step" : "steps"}.`;
      }
    } else {
      message = "History status retrieved.";
    }

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
            text: `Can undo: ${syncManager.canUndo() ? "yes" : "no"}`,
          },
          {
            type: "text",
            text: `Can redo: ${syncManager.canRedo() ? "yes" : "no"}`,
          },
          {
            type: "text",
            text: `Action: ${input.action}`,
          },
          {
            type: "text",
            text: `Steps requested: ${stepsRequested}`,
          },
        ],
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
