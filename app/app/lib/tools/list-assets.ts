import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { loadAssetsSnapshot, formatAssetSummary } from "./asset-utils";

const listAssetsSchema = z.object({});

export const listAssetsTool: ToolDefinition<typeof listAssetsSchema, Project> = {
  name: "listAssets",
  label: "List Assets",
  description:
    "Return the uploaded assets currently available in the Assets panel.",
  runLocation: "client",
  inputSchema: listAssetsSchema,
  fields: [],
  async run() {
    const assets = await loadAssetsSnapshot();
    const metadataMap = useAssetsStore.getState().metadata;
    const enriched = assets.map((asset) => ({
      ...asset,
      metadata: metadataMap[asset.id] ?? null,
    }));
    return {
      status: "success",
      outputs: [
        {
          type: "list",
          title: `${assets.length} assets`,
          items:
            enriched.length > 0
              ? enriched.map((asset) => ({
                  type: "text",
                  text: formatAssetSummary(
                    asset,
                    asset.metadata ?? undefined
                  ),
                }))
              : [
                  {
                    type: "text",
                    text: "No uploaded assets found.",
                  },
                ],
        },
        {
          type: "json",
          data: enriched,
        },
      ],
    };
  },
};
