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

interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Landmark {
  name: string;
  x: number;
  y: number;
  confidence: number;
}

interface Attribute {
  name: string;
  value: string;
  confidence: number;
}

interface TimestampedPerson {
  time: number;
  boundingBox: BoundingBox;
  landmarks: Landmark[];
  attributes: Attribute[];
}

interface PersonTrack {
  personIndex: number;
  startTime: number;
  endTime: number;
  confidence: number;
  timestampedObjects: TimestampedPerson[];
  firstAppearance: TimestampedPerson | null;
}

export const personDetectionStep: PipelineStepDefinition = {
  id: "person-detection",
  label: "Detect people",
  description: "Detects people with body landmarks and attributes using the Video Intelligence API.",
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
      throw new Error("Cloud upload step must complete before person detection");
    }

    const request = {
      inputUri: gcsUri,
      features: ["PERSON_DETECTION"],
      videoContext: {
        personDetectionConfig: {
          includeBoundingBoxes: true,
          includePoseLandmarks: true,
          includeAttributes: true,
        },
      },
    };

    const [operation] = await videoClient.annotateVideo(request as any);
    const [result] = await operation.promise();
    const personAnnotations = result.annotationResults?.[0]?.personDetectionAnnotations ?? [];

    const people: PersonTrack[] = [];
    let personIndex = 0;

    for (const annotation of personAnnotations) {
      const tracks = (annotation as any).tracks ?? [];

      for (const track of tracks) {
        const segment = track.segment;
        const startTime = timeOffsetToSeconds(segment?.startTimeOffset);
        const endTime = timeOffsetToSeconds(segment?.endTimeOffset);
        const confidence = Number(track.confidence ?? 0);

        const timestampedObjects: TimestampedPerson[] = [];

        for (const obj of track.timestampedObjects ?? []) {
          const box = obj.normalizedBoundingBox;
          const time = timeOffsetToSeconds(obj.timeOffset);

          const boundingBox: BoundingBox = {
            left: Number(box?.left ?? 0),
            top: Number(box?.top ?? 0),
            right: Number(box?.right ?? 0),
            bottom: Number(box?.bottom ?? 0),
          };

          const landmarks: Landmark[] = (obj.landmarks ?? []).map((lm: any) => ({
            name: lm.name ?? "",
            x: Number(lm.point?.x ?? 0),
            y: Number(lm.point?.y ?? 0),
            confidence: Number(lm.confidence ?? 0),
          }));

          const attributes: Attribute[] = (obj.attributes ?? []).map((attr: any) => ({
            name: attr.name ?? "",
            value: attr.value ?? "",
            confidence: Number(attr.confidence ?? 0),
          }));

          timestampedObjects.push({
            time,
            boundingBox,
            landmarks,
            attributes,
          });
        }

        people.push({
          personIndex,
          startTime,
          endTime,
          confidence,
          timestampedObjects,
          firstAppearance: timestampedObjects[0] ?? null,
        });

        personIndex++;
      }
    }

    // Sort by start time
    people.sort((a, b) => a.startTime - b.startTime);

    // Collect all unique attributes across all people
    const allAttributes = new Map<string, Set<string>>();
    for (const person of people) {
      for (const obj of person.timestampedObjects) {
        for (const attr of obj.attributes) {
          if (!allAttributes.has(attr.name)) {
            allAttributes.set(attr.name, new Set());
          }
          allAttributes.get(attr.name)!.add(attr.value);
        }
      }
    }

    const attributeSummary = Array.from(allAttributes.entries()).map(([name, values]) => ({
      name,
      values: Array.from(values),
    }));

    return {
      status: "succeeded" as const,
      metadata: {
        personCount: people.length,
        people: people.slice(0, 50), // Limit to 50 tracks
        attributeSummary,
        gcsUri,
      },
    };
  },
};
