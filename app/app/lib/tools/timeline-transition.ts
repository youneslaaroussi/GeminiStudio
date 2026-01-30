import { z } from "zod";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { Project, TransitionType, ClipTransition } from "@/app/types/timeline";
import { getClipEnd, makeTransitionKey } from "@/app/types/timeline";
import type { ToolDefinition, ToolOutput } from "./types";

const TRANSITION_TYPES: TransitionType[] = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
];

const addTransitionSchema = z.object({
  fromClipId: z.string().min(1, "From clip ID is required"),
  toClipId: z.string().min(1, "To clip ID is required"),
  type: z
    .enum(["fade", "slide-left", "slide-right", "slide-up", "slide-down"])
    .default("fade")
    .describe("Transition effect type"),
  duration: z
    .number()
    .positive("Duration must be positive")
    .max(5, "Duration must be 5 seconds or less")
    .default(0.5)
    .describe("Transition duration in seconds"),
});

type AddTransitionInput = z.infer<typeof addTransitionSchema>;

const removeTransitionSchema = z.object({
  fromClipId: z.string().min(1, "From clip ID is required"),
  toClipId: z.string().min(1, "To clip ID is required"),
});

type RemoveTransitionInput = z.infer<typeof removeTransitionSchema>;

export const timelineAddTransitionTool: ToolDefinition<
  typeof addTransitionSchema,
  Project
> = {
  name: "timelineAddTransition",
  label: "Add Timeline Transition",
  description:
    "Add a transition effect between two adjacent video clips on the same layer. Supports fade and slide transitions.",
  runLocation: "client",
  inputSchema: addTransitionSchema,
  fields: [
    {
      name: "fromClipId",
      label: "From Clip ID",
      type: "text",
      placeholder: "ID of the first (left) clip",
      required: true,
    },
    {
      name: "toClipId",
      label: "To Clip ID",
      type: "text",
      placeholder: "ID of the second (right) clip",
      required: true,
    },
    {
      name: "type",
      label: "Transition Type",
      type: "select",
      options: TRANSITION_TYPES.map((t) => ({
        value: t,
        label: t.charAt(0).toUpperCase() + t.slice(1).replace("-", " "),
      })),
      defaultValue: "fade",
      description: "The transition effect to apply between clips.",
    },
    {
      name: "duration",
      label: "Duration (seconds)",
      type: "number",
      placeholder: "0.5",
      description: "How long the transition lasts (0.1 to 5 seconds).",
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
    const { project } = store;

    // Find both clips
    const fromClip = store.getClipById(input.fromClipId);
    const toClip = store.getClipById(input.toClipId);

    if (!fromClip) {
      return {
        status: "error",
        error: `Clip "${input.fromClipId}" was not found.`,
      };
    }

    if (!toClip) {
      return {
        status: "error",
        error: `Clip "${input.toClipId}" was not found.`,
      };
    }

    // Transitions only work for video clips currently
    if (fromClip.type !== "video" || toClip.type !== "video") {
      return {
        status: "error",
        error: "Transitions are only supported between video clips.",
      };
    }

    // Find the layers containing these clips
    let fromLayerId: string | null = null;
    let toLayerId: string | null = null;

    for (const layer of project.layers) {
      if (layer.clips.some((c) => c.id === input.fromClipId)) {
        fromLayerId = layer.id;
      }
      if (layer.clips.some((c) => c.id === input.toClipId)) {
        toLayerId = layer.id;
      }
    }

    if (fromLayerId !== toLayerId) {
      return {
        status: "error",
        error: "Both clips must be on the same layer for a transition.",
      };
    }

    // Check if clips are adjacent (touching)
    const fromEnd = getClipEnd(fromClip);
    const toStart = toClip.start;
    const gap = Math.abs(toStart - fromEnd);

    // Allow a small tolerance for floating point comparison
    if (gap > 0.01) {
      return {
        status: "error",
        error: `Clips are not adjacent. There is a ${gap.toFixed(2)}s gap between them. Transitions require clips to be touching.`,
      };
    }

    // Ensure fromClip comes before toClip
    if (fromEnd > toStart + 0.01) {
      return {
        status: "error",
        error: `The "from" clip must end where the "to" clip begins. Currently "${fromClip.name}" ends at ${fromEnd.toFixed(2)}s but "${toClip.name}" starts at ${toStart.toFixed(2)}s.`,
      };
    }

    const transition: ClipTransition = {
      type: input.type ?? "fade",
      duration: input.duration ?? 0.5,
    };

    // Add the transition
    store.addTransition(input.fromClipId, input.toClipId, transition);

    const transitionKey = makeTransitionKey(input.fromClipId, input.toClipId);

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Added ${transition.type} transition (${transition.duration}s) between "${fromClip.name}" and "${toClip.name}".`,
      },
      {
        type: "json",
        data: {
          transitionKey,
          fromClip: {
            id: fromClip.id,
            name: fromClip.name,
            end: fromEnd,
          },
          toClip: {
            id: toClip.id,
            name: toClip.name,
            start: toStart,
          },
          transition,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};

export const timelineRemoveTransitionTool: ToolDefinition<
  typeof removeTransitionSchema,
  Project
> = {
  name: "timelineRemoveTransition",
  label: "Remove Timeline Transition",
  description: "Remove an existing transition between two clips.",
  runLocation: "client",
  inputSchema: removeTransitionSchema,
  fields: [
    {
      name: "fromClipId",
      label: "From Clip ID",
      type: "text",
      placeholder: "ID of the first (left) clip",
      required: true,
    },
    {
      name: "toClipId",
      label: "To Clip ID",
      type: "text",
      placeholder: "ID of the second (right) clip",
      required: true,
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
    const { project } = store;

    const transitionKey = makeTransitionKey(input.fromClipId, input.toClipId);
    const existingTransition = project.transitions?.[transitionKey];

    if (!existingTransition) {
      return {
        status: "error",
        error: `No transition found between clips "${input.fromClipId}" and "${input.toClipId}".`,
      };
    }

    // Get clip names for the response
    const fromClip = store.getClipById(input.fromClipId);
    const toClip = store.getClipById(input.toClipId);

    store.removeTransition(input.fromClipId, input.toClipId);

    const outputs: ToolOutput[] = [
      {
        type: "text",
        text: `Removed ${existingTransition.type} transition between "${fromClip?.name ?? input.fromClipId}" and "${toClip?.name ?? input.toClipId}".`,
      },
      {
        type: "json",
        data: {
          transitionKey,
          removedTransition: existingTransition,
        },
      },
    ];

    return {
      status: "success",
      outputs,
    };
  },
};
