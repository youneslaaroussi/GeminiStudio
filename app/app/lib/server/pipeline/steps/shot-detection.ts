import type { PipelineStepDefinition } from "../types";
import { VideoIntelligenceServiceClient } from "@google-cloud/video-intelligence";
import { parseGoogleServiceAccount } from "@/app/lib/server/google-cloud";
import { getPipelineStateForAsset } from "../store";

function timeOffsetToSeconds(offset?: { seconds?: number | null; nanos?: number | null }) {
  const seconds = Number(offset?.seconds ?? 0);
  const nanos = Number(offset?.nanos ?? 0);
  return seconds + nanos / 1_000_000_000;
}

export const shotDetectionStep: PipelineStepDefinition = {
  id: "shot-detection",
  label: "Detect shot changes",
  description: "Uses Google Video Intelligence to extract shot boundaries in the uploaded video.",
  supportedTypes: ["video"],
  autoStart: true,
  run: async ({ asset }) => {
    const videoClient = new VideoIntelligenceServiceClient({
      credentials: parseGoogleServiceAccount(),
    });

    const pipeline = await getPipelineStateForAsset(asset.id);
    const uploadStep = pipeline.steps.find((step) => step.id === "cloud-upload");
    const gcsUri = uploadStep?.metadata?.gcsUri as string | undefined;
    if (!gcsUri) {
      throw new Error("Cloud upload step must complete before shot detection");
    }

    const request = {
      inputUri: gcsUri,
      features: ["SHOT_CHANGE_DETECTION"] as const,
    };

    const [operation] = await videoClient.annotateVideo(request);
    const [result] = await operation.promise();
    const shots =
      result.annotationResults?.[0]?.shotAnnotations?.map((shot, index) => {
        const start = timeOffsetToSeconds(shot.startTimeOffset);
        const end = timeOffsetToSeconds(shot.endTimeOffset);
        const duration = Math.max(0, end - start);
        return {
          index,
          start,
          end,
          duration,
        };
      }) ?? [];

    return {
      status: "succeeded" as const,
      metadata: {
        shotCount: shots.length,
        shots,
        gcsUri,
      },
    };
  },
};
