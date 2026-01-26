import { z } from "zod";
import { useToolboxStore } from "@/app/lib/store/toolbox-store";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import {
  loadAssetsSnapshot,
  buildAssetPreview,
} from "./asset-utils";

const captureAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  timecode: z.number().min(0, "Time must be positive"),
  notes: z.string().optional(),
});

export const captureAssetTool: ToolDefinition<typeof captureAssetSchema, Project> =
  {
    name: "captureAsset",
    label: "Capture Asset",
    description:
      "Bookmark a timeline moment for an uploaded asset using its asset ID and capture an exact still.",
    runLocation: "client",
    inputSchema: captureAssetSchema,
    fields: [
      {
        name: "assetId",
        label: "Asset ID",
        type: "text",
        placeholder: "e.g. asset_123",
        required: true,
      },
      {
        name: "timecode",
        label: "Time (seconds)",
        type: "number",
        placeholder: "12.4",
        description: "Exact timeline position in seconds.",
        required: true,
      },
      {
        name: "notes",
        label: "Notes",
        type: "textarea",
        placeholder: "Optional context for the captured asset.",
      },
    ],
    async run(input) {
      const assets = await loadAssetsSnapshot();
      const matchedAsset = assets.find(
        (asset) => asset.id === input.assetId.trim()
      );

      if (!matchedAsset) {
        return {
          status: "error",
          error: `Asset ID "${input.assetId}" not found in the current project.`,
        };
      }

      if (matchedAsset.type !== "video" && matchedAsset.type !== "image") {
        return {
          status: "error",
          error: `Asset "${matchedAsset.name}" is a ${matchedAsset.type} file. Only video or image assets can be captured.`,
        };
      }

      const preview = await buildAssetPreview(matchedAsset, input.timecode);

      const store = useToolboxStore.getState();
      const asset = store.addCapturedAsset({
        name: matchedAsset.name,
        assetId: matchedAsset.id,
        assetType: matchedAsset.type,
        assetUrl: matchedAsset.url,
        timecode: input.timecode,
        notes: input.notes,
      });
      return {
        status: "success",
        outputs: [
          {
            type: "image",
            url: preview.url,
            alt: `Captured ${matchedAsset.name} at ${input.timecode.toFixed(2)}s`,
            width: preview.width,
            height: preview.height,
          },
          {
            type: "text",
            text: `Captured asset "${asset.name}" (${asset.assetType}) at ${asset.timecode.toFixed(
              2
            )}s.`,
          },
          {
            type: "json",
            data: asset,
          },
        ],
      };
    },
  };
