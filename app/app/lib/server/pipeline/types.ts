import type { PipelineStepState } from "@/app/types/pipeline";
import type { AssetType } from "@/app/types/assets";
import type { StoredAsset } from "@/app/lib/server/asset-storage";

export interface PipelineRunContext {
  asset: StoredAsset;
  assetPath: string;
  assetType: AssetType;
  stepState: PipelineStepState;
  params?: Record<string, unknown>;
}

export interface PipelineRunResult {
  status: PipelineStepState["status"];
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface PipelineStepDefinition {
  id: string;
  label: string;
  description?: string;
  autoStart?: boolean;
  supportedTypes?: AssetType[];
  run: (context: PipelineRunContext) => Promise<PipelineRunResult>;
}
