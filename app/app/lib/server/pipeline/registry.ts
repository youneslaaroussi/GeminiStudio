import type { PipelineStepDefinition } from "./types";
import { metadataStep } from "./steps/metadata";
import { uploadStep } from "./steps/upload";
import { transcriptionStep } from "./steps/transcription";
import { faceDetectionStep } from "./steps/face-detection";
import { shotDetectionStep } from "./steps/shot-detection";
import { labelDetectionStep } from "./steps/label-detection";
import { personDetectionStep } from "./steps/person-detection";

const registry: PipelineStepDefinition[] = [
  metadataStep,
  uploadStep,
  shotDetectionStep,
  labelDetectionStep,
  personDetectionStep,
  transcriptionStep,
  faceDetectionStep,
];

export function getPipelineSteps() {
  return registry;
}

export function findPipelineStep(stepId: string) {
  return registry.find((step) => step.id === stepId);
}
