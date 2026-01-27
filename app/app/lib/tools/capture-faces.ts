import { z } from "zod";
import { useToolboxStore } from "@/app/lib/store/toolbox-store";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import {
  loadAssetsSnapshot,
  captureVideoFrameWithBoxes,
  type FaceBoxOverlay,
} from "./asset-utils";

const captureFacesSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  faceIndex: z.number().min(0).optional(),
  notes: z.string().optional(),
});

interface FaceData {
  faceIndex: number;
  firstAppearance?: {
    time: number;
    boundingBox: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  } | null;
  timestampedBoxes?: Array<{
    time: number;
    boundingBox: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  }>;
}

interface PipelineStep {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export const captureFacesTool: ToolDefinition<typeof captureFacesSchema, Project> =
  {
    name: "captureFaces",
    label: "Capture Faces",
    description:
      "Capture frames from a video at face detection timestamps with bounding boxes drawn around detected faces.",
    runLocation: "client",
    inputSchema: captureFacesSchema,
    fields: [
      {
        name: "assetId",
        label: "Asset ID",
        type: "text",
        placeholder: "e.g. asset_123",
        required: true,
      },
      {
        name: "faceIndex",
        label: "Face Index (optional)",
        type: "number",
        placeholder: "Leave empty for all faces",
        description: "Capture a specific face by index (0-based). Leave empty to capture all faces.",
      },
      {
        name: "notes",
        label: "Notes",
        type: "textarea",
        placeholder: "Optional context for the captured frames.",
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

      if (matchedAsset.type !== "video") {
        return {
          status: "error",
          error: `Asset "${matchedAsset.name}" is a ${matchedAsset.type} file. Only video assets support face detection capture.`,
        };
      }

      // Fetch pipeline state for this asset
      const pipelineResponse = await fetch(`/api/assets/${matchedAsset.id}/pipeline`);
      if (!pipelineResponse.ok) {
        return {
          status: "error",
          error: "Failed to fetch pipeline state for asset.",
        };
      }

      const { pipeline } = await pipelineResponse.json() as { pipeline: { steps: PipelineStep[] } };
      const faceDetectionStep = pipeline.steps.find((step: PipelineStep) => step.id === "face-detection");

      if (!faceDetectionStep || faceDetectionStep.status !== "succeeded") {
        return {
          status: "error",
          error: "Face detection has not completed for this asset. Please run face detection first.",
        };
      }

      const faces = faceDetectionStep.metadata?.faces as FaceData[] | undefined;
      if (!faces || faces.length === 0) {
        return {
          status: "error",
          error: "No faces were detected in this video.",
        };
      }

      // Filter to specific face if requested
      const facesToCapture = input.faceIndex !== undefined
        ? faces.filter((f) => f.faceIndex === input.faceIndex)
        : faces;

      if (facesToCapture.length === 0) {
        return {
          status: "error",
          error: `Face index ${input.faceIndex} not found. Available indices: 0-${faces.length - 1}`,
        };
      }

      const store = useToolboxStore.getState();
      const outputs: Array<{ type: string; url?: string; alt?: string; width?: number; height?: number; text?: string; data?: unknown }> = [];

      // Capture frame for each face at their first appearance
      for (const face of facesToCapture) {
        if (!face.firstAppearance) {
          outputs.push({
            type: "text",
            text: `Face #${face.faceIndex + 1}: No bounding box data available.`,
          });
          continue;
        }

        const { time, boundingBox } = face.firstAppearance;

        // Build overlays for all faces visible at this timestamp
        const overlaysAtTime: FaceBoxOverlay[] = [];

        // Add the current face
        overlaysAtTime.push({
          faceIndex: face.faceIndex,
          boundingBox,
        });

        // Also add other faces that have bounding boxes at similar timestamps
        for (const otherFace of faces) {
          if (otherFace.faceIndex === face.faceIndex) continue;

          // Find a bounding box for this face near the capture time
          const nearbyBox = otherFace.timestampedBoxes?.find(
            (tb) => Math.abs(tb.time - time) < 0.1 // Within 100ms
          );
          if (nearbyBox) {
            overlaysAtTime.push({
              faceIndex: otherFace.faceIndex,
              boundingBox: nearbyBox.boundingBox,
            });
          }
        }

        try {
          const preview = await captureVideoFrameWithBoxes(
            matchedAsset,
            time,
            overlaysAtTime,
            {
              boxColor: "#00ff00",
              boxLineWidth: 3,
            }
          );

          // Store as captured asset
          const capturedAsset = store.addCapturedAsset({
            name: `${matchedAsset.name} - Face #${face.faceIndex + 1}`,
            assetId: matchedAsset.id,
            assetType: matchedAsset.type,
            assetUrl: matchedAsset.url,
            timecode: time,
            notes: input.notes ?? `Face #${face.faceIndex + 1} at ${time.toFixed(2)}s`,
          });

          outputs.push({
            type: "image",
            url: preview.url,
            alt: `Face #${face.faceIndex + 1} at ${time.toFixed(2)}s`,
            width: preview.width,
            height: preview.height,
          });

          outputs.push({
            type: "text",
            text: `Captured Face #${face.faceIndex + 1} at ${time.toFixed(2)}s with ${overlaysAtTime.length} bounding box(es).`,
          });

          outputs.push({
            type: "json",
            data: capturedAsset,
          });
        } catch (error) {
          outputs.push({
            type: "text",
            text: `Face #${face.faceIndex + 1}: Failed to capture - ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }

      return {
        status: "success",
        outputs,
      };
    },
  };
