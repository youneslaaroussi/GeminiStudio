import crypto from "crypto";
import { GoogleAuth } from "google-auth-library";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";
import { runAutoStepsForAsset } from "@/app/lib/server/pipeline/runner";
import {
  findVeoJobById,
  saveVeoJob,
  serializeVeoJob,
  updateVeoJob,
} from "@/app/lib/server/veo-store";
import type { StoredVeoJob, VeoJob, VeoJobParams, VeoJobStatus } from "@/app/types/veo";
import { parseGoogleServiceAccount, assertGoogleCredentials } from "@/app/lib/server/google-cloud";

const PROJECT_ID = process.env.VEO_PROJECT_ID;
const LOCATION = process.env.VEO_LOCATION || "us-central1";
const MODEL_ID = process.env.VEO_MODEL_ID || "veo-3.0-generate-001";

const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;
const PREDICT_URL = `${BASE_URL}:predictLongRunning`;
const FETCH_URL = `${BASE_URL}:fetchPredictOperation`;

const VEO_SERVICE_ACCOUNT_ENV = ["VEO_SERVICE_ACCOUNT_KEY"] as const;

function assertEnv() {
  if (!PROJECT_ID) {
    throw new Error("VEO_PROJECT_ID is not configured");
  }
  assertGoogleCredentials({ preferredEnvVars: [...VEO_SERVICE_ACCOUNT_ENV] });
}

async function getAccessToken() {
  assertEnv();
  const creds = parseGoogleServiceAccount({ preferredEnvVars: [...VEO_SERVICE_ACCOUNT_ENV] });
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token || null;
  if (!token) {
    throw new Error("Unable to acquire Google Cloud access token");
  }
  return token;
}

interface MediaInput {
  data?: string;
  mimeType?: string;
}

interface ReferenceImageInput extends MediaInput {
  referenceType?: string;
}

function normalizeBase64(value?: string) {
  if (!value) return undefined;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return value.trim();
  return value.slice(commaIndex + 1).trim();
}

function toVeoMedia(media?: MediaInput) {
  if (!media?.mimeType) return undefined;
  const normalized = normalizeBase64(media.data);
  if (!normalized) return undefined;
  return {
    bytesBase64Encoded: normalized,
    mimeType: media.mimeType,
  };
}

function mapVeoStatus(done: boolean, error?: boolean): VeoJobStatus {
  if (error) return "error";
  if (done) return "completed";
  return "running";
}

function computeVeoDimensions(
  resolution: "720p" | "1080p" | "4k",
  aspectRatio: "16:9" | "9:16"
): { width: number; height: number } {
  const resolutionMap = {
    "720p": { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
    "1080p": { landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } },
    "4k": { landscape: { width: 3840, height: 2160 }, portrait: { width: 2160, height: 3840 } },
  };
  const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";
  return resolutionMap[resolution][orientation];
}

export async function startVeoJob(params: VeoJobParams): Promise<VeoJob> {
  assertEnv();
  const token = await getAccessToken();

  const instance: Record<string, unknown> = {
    prompt: params.prompt.trim(),
  };

  const instanceImage = toVeoMedia(params.image);
  if (instanceImage) {
    instance.image = instanceImage;
  }

  const lastFrameMedia = toVeoMedia(params.lastFrame);
  if (lastFrameMedia) {
    instance.lastFrame = lastFrameMedia;
  }

  const videoMedia = toVeoMedia(params.video);
  if (videoMedia) {
    instance.video = videoMedia;
  }

  if (params.referenceImages?.length) {
    instance.referenceImages = params.referenceImages
      .map((ref) => {
        const media = toVeoMedia(ref);
        if (!media) return null;
        return {
          image: media,
          referenceType: ref.referenceType ?? "asset",
        };
      })
      .filter(Boolean);
  }

  const parameters: Record<string, unknown> = {
    durationSeconds: params.durationSeconds,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    generateAudio: params.generateAudio,
    sampleCount: 1,
  };

  if (params.resizeMode && instanceImage) {
    parameters.resizeMode = params.resizeMode;
  }

  if (params.negativePrompt?.trim()) {
    parameters.negativePrompt = params.negativePrompt.trim();
  }

  if (params.personGeneration) {
    parameters.personGeneration = params.personGeneration;
  }

  console.log("[VEO] Starting job with prompt:", params.prompt.slice(0, 100));

  const predictResponse = await fetch(PREDICT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [instance],
      parameters,
    }),
  });

  if (!predictResponse.ok) {
    const errorText = await predictResponse.text();
    throw new Error(`Veo request failed: ${errorText}`);
  }

  const predictPayload = (await predictResponse.json()) as { name?: string };
  if (!predictPayload.name) {
    throw new Error("Veo did not return an operation name");
  }

  console.log("[VEO] Operation started:", predictPayload.name);

  const jobId = crypto.randomUUID();
  const job: StoredVeoJob = {
    id: jobId,
    status: "running",
    params,
    operationName: predictPayload.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveVeoJob(job);
  return serializeVeoJob(job);
}

