import { z } from "zod";
import type { ToolDefinition, ToolFieldDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const setAssetNotesSchema = z.object({
  assetId: z.string().min(1),
  notes: z.string(),
});

type SetAssetNotesInput = z.infer<typeof setAssetNotesSchema>;

const fields: ToolFieldDefinition[] = [
  {
    name: "assetId",
    label: "Asset ID",
    type: "text",
    placeholder: "e.g. uuid of the asset",
    required: true,
  },
  {
    name: "notes",
    label: "Notes",
    type: "textarea",
    placeholder: "What is this asset for?",
  },
];

export const setAssetNotesTool: ToolDefinition<
  typeof setAssetNotesSchema,
  Project
> = {
  name: "setAssetNotes",
  label: "Set Asset Notes",
  description:
    "Set or update notes on an asset to remember what it is for (e.g. B-roll for intro, voiceover take 2). Use empty notes to clear.",
  runLocation: "client",
  inputSchema: setAssetNotesSchema,
  fields,
  async run(input: SetAssetNotesInput, context) {
    const { assetId, notes } = input;

    const asset = useAssetsStore.getState().getAssetById(assetId);
    if (!asset) {
      return {
        status: "error",
        error: `Asset '${assetId}' not found in the current project.`,
      };
    }

    const projectId = context.projectId ?? useProjectStore.getState().projectId;
    if (!projectId) {
      return {
        status: "error",
        error: "No project loaded.",
      };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const url = new URL(`/api/assets/${assetId}`, window.location.origin);
      url.searchParams.set("projectId", projectId);
      const response = await fetch(url.toString(), {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null }),
      });

      if (response.status === 404) {
        return {
          status: "error",
          error: "Asset not found.",
        };
      }

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        return {
          status: "error",
          error: data.error ?? `Failed to update notes (${response.status})`,
        };
      }

      // Update local store so UI reflects the change immediately
      useAssetsStore.getState().setAssets(
        useAssetsStore.getState().assets.map((a) =>
          a.id === assetId ? { ...a, notes: notes || undefined } : a
        )
      );

      return {
        status: "success",
        outputs: [
          {
            type: "text",
            text: notes
              ? `Notes updated for "${asset.name}".`
              : `Notes cleared for "${asset.name}".`,
          },
        ],
      };
    } catch (error) {
      return {
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to update notes",
      };
    }
  },
};
