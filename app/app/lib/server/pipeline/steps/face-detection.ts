import type { PipelineStepDefinition } from "../types";
import { VideoIntelligenceServiceClient } from "@google-cloud/video-intelligence";
import { parseGoogleServiceAccount } from "@/app/lib/server/google-cloud";
import { getPipelineStateForAsset } from "../store";


export const faceDetectionStep: PipelineStepDefinition = {
  id: "face-detection",
  label: "Detect faces",
  description: "Analyzes the video for faces using the Video Intelligence API.",
  supportedTypes: ["video"],
  autoStart: true,
  run: async ({ asset }) => {
    const videoClient = new VideoIntelligenceServiceClient({
      credentials: parseGoogleServiceAccount(),
    });

    function summarizeFaceAnnotations(annotations: any[]) {
      return annotations.map((annotation, index) => {
        const tracks = annotation.tracks ?? [];
        const sample = tracks[0];
        const attributes = sample?.timestampedObjects?.[0]?.attributes?.map((attr: any) => attr.name) ?? [];

        // Extract all timestamped objects with bounding boxes
        const allTimestampedObjects: Array<{
          time: number;
          boundingBox: { left: number; top: number; right: number; bottom: number };
        }> = [];

        for (const track of tracks) {
          const timestampedObjects = track.timestampedObjects ?? [];
          for (const obj of timestampedObjects) {
            const box = obj.normalizedBoundingBox;
            if (box) {
              const timeOffset = obj.timeOffset;
              const seconds = Number(timeOffset?.seconds ?? 0);
              const nanos = Number(timeOffset?.nanos ?? 0);
              allTimestampedObjects.push({
                time: seconds + nanos / 1e9,
                boundingBox: {
                  left: Number(box.left ?? 0),
                  top: Number(box.top ?? 0),
                  right: Number(box.right ?? 0),
                  bottom: Number(box.bottom ?? 0),
                },
              });
            }
          }
        }

        // Get the first bounding box as a representative sample
        const firstBox = allTimestampedObjects[0];

        return {
          faceIndex: index,
          trackCount: tracks.length,
          attributes,
          segments: tracks.map((track: any) => ({
            start: Number(track.segment?.startTimeOffset?.seconds ?? 0) + Number(track.segment?.startTimeOffset?.nanos ?? 0) / 1e9,
            end: Number(track.segment?.endTimeOffset?.seconds ?? 0) + Number(track.segment?.endTimeOffset?.nanos ?? 0) / 1e9,
          })),
          // Include bounding box data for frame capture
          timestampedBoxes: allTimestampedObjects,
          firstAppearance: firstBox ? {
            time: firstBox.time,
            boundingBox: firstBox.boundingBox,
          } : null,
        };
      });
    }

    const pipeline = await getPipelineStateForAsset(asset.id);
    const uploadStep = pipeline.steps.find((step) => step.id === "cloud-upload");
    const gcsUri = uploadStep?.metadata?.gcsUri as string | undefined;
    if (!gcsUri) {
      throw new Error("Cloud upload step must complete before face detection");
    }

    const request = {
      inputUri: gcsUri,
      features: ["FACE_DETECTION"] as const,
      videoContext: {
        faceDetectionConfig: {
          includeAttributes: true,
          includeBoundingBoxes: true,
        },
      },
    };

    const [operation] = await videoClient.annotateVideo(request);
    const [result] = await operation.promise();
    const annotations =
      result.annotationResults?.[0]?.faceDetectionAnnotations ?? [];
    const summary = summarizeFaceAnnotations(annotations);

    return {
      status: "succeeded" as const,
      metadata: {
        faceCount: summary.length,
        faces: summary,
        gcsUri,
      },
    };
  },
};
