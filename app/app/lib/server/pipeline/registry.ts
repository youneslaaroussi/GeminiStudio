import type { PipelineStepDefinition } from "./types";
import { metadataStep } from "./steps/metadata";
import { uploadStep } from "./steps/upload";
import { transcriptionStep } from "./steps/transcription";
import { faceDetectionStep } from "./steps/face-detection";

const registry: PipelineStepDefinition[] = [metadataStep, uploadStep, transcriptionStep, faceDetectionStep];

export function getPipelineSteps() {
  return registry;
}

export function findPipelineStep(stepId: string) {
  return registry.find((step) => step.id === stepId);
}
