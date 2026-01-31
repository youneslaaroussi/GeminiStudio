import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import {
  getVideoEffectDefinition,
  videoEffectDefinitions,
} from "@/app/lib/video-effects/definitions";
import type { VideoEffectJob } from "@/app/types/video-effects";

const effectIdValues = videoEffectDefinitions.map((definition) => definition.id) as [
  string,
  ...string[]
];

const runEffectSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  effectId: z.enum(effectIdValues),
  params: z.union([z.record(z.any()), z.string().min(1)]).optional(),
});

export const videoEffectsRunTool: ToolDefinition<typeof runEffectSchema, Project> = {
  name: "videoEffectsRun",
  label: "Start Video Effect",
  description:
    "Kick off a video effect job (for example Replicate SAM-2) for a given asset, using the configured provider.",
  runLocation: "server",
  inputSchema: runEffectSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "asset_123",
      required: true,
    },
    {
      name: "effectId",
      label: "Effect",
      type: "select",
      options: videoEffectDefinitions.map((definition) => ({
        value: definition.id,
        label: definition.label,
      })),
      required: true,
      defaultValue: videoEffectDefinitions[0]?.id,
      description: "Choose which video effect to apply.",
    },
    {
      name: "params",
      label: "Effect Parameters",
      type: "json",
      placeholder: '{"videoFps": 25}',
      description:
        "Optional JSON payload to override effect defaults. Leave empty to use defaults.",
    },
  ],
  async run(input) {
    try {
      const effect = getVideoEffectDefinition(input.effectId);
      if (!effect) {
        return {
          status: "error" as const,
          error: `Unknown video effect "${input.effectId}".`,
        };
      }

      let params: Record<string, unknown> = {};
      if (typeof input.params === "string") {
        try {
          params = JSON.parse(input.params) as Record<string, unknown>;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            status: "error" as const,
            error: `Invalid params JSON: ${message}`,
          };
        }
      } else if (input.params) {
        params = input.params;
      }

      let job: VideoEffectJob;
      // Server-side direct calls are not supported - the service requires userId/projectId
      // which must come from authenticated API requests
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Video effects must be run from the client side (requires authentication context).",
        };
      }

      const response = await fetch("/api/video-effects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectId: input.effectId,
          assetId: input.assetId.trim(),
          params,
        }),
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message =
          errorPayload?.error ??
          `Failed to start video effect (status ${response.status})`;
        return {
          status: "error" as const,
          error: message,
        };
      }

      const payload = (await response.json()) as { job: VideoEffectJob };
      job = payload.job;

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Started "${effect.label}" for asset ${job?.assetName ?? input.assetId}.`,
          },
          {
            type: "json" as const,
            data: job,
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

const listEffectsSchema = z.object({});

export const videoEffectsListTool: ToolDefinition<typeof listEffectsSchema, Project> = {
  name: "videoEffectsList",
  label: "List Video Effects",
  description: "Show the available video effect providers and their default parameters.",
  runLocation: "server",
  inputSchema: listEffectsSchema,
  fields: [],
  async run() {
    const definitions = videoEffectDefinitions;
    return {
      status: "success" as const,
      outputs: [
        {
          type: "list" as const,
          title: `${definitions.length} effect${definitions.length === 1 ? "" : "s"} available`,
          items:
            definitions.length === 0
              ? [
                  {
                    type: "text" as const,
                    text: "No effects configured.",
                  },
                ]
              : definitions.map((definition) => ({
                  type: "text" as const,
                  text: `${definition.label} (${definition.provider})`,
                })),
        },
        {
          type: "json" as const,
          data: definitions.map((definition) => ({
            id: definition.id,
            label: definition.label,
            provider: definition.provider,
            defaultValues: definition.defaultValues,
          })),
        },
      ],
    };
  },
};

const jobStatusSchema = z.object({
  jobId: z.string().min(1, "Job ID is required"),
});

export const videoEffectsJobStatusTool: ToolDefinition<typeof jobStatusSchema, Project> = {
  name: "videoEffectsJobStatus",
  label: "Check Video Effect Job",
  description: "Retrieve the latest status for a video effect job.",
  runLocation: "server",
  inputSchema: jobStatusSchema,
  fields: [
    {
      name: "jobId",
      label: "Job ID",
      type: "text",
      placeholder: "job_123",
      required: true,
    },
  ],
  async run(input) {
    try {
      let job: VideoEffectJob | null = null;
      // Server-side: use the video effects client
      if (typeof window === "undefined") {
        const { getVideoEffectJob } = await import(
          "@/app/lib/server/video-effects-client"
        );
        const fetchedJob = await getVideoEffectJob(input.jobId.trim());
        job = fetchedJob as VideoEffectJob | null;
        if (!job) {
          return {
            status: "error" as const,
            error: `Job ${input.jobId} was not found.`,
          };
        }
      } else {
        // Client-side: use fetch
        const response = await fetch(
          `/api/video-effects/${encodeURIComponent(input.jobId.trim())}`
        );
        if (response.status === 404) {
          return {
            status: "error" as const,
            error: `Job ${input.jobId} was not found.`,
          };
        }
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const message =
            errorPayload?.error ??
            `Failed to fetch job status (status ${response.status})`;
          return {
            status: "error" as const,
            error: message,
          };
        }
        const payload = (await response.json()) as { job?: VideoEffectJob };
        job = payload.job ?? null;
        if (!job) {
          return {
            status: "error" as const,
            error: `Job ${input.jobId} is missing from the response.`,
          };
        }
      }
      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Job ${job.id} is ${job.status}${
              job.status === "completed"
                ? ` (result: ${job.resultAssetUrl ?? "n/a"})`
                : ""
            }.`,
          },
          {
            type: "json" as const,
            data: job,
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
