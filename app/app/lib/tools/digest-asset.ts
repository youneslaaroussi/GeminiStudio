import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { loadAssetsSnapshot, toAbsoluteAssetUrl } from "./asset-utils";

const digestAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  query: z.string().optional(),
  depth: z.enum(["quick", "detailed", "exhaustive"]).default("detailed"),
});

export const digestAssetTool: ToolDefinition<typeof digestAssetSchema, Project> = {
  name: "digestAsset",
  label: "Digest Asset",
  description:
    "Analyze an asset (video, image, or audio) using Gemini's multimodal capabilities. Returns a detailed description of the content.",
  runLocation: "client",
  inputSchema: digestAssetSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "e.g. asset_abc123",
      description: "The ID of the asset to analyze.",
      required: true,
    },
    {
      name: "query",
      label: "Question (optional)",
      type: "textarea",
      placeholder: "What specific aspects would you like to know about?",
      description: "Optional: Ask a specific question about the asset instead of getting a general analysis.",
    },
    {
      name: "depth",
      label: "Analysis Depth",
      type: "select",
      options: [
        { value: "quick", label: "Quick (2-3 sentences)" },
        { value: "detailed", label: "Detailed (comprehensive analysis)" },
        { value: "exhaustive", label: "Exhaustive (scene-by-scene, every detail)" },
      ],
      defaultValue: "detailed",
      description: "How thorough should the analysis be?",
    },
  ],
  async run(input) {
    try {
      // This tool requires browser context to fetch assets
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Digest tool must be run from the client side.",
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
          error: `Asset type "${asset.type}" is not supported for analysis. Supported types: video, audio, image.`,
        };
      }

      // Get the asset URL - prefer signed URL or GCS URI for Gemini access
      let assetUrl = asset.signedUrl ?? asset.gcsUri ?? asset.url;
      
      // If it's a relative URL, make it absolute
      if (!assetUrl.startsWith("http") && !assetUrl.startsWith("gs://")) {
        assetUrl = toAbsoluteAssetUrl(asset.url);
      }

      // Call the digest API
      const response = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetUrl,
          mimeType: asset.mimeType,
          assetName: asset.name,
          query: input.query?.trim() || undefined,
          depth: input.depth,
        }),
      });

      const data = (await response.json()) as {
        analysis?: string;
        category?: string;
        depth?: string;
        usage?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
        error?: string;
      };

      if (!response.ok || !data.analysis) {
        return {
          status: "error" as const,
          error: data.error || "Failed to analyze asset",
        };
      }

      // Build response
      const outputs = [
        {
          type: "text" as const,
          text: `**Analysis of "${asset.name}"** (${asset.type}, ${input.depth} depth)\n\n${data.analysis}`,
        },
      ];

      // Add usage metadata if available
      if (data.usage?.totalTokenCount) {
        outputs.push({
          type: "text" as const,
          text: `\n---\n_Tokens used: ${data.usage.totalTokenCount.toLocaleString()}_`,
        });
      }

      return {
        status: "success" as const,
        outputs,
        meta: {
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          category: data.category,
          depth: data.depth,
          tokensUsed: data.usage?.totalTokenCount,
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
