import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const DURATION_OPTIONS = ["10", "20", "30", "60"] as const;

const generateMusicSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  prompt: z.string().min(5, "Prompt must be at least 5 characters"),
  durationSeconds: z
    .enum(DURATION_OPTIONS)
    .default("30")
    .transform(Number) as unknown as z.ZodNumber,
});

export const generateMusicTool: ToolDefinition<typeof generateMusicSchema, Project> = {
  name: "generateMusic",
  label: "Generate Music (Lyria)",
  description:
    "Generate original music using Google's Lyria AI model. Creates music from a text description including genre, mood, instruments, and tempo.",
  runLocation: "client",
  inputSchema: generateMusicSchema,
  fields: [
    {
      name: "projectId",
      label: "Project ID",
      type: "text",
      placeholder: "project_abc123...",
      description: "The project to associate this music with.",
      required: true,
    },
    {
      name: "prompt",
      label: "Music Description",
      type: "textarea",
      placeholder:
        "Upbeat electronic dance music with synth leads, driving bassline, 128 BPM, energetic festival vibe...",
      description:
        "Describe the music you want: genre, mood, instruments, tempo, style.",
      required: true,
    },
    {
      name: "durationSeconds",
      label: "Duration",
      type: "select",
      options: [
        { value: "10", label: "10 seconds" },
        { value: "20", label: "20 seconds" },
        { value: "30", label: "30 seconds" },
        { value: "60", label: "60 seconds" },
      ],
      defaultValue: "30",
      description: "Length of the generated music.",
    },
  ],
  async run(input) {
    try {
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Music generation must be run from the client side.",
        };
      }

      const payload = {
        prompt: input.prompt.trim(),
        durationSeconds: input.durationSeconds,
        projectId: input.projectId,
      };

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/lyria", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { asset?: { id: string; signedUrl?: string }; error?: string; required?: number };

      if (response.status === 402) {
        return {
          status: "error" as const,
          error: data.error ?? "Insufficient credits",
          details: data.required != null ? { requiredCredits: data.required } : undefined,
        };
      }

      if (!response.ok || !data.asset) {
        return {
          status: "error" as const,
          error: data.error || "Failed to generate music",
        };
      }

      const asset = data.asset;

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Music generated successfully!`,
          },
          {
            type: "json" as const,
            data: {
              assetId: asset.id,
              audioUrl: asset.signedUrl,
              prompt: input.prompt.slice(0, 100) + (input.prompt.length > 100 ? "..." : ""),
            },
          },
        ],
        meta: {
          assetId: asset.id,
          audioUrl: asset.signedUrl,
        },
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
