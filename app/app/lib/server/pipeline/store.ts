import { promises as fs } from "fs";
import path from "path";
import type { AssetPipelineState, PipelineStepState } from "@/app/types/pipeline";
import { getPipelineSteps } from "./registry";

const DATA_DIR = path.join(process.cwd(), ".data");
const PIPELINE_STATE_PATH = path.join(DATA_DIR, "asset-pipelines.json");

type StoredPipelineState = AssetPipelineState;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAll(): Promise<StoredPipelineState[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(PIPELINE_STATE_PATH, "utf8");
    return JSON.parse(raw) as StoredPipelineState[];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeAll(states: StoredPipelineState[]) {
  await ensureStore();
  await fs.writeFile(PIPELINE_STATE_PATH, JSON.stringify(states, null, 2), "utf8");
}

function withDefaultSteps(state: StoredPipelineState, timestamp: string) {
  const definitions = getPipelineSteps();
  const existing = new Map(state.steps.map((step) => [step.id, step]));
  const merged: PipelineStepState[] = definitions.map((definition) => {
    const previous = existing.get(definition.id);
    if (previous) {
      return previous;
    }
    return {
      id: definition.id,
      label: definition.label,
      status: "idle",
      updatedAt: timestamp,
    };
  });
  return {
    ...state,
    steps: merged,
  };
}

export async function getPipelineStateForAsset(assetId: string) {
  const states = await readAll();
  const existing = states.find((record) => record.assetId === assetId);
  const timestamp = new Date().toISOString();
  if (!existing) {
    const state: StoredPipelineState = {
      assetId,
      steps: [],
      updatedAt: timestamp,
    };
    const merged = withDefaultSteps(state, timestamp);
    states.push(merged);
    await writeAll(states);
    return merged;
  }
  const merged = withDefaultSteps(existing, timestamp);
  return merged;
}

export async function getAllPipelineStates() {
  const states = await readAll();
  const timestamp = new Date().toISOString();
  return states.map((state) => withDefaultSteps(state, timestamp));
}

export async function updatePipelineState(assetId: string, steps: PipelineStepState[]) {
  const states = await readAll();
  const index = states.findIndex((record) => record.assetId === assetId);
  const updated: StoredPipelineState = {
    assetId,
    steps,
    updatedAt: new Date().toISOString(),
  };
  if (index === -1) {
    states.push(updated);
  } else {
    states[index] = updated;
  }
  await writeAll(states);
  return updated;
}

export async function updatePipelineStep(
  assetId: string,
  stepId: string,
  updater: (previous: PipelineStepState) => PipelineStepState
) {
  const state = await getPipelineStateForAsset(assetId);
  const steps = state.steps.map((step) => (step.id === stepId ? updater(step) : step));
  return updatePipelineState(assetId, steps);
}
