/**
 * Watch Asset Tool
 *
 * Prepares an asset (video, image, or audio) for multimodal analysis by the agent.
 * This tool returns the media directly to the agent so it can analyze with full conversation context.
 *
 * Use this when the agent needs to see the actual media content to answer questions
 * that require understanding prior context (e.g. "does this video match the style
 * we discussed earlier?").
 */

import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import type { RemoteAsset } from "@/app/types/assets";
import { useProjectStore } from "@/app/lib/store/project-store";
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
  async run(input, context) {
    try {
      // This tool requires browser context to fetch assets
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Watch tool must be run from the client side.",
        };
      }

      const projectId = context?.projectId ?? useProjectStore.getState().projectId;
      if (!projectId) {
        return {
          status: "error" as const,
          error: "Project context is required. Open a project and try again.",
        };
      }

      // Find the asset (from snapshot or by ID)
      const assets = await loadAssetsSnapshot();
      let asset = assets.find((a) => a.id === input.assetId);

      // If not in snapshot, try to fetch single asset by ID for metadata + signed URL
      if (!asset) {
        try {
          const res = await fetch(
            `/api/assets/${encodeURIComponent(input.assetId)}?projectId=${encodeURIComponent(projectId)}`,
            { credentials: "include" }
          );
          if (res.ok) {
            const data = (await res.json()) as { asset?: { id: string; name: string; mimeType: string; type: string; signedUrl?: string; gcsUri?: string; url?: string } };
            if (data.asset) {
              const a = data.asset;
              asset = {
                id: a.id,
                name: a.name,
                mimeType: a.mimeType,
                type: a.type as RemoteAsset["type"],
                signedUrl: a.signedUrl,
                gcsUri: a.gcsUri,
                url: a.signedUrl ?? (a as { url?: string }).url ?? "",
                size: 0,
                uploadedAt: "",
              } satisfies RemoteAsset;
            }
          }
        } catch {
          // Fall through to not-found error
        }
      }

      if (!asset) {
        return {
          status: "error" as const,
          error: `Asset "${input.assetId}" not found. Use listProjectAssets to see available assets.`,
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

      // Resolve URL: prefer signed URL; if not http(s), fetch signed URL on demand
      let assetUrl = asset.signedUrl ?? asset.gcsUri ?? asset.url;
      if (asset.url && !assetUrl.startsWith("http") && !assetUrl.startsWith("gs://")) {
        assetUrl = toAbsoluteAssetUrl(asset.url);
      }
      const hasHttpUrl = assetUrl && (assetUrl.startsWith("http://") || assetUrl.startsWith("https://"));
      if (!hasHttpUrl && projectId) {
        try {
          const playbackRes = await fetch(
            `/api/assets/${encodeURIComponent(input.assetId)}/playback-url?projectId=${encodeURIComponent(projectId)}`,
            { credentials: "include" }
          );
          if (playbackRes.ok) {
            const playbackData = (await playbackRes.json()) as { url?: string };
            if (playbackData?.url?.startsWith("http")) {
              assetUrl = playbackData.url;
            }
          }
        } catch {
          // Keep existing assetUrl; will error below if still not http(s)
        }
      }
      if (!assetUrl || (!assetUrl.startsWith("http://") && !assetUrl.startsWith("https://"))) {
        return {
          status: "error" as const,
          error: "Asset has no accessible URL. The file may still be processing—try again in a moment.",
        };
      }

      // Upload to Gemini Files API (only accepts http/https URLs)
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

      // Return with _injectMedia + fileUri so the model receives the media in the tool result.
      // Our local @ai-sdk/google sends file-url as fileData (video, image, or audio).
      // prepareStep also injects as user message (fallback). downloadUrl is for Live API.
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
          downloadUrl: assetUrl, // For Live API which needs inline data
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
