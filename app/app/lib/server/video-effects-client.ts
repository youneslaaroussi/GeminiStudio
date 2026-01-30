/**
 * Client for communicating with the video effects service.
 */

const VIDEO_EFFECTS_SERVICE_URL = process.env.VIDEO_EFFECTS_SERVICE_URL || "http://localhost:8082";

export interface VideoEffectJob {
  id: string;
  effectId: string;
  effectLabel?: string;
  provider: string;
  assetId: string;
  assetName: string;
  assetUrl: string;
  userId?: string;
  projectId?: string;
  status: string;
  params: Record<string, unknown>;
  resultAssetId?: string;
  resultAssetUrl?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoEffectDefinition {
  id: string;
  label: string;
  description?: string;
  provider: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
  defaultValues: Record<string, unknown>;
}

/**
 * Check if video effects service is configured and available.
 * Returns true if explicitly configured OR if we should use the default localhost URL.
 */
export function isVideoEffectsServiceEnabled(): boolean {
  return true;
}

/**
 * Start a new video effect job.
 */
export async function startVideoEffectJob(options: {
  userId: string;
  projectId: string;
  assetId: string;
  effectId: string;
  params?: Record<string, unknown>;
}): Promise<VideoEffectJob> {
  const response = await fetch(`${VIDEO_EFFECTS_SERVICE_URL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: options.userId,
      projectId: options.projectId,
      assetId: options.assetId,
      effectId: options.effectId,
      params: options.params || {},
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Video effects service failed: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.job;
}

/**
 * Get a video effect job by ID (polls for status updates).
 */
export async function getVideoEffectJob(jobId: string): Promise<VideoEffectJob | null> {
  const response = await fetch(`${VIDEO_EFFECTS_SERVICE_URL}/api/jobs/${jobId}`, {
    method: "GET",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Video effects service get job failed: ${response.status}`);
  }

  const data = await response.json();
  return data.job;
}

/**
 * List video effect jobs for an asset.
 */
export async function listVideoEffectJobs(assetId: string): Promise<VideoEffectJob[]> {
  const response = await fetch(
    `${VIDEO_EFFECTS_SERVICE_URL}/api/jobs?assetId=${encodeURIComponent(assetId)}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Video effects service list jobs failed: ${response.status}`);
  }

  const data = await response.json();
  return data.jobs;
}

/**
 * List available video effects.
 */
export async function listVideoEffectDefinitions(): Promise<VideoEffectDefinition[]> {
  const response = await fetch(`${VIDEO_EFFECTS_SERVICE_URL}/api/effects`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Video effects service list effects failed: ${response.status}`);
  }

  const data = await response.json();
  return data.effects;
}
