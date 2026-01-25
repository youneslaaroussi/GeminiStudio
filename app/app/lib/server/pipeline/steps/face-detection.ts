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
        return {
          faceIndex: index,
          trackCount: tracks.length,
          attributes,
          segments: tracks.map((track: any) => ({
            start: track.segment?.startTimeOffset?.seconds ?? 0,
            end: track.segment?.endTimeOffset?.seconds ?? 0,
          })),
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
