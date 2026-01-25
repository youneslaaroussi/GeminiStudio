export type PipelineStepStatus = "idle" | "queued" | "running" | "waiting" | "succeeded" | "failed";

export interface PipelineStepState {
  id: string;
  label: string;
  status: PipelineStepStatus;
  error?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  updatedAt: string;
}

export interface AssetPipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}
