/**
 * Client for communicating with the asset service.
 * Used to forward asset uploads and pipeline operations.
 */

const ASSET_SERVICE_URL = process.env.ASSET_SERVICE_URL || "http://localhost:8081";

export interface AssetServiceAsset {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  type: string;
  uploadedAt: string;
  updatedAt?: string;
  gcsUri?: string;
  signedUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  source?: string;
  sortOrder?: number;
}

export interface UploadResponse {
  asset: AssetServiceAsset;
  pipelineStarted: boolean;
}

export interface PipelineStepState {
  id: string;
  label: string;
  status: string;
  metadata: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  updatedAt: string;
}

export interface PipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}

/**
 * Check if asset service is configured and available.
 */
export function isAssetServiceEnabled(): boolean {
  return !!process.env.ASSET_SERVICE_URL;
}

/**
 * Upload an asset to the asset service.
 */
export async function uploadToAssetService(
  userId: string,
  projectId: string,
  file: File,
  options: {
    source?: string;
    runPipeline?: boolean;
  } = {}
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source", options.source || "web");
  formData.append("run_pipeline", options.runPipeline !== false ? "true" : "false");

  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Asset service upload failed: ${response.status} - ${text}`);
  }

  return response.json();
}

/**
 * List assets for a project.
 */
export async function listAssetsFromService(
  userId: string,
  projectId: string
): Promise<AssetServiceAsset[]> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Asset service list failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a single asset.
 */
export async function getAssetFromService(
  userId: string,
  projectId: string,
  assetId: string
): Promise<AssetServiceAsset> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}`,
    { method: "GET" }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Asset not found");
    }
    throw new Error(`Asset service get failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Update an asset (e.g. name, sortOrder).
 */
export async function updateAssetFromService(
  userId: string,
  projectId: string,
  assetId: string,
  updates: { name?: string; sortOrder?: number }
): Promise<AssetServiceAsset> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Asset not found");
    }
    throw new Error(`Asset service update failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Reorder assets by providing ordered list of asset IDs.
 */
export async function reorderAssetsFromService(
  userId: string,
  projectId: string,
  assetIds: string[]
): Promise<AssetServiceAsset[]> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Asset service reorder failed: ${response.status} - ${text}`);
  }

  return response.json();
}

/**
 * Delete an asset.
 */
export async function deleteAssetFromService(
  userId: string,
  projectId: string,
  assetId: string
): Promise<void> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}`,
    { method: "DELETE" }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(`Asset service delete failed: ${response.status}`);
  }
}

/**
 * Get pipeline state for an asset.
 */
export async function getPipelineStateFromService(
  userId: string,
  projectId: string,
  assetId: string
): Promise<PipelineState> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/pipeline/${userId}/${projectId}/${assetId}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Asset service pipeline get failed: ${response.status}`);
  }

  return response.json();
}

/**
 * List all pipeline states for a project.
 */
export async function listPipelineStatesFromService(
  userId: string,
  projectId: string
): Promise<PipelineState[]> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/pipeline/${userId}/${projectId}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Asset service pipeline list failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Response from queueing a pipeline step.
 */
export interface QueuedTaskResponse {
  taskId: string;
  message: string;
}

/**
 * Run a specific pipeline step (queued for background processing).
 */
export async function runPipelineStepOnService(
  userId: string,
  projectId: string,
  assetId: string,
  stepId: string,
  params: Record<string, unknown> = {}
): Promise<QueuedTaskResponse> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/pipeline/${userId}/${projectId}/${assetId}/${stepId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Asset service pipeline step failed: ${response.status} - ${text}`);
  }

  return response.json();
}

/**
 * Run all auto-start pipeline steps (queued for background processing).
 */
export async function runAutoPipelineOnService(
  userId: string,
  projectId: string,
  assetId: string
): Promise<QueuedTaskResponse> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/pipeline/${userId}/${projectId}/${assetId}/auto`,
    { method: "POST" }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Asset service auto pipeline failed: ${response.status} - ${text}`);
  }

  return response.json();
}
