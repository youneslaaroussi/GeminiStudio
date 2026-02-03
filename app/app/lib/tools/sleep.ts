import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";

const sleepSchema = z.object({
  seconds: z.coerce
    .number()
    .int()
    .min(1, "Seconds must be at least 1")
    .max(25, "Seconds must be 25 or less")
    .default(5),
});

export const sleepTool: ToolDefinition<typeof sleepSchema, Project> = {
  name: "sleep",
  label: "Sleep",
  description: "Wait for a specified number of seconds.",
  runLocation: "server",
  inputSchema: sleepSchema,
  fields: [
    {
      name: "seconds",
      label: "Seconds",
      type: "number",
      placeholder: "5",
      description: "How long to wait (1-25 seconds).",
      required: true,
    },
  ],
  async run(input) {
    try {
      const seconds = input.seconds;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Waited ${seconds} seconds.`,
          },
          {
            type: "json" as const,
            data: { seconds },
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "error" as const,
        error: message,
      };
    }
  },
};
