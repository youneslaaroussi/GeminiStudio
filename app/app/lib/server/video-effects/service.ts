import crypto from "crypto";
import { readManifest, saveBufferAsAsset, storedAssetToRemote } from "@/app/lib/server/asset-storage";
import {
  findVideoEffectJobById,
  findVideoEffectJobsByAsset,
  saveVideoEffectJob,
  serializeVideoEffectJob,
  updateVideoEffectJob,
} from "@/app/lib/server/video-effects-store";
import {
  getVideoEffectDefinition,
  videoEffectDefinitions,
} from "@/app/lib/video-effects/definitions";
import type {
  StoredVideoEffectJob,
  VideoEffectJob,
  VideoEffectStatus,
} from "@/app/types/video-effects";
import {
  createReplicatePrediction,
  getReplicatePrediction,
  mapReplicateStatus,
  type ReplicatePrediction,
} from "@/app/lib/server/effects/providers/replicate";

function ensureAbsoluteUrl(relativeUrl: string, origin: string) {
  if (/^https?:\/\//i.test(relativeUrl)) {
    return relativeUrl;
  }
  const sanitizedOrigin = origin.endsWith("/")
    ? origin.slice(0, -1)
    : origin;
  return `${sanitizedOrigin}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
}

async function findStoredAsset(assetId: string) {
  const manifest = await readManifest();
  return manifest.find((asset) => asset.id === assetId) ?? null;
}

async function downloadRemoteFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download processed video (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType =
    response.headers.get("content-type") ?? "video/mp4";
  return {
    buffer,
    mimeType,
  };
}

function mergeJobWithDefinition(job: StoredVideoEffectJob): VideoEffectJob {
  const definition = getVideoEffectDefinition(job.effectId);
  const serialized = serializeVideoEffectJob(job);
  return {
    ...serialized,
    effectLabel: definition?.label ?? job.effectId,
  };
}

function mapProviderStatusToJobStatus(status: string): VideoEffectStatus {
  return mapReplicateStatus(status);
}

export async function listVideoEffectDefinitions() {
  return videoEffectDefinitions;
}

export async function listVideoEffectJobsForAsset(assetId: string) {
  const jobs = await findVideoEffectJobsByAsset(assetId);
  return jobs.map(mergeJobWithDefinition);
}

export async function startVideoEffectJob(options: {
  effectId: string;
  assetId: string;
  origin?: string;
  params: Record<string, unknown>;
}) {
  const definition = getVideoEffectDefinition(options.effectId);
  if (!definition) {
    throw new Error(`Unknown video effect: ${options.effectId}`);
  }

  const storedAsset = await findStoredAsset(options.assetId);
  if (!storedAsset) {
    throw new Error(`Asset ${options.assetId} does not exist`);
  }

  const remoteAsset = storedAssetToRemote(storedAsset);
  const origin =
    options.origin ??
    process.env.APP_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  const assetUrl = ensureAbsoluteUrl(remoteAsset.url, origin);

  let validatedParams: Record<string, unknown>;
  try {
    validatedParams = definition.formSchema.parse({
      ...definition.defaultValues,
      ...options.params,
    }) as Record<string, unknown>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid effect parameters";
    throw new Error(message);
  }

  if (definition.provider !== "replicate" || !definition.version) {
    throw new Error("Only Replicate provider is currently supported for effects");
  }

  const providerInput = definition.buildProviderInput({
    assetUrl,
    assetName: remoteAsset.name,
    params: validatedParams,
  });

  const prediction = await createReplicatePrediction({
    version: definition.version,
    input: providerInput,
  });

  const jobId = crypto.randomUUID();
  const job: StoredVideoEffectJob = {
    id: jobId,
    effectId: definition.id,
    provider: definition.provider,
    assetId: storedAsset.id,
    assetName: remoteAsset.name,
    assetUrl: remoteAsset.url,
    status: mapProviderStatusToJobStatus(prediction.status),
    params: validatedParams,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providerState: {
      replicate: {
        predictionId: prediction.id,
        version: definition.version,
        getUrl: prediction.urls?.get,
        streamUrl: prediction.urls?.stream,
      },
    },
  };

  await saveVideoEffectJob(job);
  return mergeJobWithDefinition(job);
}

async function handlePredictionCompletion(options: {
  job: StoredVideoEffectJob;
  prediction: ReplicatePrediction;
}) {
  const { job, prediction } = options;
  const definition = getVideoEffectDefinition(job.effectId);
  if (!definition) {
    throw new Error(`Unknown video effect: ${job.effectId}`);
  }
  const extraction = definition.extractResult({
    providerOutput: prediction.output,
    providerStatus: prediction.status,
  });

  if (extraction.error) {
    return updateVideoEffectJob(job.id, {
      status: "error",
      error: extraction.error,
    });
  }

  if (!extraction.resultUrl) {
    return updateVideoEffectJob(job.id, {
      status: "error",
      error: "Processed video URL was not returned by the provider.",
    });
  }

  const download = await downloadRemoteFile(extraction.resultUrl);
  const stored = await saveBufferAsAsset({
    data: download.buffer,
    mimeType: download.mimeType,
    originalName: `${definition.label ?? definition.id}-${Date.now()}.mp4`,
  });

  return updateVideoEffectJob(job.id, {
    status: "completed",
    resultAssetId: stored.id,
    resultAssetUrl: stored.url,
    metadata: {
      ...(extraction.metadata ?? {}),
      providerMetrics: prediction.metrics,
    },
  });
}

export async function pollVideoEffectJob(jobId: string) {
  const job = await findVideoEffectJobById(jobId);
  if (!job) return null;

  const definition = getVideoEffectDefinition(job.effectId);
  if (!definition) {
    throw new Error(`Unknown video effect: ${job.effectId}`);
  }

  if (job.status === "completed" || job.status === "error") {
    return mergeJobWithDefinition(job);
  }

  if (!job.providerState?.replicate?.predictionId) {
    return mergeJobWithDefinition(job);
  }

  const prediction = await getReplicatePrediction(
    job.providerState.replicate.predictionId
  );

  const status = mapProviderStatusToJobStatus(prediction.status);

  if (status === "completed") {
    try {
      const updated = await handlePredictionCompletion({ job, prediction });
      return mergeJobWithDefinition(updated ?? job);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to finalize video effect";
      const updated = await updateVideoEffectJob(job.id, {
        status: "error",
        error: message,
      });
      return mergeJobWithDefinition(updated ?? job);
    }
  }

  if (status === "error") {
    const updated = await updateVideoEffectJob(job.id, {
      status,
      error:
        prediction.error ??
        (typeof prediction.output === "string"
          ? prediction.output
          : Array.isArray(prediction.output)
          ? prediction.output.join("\n")
          : "Video effect failed"),
    });
    return mergeJobWithDefinition(updated ?? job);
  }

  const updated = await updateVideoEffectJob(job.id, {
    status,
    metadata: {
      ...(job.metadata ?? {}),
      providerMetrics: prediction.metrics,
    },
  });

  return mergeJobWithDefinition(updated ?? job);
}
