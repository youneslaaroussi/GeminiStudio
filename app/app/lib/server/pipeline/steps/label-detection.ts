import type { PipelineStepDefinition } from "../types";
import { VideoIntelligenceServiceClient } from "@google-cloud/video-intelligence";
import { parseGoogleServiceAccount } from "@/app/lib/server/google-cloud";
import { getPipelineStateForAsset } from "../store";

function timeOffsetToSeconds(offset?: { seconds?: number | { low: number } | null; nanos?: number | null }) {
  const rawSeconds = offset?.seconds;
  const seconds = rawSeconds && typeof rawSeconds === "object" ? rawSeconds.low : Number(rawSeconds ?? 0);
  const nanos = Number(offset?.nanos ?? 0);
  return seconds + nanos / 1_000_000_000;
}

interface LabelSegment {
  start: number;
  end: number;
  confidence: number;
}

interface LabelEntity {
  entityId: string;
  description: string;
  languageCode: string;
}

interface DetectedLabel {
  entity: LabelEntity;
  categories: LabelEntity[];
  segments: LabelSegment[];
  confidence: number;
}

export const labelDetectionStep: PipelineStepDefinition = {
  id: "label-detection",
  label: "Detect labels",
  description: "Identifies objects, locations, activities, and more using the Video Intelligence API.",
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
      throw new Error("Cloud upload step must complete before label detection");
    }

    const request = {
      inputUri: gcsUri,
      features: ["LABEL_DETECTION"],
      videoContext: {
        labelDetectionConfig: {
          labelDetectionMode: "SHOT_AND_FRAME_MODE",
          frameConfidenceThreshold: 0.5,
          videoConfidenceThreshold: 0.5,
        },
      },
    };

    const [operation] = await videoClient.annotateVideo(request as any);
    const [result] = await operation.promise();
    const annotations = result.annotationResults?.[0];

    // Process segment-level labels (whole video)
    const segmentLabels: DetectedLabel[] = (annotations?.segmentLabelAnnotations ?? []).map((label: any) => ({
      entity: {
        entityId: label.entity?.entityId ?? "",
        description: label.entity?.description ?? "",
        languageCode: label.entity?.languageCode ?? "en",
      },
      categories: (label.categoryEntities ?? []).map((cat: any) => ({
        entityId: cat.entityId ?? "",
        description: cat.description ?? "",
        languageCode: cat.languageCode ?? "en",
      })),
      segments: (label.segments ?? []).map((seg: any) => ({
        start: timeOffsetToSeconds(seg.segment?.startTimeOffset),
        end: timeOffsetToSeconds(seg.segment?.endTimeOffset),
        confidence: Number(seg.confidence ?? 0),
      })),
      confidence: Math.max(...(label.segments ?? []).map((seg: any) => Number(seg.confidence ?? 0)), 0),
    }));

    // Process shot-level labels
    const shotLabels: DetectedLabel[] = (annotations?.shotLabelAnnotations ?? []).map((label: any) => ({
      entity: {
        entityId: label.entity?.entityId ?? "",
        description: label.entity?.description ?? "",
        languageCode: label.entity?.languageCode ?? "en",
      },
      categories: (label.categoryEntities ?? []).map((cat: any) => ({
        entityId: cat.entityId ?? "",
        description: cat.description ?? "",
        languageCode: cat.languageCode ?? "en",
      })),
      segments: (label.segments ?? []).map((seg: any) => ({
        start: timeOffsetToSeconds(seg.segment?.startTimeOffset),
        end: timeOffsetToSeconds(seg.segment?.endTimeOffset),
        confidence: Number(seg.confidence ?? 0),
      })),
      confidence: Math.max(...(label.segments ?? []).map((seg: any) => Number(seg.confidence ?? 0)), 0),
    }));

    // Process frame-level labels (sampled at 1 fps)
    const frameLabelMap = new Map<string, { entity: LabelEntity; frames: Array<{ time: number; confidence: number }> }>();
    for (const label of annotations?.frameLabelAnnotations ?? []) {
      const entity: LabelEntity = {
        entityId: (label as any).entity?.entityId ?? "",
        description: (label as any).entity?.description ?? "",
        languageCode: (label as any).entity?.languageCode ?? "en",
      };
      const frames = ((label as any).frames ?? []).map((frame: any) => ({
        time: timeOffsetToSeconds(frame.timeOffset),
        confidence: Number(frame.confidence ?? 0),
      }));
      frameLabelMap.set(entity.description, { entity, frames });
    }
    const frameLabels = Array.from(frameLabelMap.values());

    // Sort by confidence
    segmentLabels.sort((a, b) => b.confidence - a.confidence);
    shotLabels.sort((a, b) => b.confidence - a.confidence);

    return {
      status: "succeeded" as const,
      metadata: {
        segmentLabelCount: segmentLabels.length,
        shotLabelCount: shotLabels.length,
        frameLabelCount: frameLabels.length,
        segmentLabels: segmentLabels.slice(0, 50), // Limit to top 50
        shotLabels: shotLabels.slice(0, 50),
        frameLabels: frameLabels.slice(0, 30),
        gcsUri,
      },
    };
  },
};
