import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { getVideoEffectDefinition } from "@/app/lib/video-effects/definitions";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { useProjectStore } from "@/app/lib/store/project-store";

const applyVideoEffectSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  effectId: z
    .string()
    .min(1)
    .default("replicate.meta.sam2-video")
    .describe("Effect to apply; default is segmentation (SAM-2)"),
  clickCoordinates: z
    .string()
    .describe(
      "Tracking points as [x,y] pairs, e.g. '[391,239],[178,320]'. Digest the clip first to choose coordinates."
    ),
  clickFrames: z
    .string()
    .default("1")
    .describe("Comma-separated frame numbers where clicks apply, e.g. '1,15,30'"),
  clickObjectIds: z.string().optional().default(""),
  maskType: z.enum(["binary", "highlighted"]).default("binary"),
  videoFps: z.number().int().min(1).max(60).default(25),
  outputVideo: z.boolean().default(true),
});

export const applyVideoEffectToClipTool: ToolDefinition<
  typeof applyVideoEffectSchema,
  Project
> = {
  name: "applyVideoEffectToClip",
  label: "Apply Video Effect to Clip",
  description:
    "Apply a video effect (e.g. segmentation) to a clip/asset. Before using: digest the clip (digestAsset or getAssetMetadata) to understand the video content and choose where to place tracking points (click coordinates and frames) for the segmentation effect.",
  runLocation: "client",
  inputSchema: applyVideoEffectSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "e.g. asset_abc123",
      required: true,
      description: "The asset (clip) to apply the effect to.",
    },
    {
      name: "effectId",
      label: "Effect",
      type: "text",
      placeholder: "replicate.meta.sam2-video",
      defaultValue: "replicate.meta.sam2-video",
      description: "Effect ID; default is segmentation (SAM-2).",
    },
    {
      name: "clickCoordinates",
      label: "Click Coordinates",
      type: "textarea",
      placeholder: "[391,239],[178,320]",
      required: true,
      description:
        "Tracking points as [x,y] pairs. Digest the clip first to choose where to click.",
    },
    {
      name: "clickFrames",
      label: "Click Frames",
      type: "text",
      placeholder: "1,15,30",
      defaultValue: "1",
      description: "Frame numbers where clicks apply (comma-separated).",
    },
    {
      name: "clickObjectIds",
      label: "Click Object IDs (optional)",
      type: "text",
      placeholder: "bee_1,bee_2",
    },
    {
      name: "maskType",
      label: "Mask Type",
      type: "select",
      options: [
        { value: "binary", label: "Binary mask" },
        { value: "highlighted", label: "Highlight objects" },
      ],
      defaultValue: "binary",
    },
    {
      name: "videoFps",
      label: "Output FPS",
      type: "number",
      defaultValue: "25",
      description: "Frames per second for output (1–60).",
    },
    {
      name: "outputVideo",
      label: "Return Video",
      type: "select",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
      defaultValue: "true",
    },
  ],
  async run(input) {
    const effect = getVideoEffectDefinition(input.effectId);
    if (!effect) {
      return {
        status: "error",
        error: `Unknown video effect "${input.effectId}".`,
      };
    }

    const projectId = useProjectStore.getState().projectId;
    if (!projectId) {
      return {
        status: "error",
        error: "No project loaded. Open a project first.",
      };
    }

    const params: Record<string, unknown> = {
      maskType: input.maskType,
      videoFps: input.videoFps,
      clickFrames: input.clickFrames || "1",
      clickObjectIds: input.clickObjectIds ?? "",
      clickCoordinates: input.clickCoordinates,
      outputVideo: input.outputVideo,
    };

    const authHeaders = await getAuthHeaders();
    const response = await fetch("/api/video-effects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeaders as Record<string, string>),
      },
      body: JSON.stringify({
        assetId: input.assetId.trim(),
        effectId: input.effectId,
        projectId,
        params,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      const message =
        payload?.error ?? `Failed to start video effect (${response.status})`;
      return { status: "error", error: message };
    }

    const payload = (await response.json()) as { job: VideoEffectJob };
    const job = payload.job;

    return {
      status: "success",
      outputs: [
        {
          type: "text",
          text: `Started "${effect.label}" for asset ${job?.assetName ?? input.assetId}. Use videoEffectsJobStatus with jobId to check completion.`,
        },
        { type: "json", data: job },
      ],
    };
  },
};
