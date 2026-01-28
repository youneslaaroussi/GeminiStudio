import type { ToolFieldDefinition } from "@/app/lib/tools/types";
import type { z } from "zod";

export type VideoEffectProvider = "replicate";

export type VideoEffectStatus = "pending" | "running" | "completed" | "error";

export interface VideoEffectJob {
  id: string;
  effectId: string;
  effectLabel?: string;
  provider: VideoEffectProvider;
  assetId: string;
  assetName: string;
  assetUrl: string;
  userId?: string;
  projectId?: string;
  status: VideoEffectStatus;
  params: Record<string, unknown>;
  resultAssetId?: string;
  resultAssetUrl?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredVideoEffectJob extends VideoEffectJob {
  providerState?: {
    replicate?: {
      predictionId: string;
      version: string;
      getUrl?: string;
      streamUrl?: string;
    };
  };
}

export interface VideoEffectDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = z.infer<TSchema>
> {
  id: string;
  label: string;
  description?: string;
  provider: VideoEffectProvider;
  version?: string;
  formSchema: TSchema;
  fields: ToolFieldDefinition[];
  defaultValues: Partial<TParams>;
  buildProviderInput: (options: {
    assetUrl: string;
    assetName: string;
    params: TParams;
  }) => Record<string, unknown>;
  extractResult: (options: {
    providerOutput: unknown;
    providerStatus: string;
  }) => {
    resultUrl?: string;
    metadata?: Record<string, unknown>;
    error?: string;
  };
}

export type AnyVideoEffectDefinition = VideoEffectDefinition<z.ZodTypeAny, any>;
