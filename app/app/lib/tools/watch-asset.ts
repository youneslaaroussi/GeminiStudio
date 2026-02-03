/**
 * Watch Asset Tool
 *
 * Prepares an asset (video, image, or audio) for multimodal analysis by the agent.
 * Unlike digestAsset which analyzes in isolation, this tool returns the media
 * directly to the agent so it can analyze with full conversation context.
 *
 * Use this when the agent needs to see the actual media content to answer questions
 * that require understanding prior context (e.g. "does this video match the style
 * we discussed earlier?").
 */

import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { loadAssetsSnapshot, toAbsoluteAssetUrl } from "./asset-utils";

const watchAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  startTime: z.string().optional().describe("Start time in seconds (e.g. '2.5' or '10') to view a specific segment"),
  endTime: z.string().optional().describe("End time in seconds (e.g. '5.0' or '15') to view a specific segment"),
});

export const watchAssetTool: ToolDefinition<typeof watchAssetSchema, Project> = {
  name: "watchAsset",
  label: "Watch Asset",
  description:
    "Load an asset (video, image, or audio) so you can see/hear it directly. " +
    "Use startTime/endTime (in seconds) to focus on a specific segment of video. " +
    "Use this when you need to analyze media with conversation context, compare to discussed styles, " +
    "answer follow-up questions, or when the user wants you to 'look at' or 'watch' something.",
  runLocation: "client",
  inputSchema: watchAssetSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "e.g. asset_abc123",
      description: "The ID of the asset to watch/view.",
      required: true,
    },
    {
      name: "startTime",
      label: "Start Time",
      type: "text",
      placeholder: "e.g. 2.5",
      description: "Optional start time in seconds for video segment.",
      required: false,
    },
    {
      name: "endTime",
      label: "End Time",
      type: "text",
      placeholder: "e.g. 10",
      description: "Optional end time in seconds for video segment.",
      required: false,
    },
  ],
  async run(input) {
    try {
      // This tool requires browser context to fetch assets
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Watch tool must be run from the client side.",
        };
      }

      // Find the asset
      const assets = await loadAssetsSnapshot();
      const asset = assets.find((a) => a.id === input.assetId);

      if (!asset) {
        return {
          status: "error" as const,
          error: `Asset "${input.assetId}" not found. Use listAssets to see available assets.`,
        };
      }

      // Check if asset type is supported
      const supportedTypes = ["video", "audio", "image"];
      if (!supportedTypes.includes(asset.type)) {
        return {
          status: "error" as const,
          error: `Asset type "${asset.type}" is not supported. Supported types: video, audio, image.`,
        };
      }

      // Get the asset URL - prefer signed URL or GCS URI
      let assetUrl = asset.signedUrl ?? asset.gcsUri ?? asset.url;

      // If it's a relative URL, make it absolute
      if (!assetUrl.startsWith("http") && !assetUrl.startsWith("gs://")) {
        assetUrl = toAbsoluteAssetUrl(asset.url);
      }

      // Upload to Gemini Files API
      const response = await fetch("/api/gemini-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: assetUrl,
          mimeType: asset.mimeType,
          displayName: asset.name,
        }),
      });

      const data = (await response.json()) as {
        fileUri?: string;
        mimeType?: string;
        displayName?: string;
        error?: string;
      };

      if (!response.ok || !data.fileUri) {
        return {
          status: "error" as const,
          error: data.error || "Failed to prepare asset for viewing",
        };
      }

      // Return file info with _injectMedia flag
      // The chat route will inject this as a user message for Gemini to see
      const timeRange = input.startTime || input.endTime
        ? ` (${input.startTime || '0'}s - ${input.endTime || 'end'})`
        : '';
      
      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Asset "${asset.name}" loaded${timeRange}. The media is now visible.`,
          },
        ],
        meta: {
          _injectMedia: true, // Signal to inject media as user message
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          fileUri: data.fileUri,
          mimeType: data.mimeType || asset.mimeType,
          startOffset: input.startTime ? `${input.startTime}s` : undefined,
          endOffset: input.endTime ? `${input.endTime}s` : undefined,
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
