import { z } from "zod";
import type { ToolDefinition, ToolFieldDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const METADATA_TYPES = [
  "face-detection",
  "shot-detection",
  "label-detection",
  "person-detection",
  "transcription",
  "metadata",
] as const;

const getAssetMetadataSchema = z.object({
  assetId: z.string().min(1),
  metadataType: z.enum(METADATA_TYPES).optional(),
});

type GetAssetMetadataInput = z.infer<typeof getAssetMetadataSchema>;

interface PipelineStepState {
  id: string;
  label: string;
  status: string;
  metadata: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  updatedAt: string;
}

interface PipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}

function formatStepSummary(stepId: string, metadata: Record<string, unknown>): string {
  switch (stepId) {
    case "face-detection": {
      const faceCount = (metadata.faceCount as number) ?? 0;
      return `${faceCount} face${faceCount !== 1 ? "s" : ""} detected`;
    }
    case "shot-detection": {
      const shotCount = (metadata.shotCount as number) ?? 0;
      return `${shotCount} shot${shotCount !== 1 ? "s" : ""} detected`;
    }
    case "label-detection": {
      const segmentCount = (metadata.segmentLabelCount as number) ?? 0;
      const shotCount = (metadata.shotLabelCount as number) ?? 0;
      const frameCount = (metadata.frameLabelCount as number) ?? 0;
      return `${segmentCount} segment labels, ${shotCount} shot labels, ${frameCount} frame labels`;
    }
    case "person-detection": {
      const personCount = (metadata.personCount as number) ?? 0;
      return `${personCount} person${personCount !== 1 ? "s" : ""} detected`;
    }
    case "transcription": {
      const transcript = (metadata.transcript as string) ?? "";
      const wordCount = transcript ? transcript.split(/\s+/).length : 0;
      return `${wordCount} words transcribed`;
    }
    case "metadata": {
      const duration = metadata.duration as number | undefined;
      const width = metadata.width as number | undefined;
      const height = metadata.height as number | undefined;
      const codec = metadata.videoCodec as string | undefined;
      const parts: string[] = [];
      if (duration) parts.push(`${duration.toFixed(1)}s`);
      if (width && height) parts.push(`${width}x${height}`);
      if (codec) parts.push(codec);
      return parts.length > 0 ? parts.join(", ") : "Basic metadata extracted";
    }
    default:
      return "Data available";
  }
}

const fields: ToolFieldDefinition[] = [
  {
    name: "assetId",
    label: "Asset ID",
    type: "text",
    placeholder: "e.g. asset_123",
    required: true,
  },
  {
    name: "metadataType",
    label: "Metadata Type (optional)",
    type: "select",
    description:
      "Filter to a specific type of metadata. Leave empty for all available metadata.",
    options: [
      { value: "", label: "All metadata" },
      { value: "face-detection", label: "Face Detection" },
      { value: "shot-detection", label: "Shot Detection" },
      { value: "label-detection", label: "Label Detection" },
      { value: "person-detection", label: "Person Detection" },
      { value: "transcription", label: "Transcription" },
      { value: "metadata", label: "File Metadata" },
    ],
  },
];

export const getAssetMetadataTool: ToolDefinition<
  typeof getAssetMetadataSchema,
  Project
> = {
  name: "getAssetMetadata",
  label: "Get Asset Metadata",
  description:
    "Get detailed metadata for an asset including face detection, shot detection, labels, transcription, and more.",
  runLocation: "client",
  inputSchema: getAssetMetadataSchema,
  fields,
  async run(input: GetAssetMetadataInput) {
    const { assetId, metadataType } = input;

    // Verify asset exists
    const asset = useAssetsStore.getState().getAssetById(assetId);
    if (!asset) {
      return {
        status: "error",
        error: `Asset '${assetId}' not found in the current project.`,
      };
    }

    // Get project ID
    const projectId = useProjectStore.getState().projectId;
    if (!projectId) {
      return {
        status: "error",
        error: "No project loaded.",
      };
    }

    // Fetch pipeline state from API
    let pipelineState: PipelineState;
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        `/api/assets/${assetId}/pipeline?projectId=${encodeURIComponent(projectId)}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );

      if (response.status === 404) {
        return {
          status: "success",
          outputs: [
            {
              type: "text",
              text: `No metadata available for asset '${asset.name}'. Pipeline may not have run yet.`,
            },
          ],
        };
      }

      if (!response.ok) {
        const text = await response.text();
        return {
          status: "error",
          error: `Failed to fetch metadata: ${response.status} - ${text}`,
        };
      }

      pipelineState = await response.json();
    } catch (error) {
      return {
        status: "error",
        error: `Failed to fetch metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }

    // Extract and format metadata
    const steps = pipelineState.steps ?? [];
    const metadataResults: Record<
      string,
      { label: string; status: string; data: Record<string, unknown> }
    > = {};
    const summaryItems: { type: "text"; text: string }[] = [];

    for (const step of steps) {
      const stepId = step.id ?? "";
      const stepLabel = step.label ?? stepId;
      const stepStatus = step.status ?? "unknown";
      const stepMetadata = step.metadata ?? {};

      // Filter by type if specified
      if (metadataType && stepId !== metadataType) {
        continue;
      }

      if (stepStatus === "succeeded" && Object.keys(stepMetadata).length > 0) {
        metadataResults[stepId] = {
          label: stepLabel,
          status: stepStatus,
          data: stepMetadata,
        };

        const summary = formatStepSummary(stepId, stepMetadata);
        summaryItems.push({ type: "text", text: `**${stepLabel}**: ${summary}` });
      } else if (stepStatus === "running") {
        summaryItems.push({ type: "text", text: `**${stepLabel}**: Processing...` });
      } else if (stepStatus === "failed") {
        const error = step.error ?? "Unknown error";
        summaryItems.push({ type: "text", text: `**${stepLabel}**: Failed - ${error}` });
      }
    }

    if (Object.keys(metadataResults).length === 0 && summaryItems.length === 0) {
      return {
        status: "success",
        outputs: [
          {
            type: "text",
            text: `No metadata available for asset '${asset.name}'. Pipeline may not have run yet.`,
          },
        ],
      };
    }

    if (summaryItems.length === 0) {
      summaryItems.push({ type: "text", text: "No completed analysis available." });
    }

    return {
      status: "success",
      outputs: [
        {
          type: "list",
          title: `Metadata for '${asset.name}'`,
          items: summaryItems,
        },
        {
          type: "json",
          data: {
            assetId,
            assetName: asset.name,
            metadata: metadataResults,
          },
        },
      ],
    };
  },
};