export async function pollVeoJob(jobId: string): Promise<VeoJob | null> {
  const job = await findVeoJobById(jobId);
  if (!job) return null;

  // If already completed or errored, return as-is
  if (job.status === "completed" || job.status === "error") {
    return serializeVeoJob(job);
  }

  if (!job.operationName) {
    return serializeVeoJob(job);
  }

  const token = await getAccessToken();

  const response = await fetch(FETCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operationName: job.operationName }),
  });

  if (!response.ok) {
    const text = await response.text();
    const updated = await updateVeoJob(job.id, {
      status: "error",
      error: `Failed to fetch Veo operation status: ${text}`,
    });
    return serializeVeoJob(updated ?? job);
  }

  const payload = (await response.json()) as {
    done?: boolean;
    response?: {
      videos?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    error?: { message?: string };
  };

  if (payload.error) {
    const updated = await updateVeoJob(job.id, {
      status: "error",
      error: payload.error.message || "Veo returned an error",
    });
    return serializeVeoJob(updated ?? job);
  }

  if (payload.done) {
    const firstVideo = payload.response?.videos?.[0];
    if (!firstVideo?.bytesBase64Encoded) {
      const updated = await updateVeoJob(job.id, {
        status: "error",
        error: "Veo response did not contain video data",
      });
      return serializeVeoJob(updated ?? job);
    }

    try {
      const buffer = Buffer.from(firstVideo.bytesBase64Encoded, "base64");
      const mimeType = firstVideo.mimeType || "video/mp4";
      const dimensions = computeVeoDimensions(
        job.params.resolution || "720p",
        job.params.aspectRatio || "16:9"
      );
      const asset = await saveBufferAsAsset({
        data: buffer,
        mimeType,
        originalName: `veo-${Date.now()}.mp4`,
        projectId: job.params.projectId,
        width: dimensions.width,
        height: dimensions.height,
        duration: job.params.durationSeconds,
      });

      // Trigger asset pipeline in background (GCS upload, face detection, etc.)
      runAutoStepsForAsset(asset.id).catch((error) => {
        console.error(`[VEO] Pipeline failed for asset ${asset.id}:`, error);
      });

      console.log("[VEO] Job completed, asset created:", asset.id);

      const updated = await updateVeoJob(job.id, {
        status: "completed",
        resultAssetId: asset.id,
        resultAssetUrl: asset.url,
      });
      return serializeVeoJob(updated ?? job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save video";
      const updated = await updateVeoJob(job.id, {
        status: "error",
        error: message,
      });
      return serializeVeoJob(updated ?? job);
    }
  }

  // Still running - update status
  const updated = await updateVeoJob(job.id, {
    status: "running",
  });
  return serializeVeoJob(updated ?? job);
}

export async function listVeoJobsForProject(projectId: string): Promise<VeoJob[]> {
  const { findVeoJobsByProject } = await import("@/app/lib/server/veo-store");
  const jobs = await findVeoJobsByProject(projectId);
  return jobs.map(serializeVeoJob);
}
