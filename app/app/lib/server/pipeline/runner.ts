import path from "path";
import { readManifest, determineAssetType, UPLOAD_DIR } from "@/app/lib/server/asset-storage";
import { findPipelineStep, getPipelineSteps } from "./registry";
import { updatePipelineStep, getPipelineStateForAsset } from "./store";
import type { PipelineRunResult } from "./types";

interface RunPipelineOptions {
  params?: Record<string, unknown>;
}

export async function runPipelineStepForAsset(
  assetId: string,
  stepId: string,
  options?: RunPipelineOptions
) {
  const manifest = await readManifest();
  const asset = manifest.find((entry) => entry.id === assetId);
  if (!asset) {
    throw new Error("Asset not found");
  }
  const stepDefinition = findPipelineStep(stepId);
  if (!stepDefinition) {
    throw new Error(`Unknown pipeline step: ${stepId}`);
  }

  const assetType = determineAssetType(asset.mimeType, asset.name);
  if (stepDefinition.supportedTypes && !stepDefinition.supportedTypes.includes(assetType)) {
    throw new Error(`Step "${stepDefinition.label}" does not support ${assetType} assets`);
  }

  const state = await getPipelineStateForAsset(assetId);
  const stepState =
    state.steps.find((step) => step.id === stepId) ??
    ({
      id: stepId,
      label: stepDefinition.label,
      status: "idle",
      updatedAt: new Date().toISOString(),
    } as const);

  await updatePipelineStep(assetId, stepId, () => ({
    ...stepState,
    status: "running",
    error: undefined,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  let result: PipelineRunResult;

  try {
    result = await stepDefinition.run({
      asset,
      assetPath: path.join(UPLOAD_DIR, asset.fileName),
      assetType,
      stepState,
      params: options?.params,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updatePipelineStep(assetId, stepId, (prev) => ({
      ...prev,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    }));
    throw error;
  }

  await updatePipelineStep(assetId, stepId, (prev) => ({
    ...prev,
    status: result.status,
    metadata: result.metadata ?? prev.metadata,
    error: result.error,
    updatedAt: new Date().toISOString(),
  }));

  return getPipelineStateForAsset(assetId);
}

export async function runAutoStepsForAsset(assetId: string) {
  const manifest = await readManifest();
  const asset = manifest.find((entry) => entry.id === assetId);
  if (!asset) return;
  const autoSteps = getPipelineSteps().filter((step) => step.autoStart);

  let pipelineState = await getPipelineStateForAsset(assetId);
  for (const step of autoSteps) {
    const current = pipelineState.steps.find((s) => s.id === step.id);
    if (current?.status === "succeeded" || current?.status === "running" || current?.status === "waiting") {
      continue;
    }
    pipelineState = await runPipelineStepForAsset(assetId, step.id);
  }
}
