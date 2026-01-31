import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import type { VeoJob } from "@/app/types/veo";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const veoGenerateSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  prompt: z.string().min(1, "Prompt is required"),
  durationSeconds: z.coerce.number().refine((n) => [4, 6, 8].includes(n), {
    message: "Duration must be 4, 6, or 8 seconds",
  }).default(8),
  aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
  resolution: z.enum(["720p", "1080p", "4k"]).default("720p"),
  generateAudio: z.boolean().default(true),
  negativePrompt: z.string().optional(),
});

export const veoGenerateTool: ToolDefinition<typeof veoGenerateSchema, Project> = {
  name: "veoGenerate",
  label: "Generate Veo Video",
  description:
    "Generate a video using Google Veo 3. Returns a job ID that can be polled for completion.",
  runLocation: "client",
  inputSchema: veoGenerateSchema,
  fields: [
    {
      name: "projectId",
      label: "Project ID",
      type: "text",
      placeholder: "project_abc123...",
      description: "The project to associate this video with.",
      required: true,
    },
    {
      name: "prompt",
      label: "Prompt",
      type: "textarea",
      placeholder: "A cinematic shot of a mountain landscape at sunrise...",
      description: "Describe the video you want to generate in detail.",
      required: true,
    },
    {
      name: "durationSeconds",
      label: "Duration",
      type: "select",
      options: [
        { value: "4", label: "4 seconds" },
        { value: "6", label: "6 seconds" },
        { value: "8", label: "8 seconds" },
      ],
      defaultValue: "8",
      description: "Video duration. Only 8s is available for 1080p and 4K.",
    },
    {
      name: "aspectRatio",
      label: "Aspect Ratio",
      type: "select",
      options: [
        { value: "16:9", label: "16:9 Landscape" },
        { value: "9:16", label: "9:16 Portrait" },
      ],
      defaultValue: "16:9",
    },
    {
      name: "resolution",
      label: "Resolution",
      type: "select",
      options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
        { value: "4k", label: "4K" },
      ],
      defaultValue: "720p",
      description: "Higher resolutions cost more credits and require 8s duration.",
    },
    {
      name: "generateAudio",
      label: "Generate Audio",
      type: "select",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
      defaultValue: "true",
      description: "Whether to generate audio with the video.",
    },
    {
      name: "negativePrompt",
      label: "Negative Prompt",
      type: "text",
      placeholder: "blurry, low quality, text, watermark...",
      description: "Optional: describe what to avoid in the generated video.",
    },
  ],
  async run(input) {
    try {
      // Veo requires browser context for auth
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Veo generation must be run from the client side (requires authentication context).",
        };
      }

      const projectId = input.projectId;

      // Enforce duration constraint for higher resolutions
      let duration = input.durationSeconds as 4 | 6 | 8;
      if (input.resolution !== "720p" && duration !== 8) {
        duration = 8;
      }

      const payload: Record<string, unknown> = {
        prompt: input.prompt.trim(),
        durationSeconds: duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        generateAudio: input.generateAudio,
        projectId,
      };

      if (input.negativePrompt?.trim()) {
        payload.negativePrompt = input.negativePrompt.trim();
      }

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/veo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        job?: VeoJob;
        error?: string;
        required?: number;
      };

      if (response.status === 402) {
        const msg = data.error ?? "Insufficient credits";
        return {
          status: "error" as const,
          error: msg,
          details: data.required != null
            ? { requiredCredits: data.required }
            : undefined,
        };
      }

      if (!response.ok || !data.job) {
        return {
          status: "error" as const,
          error: data.error || "Failed to start video generation",
        };
      }

      const job = data.job;

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Veo video generation started! Job ID: ${job.id}`,
          },
          {
            type: "json" as const,
            data: {
              jobId: job.id,
              status: job.status,
              prompt: job.params.prompt.slice(0, 100) + (job.params.prompt.length > 100 ? "..." : ""),
              resolution: job.params.resolution,
              duration: `${job.params.durationSeconds}s`,
              aspectRatio: job.params.aspectRatio,
            },
          },
        ],
        meta: {
          jobId: job.id,
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

const veoJobStatusSchema = z.object({
  jobId: z.string().min(1, "Job ID is required"),
});

export const veoJobStatusTool: ToolDefinition<typeof veoJobStatusSchema, Project> = {
  name: "veoJobStatus",
  label: "Check Veo Job Status",
  description: "Check the status of a Veo video generation job.",
  runLocation: "client",
  inputSchema: veoJobStatusSchema,
  fields: [
    {
      name: "jobId",
      label: "Job ID",
      type: "text",
      placeholder: "veo_abc123...",
      required: true,
    },
  ],
  async run(input) {
    try {
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Veo job status must be checked from the client side.",
        };
      }

      const response = await fetch(`/api/veo/${encodeURIComponent(input.jobId.trim())}`);

      if (response.status === 404) {
        return {
          status: "error" as const,
          error: `Job ${input.jobId} not found.`,
        };
      }

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        return {
          status: "error" as const,
          error: errorPayload?.error ?? `Failed to fetch job status (${response.status})`,
        };
      }

      const data = (await response.json()) as { job?: VeoJob };
      const job = data.job;

      if (!job) {
        return {
          status: "error" as const,
          error: "Job data missing from response.",
        };
      }

      const statusEmoji = {
        pending: "⏳",
        running: "🔄",
        completed: "✅",
        error: "❌",
      }[job.status] ?? "❓";

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `${statusEmoji} Job ${job.id} is ${job.status}${
              job.status === "completed" && job.resultAssetUrl
                ? ` - Video ready!`
                : job.status === "error" && job.error
                ? ` - ${job.error}`
                : ""
            }`,
          },
          {
            type: "json" as const,
            data: {
              jobId: job.id,
              status: job.status,
              ...(job.resultAssetId && { resultAssetId: job.resultAssetId }),
              ...(job.resultAssetUrl && { resultAssetUrl: job.resultAssetUrl }),
              ...(job.error && { error: job.error }),
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
            },
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
