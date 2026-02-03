/**
 * Client for communicating with the asset service.
 * Used to forward asset uploads and pipeline operations.
 */

import { createHash, createHmac } from "crypto";

const ASSET_SERVICE_URL = process.env.ASSET_SERVICE_URL || "http://localhost:8081";
const SHARED_SECRET = process.env.ASSET_SERVICE_SHARED_SECRET;

/**
 * Generate HMAC authentication headers for asset service requests.
 * If ASSET_SERVICE_SHARED_SECRET is not set, returns empty headers (dev mode).
 */
function getAuthHeaders(body: string = ""): Record<string, string> {
  if (!SHARED_SECRET) {
    return {};
  }
  const timestamp = Date.now();
  const payload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", SHARED_SECRET).update(payload).digest("hex");
  return {
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };
}

/**
 * Generate HMAC authentication headers for file upload requests.
 * Includes a hash of the file content for integrity verification.
 */
function getUploadAuthHeaders(fileBytes: Buffer): Record<string, string> {
  if (!SHARED_SECRET) {
    return {};
  }
  const bodyHash = createHash("sha256").update(fileBytes).digest("hex");
  const timestamp = Date.now();
  const payload = `${timestamp}.${bodyHash}`;
  const signature = createHmac("sha256", SHARED_SECRET).update(payload).digest("hex");
  return {
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
    "X-Body-Hash": bodyHash,
  };
}

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
  description?: string; // AI-generated short description
  notes?: string; // User notes (what the asset is for)
  // Transcode status fields
  transcodeStatus?: "pending" | "processing" | "completed" | "error";
  transcodeError?: string;
}

export interface UploadResponse {
  asset: AssetServiceAsset;
  pipelineStarted: boolean;
  transcodeStarted?: boolean;
}

export interface TranscodeOptions {
  preset?: string; // e.g., "preset/web-hd", "preset/web-sd"
  outputFormat?: string; // "mp4", "hls", "dash"
  videoCodec?: string; // "h264", "h265", "vp9"
  videoBitrate?: number; // bps
  frameRate?: number;
  audioCodec?: string; // "aac", "mp3", "opus"
  audioBitrate?: number; // bps
  sampleRate?: number;
  channels?: number;
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
    transcodeOptions?: TranscodeOptions;
  } = {}
): Promise<UploadResponse> {
  // Read file bytes for hash computation
  const fileBytes = Buffer.from(await file.arrayBuffer());
  
  const formData = new FormData();
  formData.append("file", new Blob([fileBytes], { type: file.type }), file.name);
  formData.append("source", options.source || "web");
  formData.append("run_pipeline", options.runPipeline !== false ? "true" : "false");

  // Add transcode options if provided
  if (options.transcodeOptions) {
    formData.append("transcodeOptions", JSON.stringify(options.transcodeOptions));
  }

  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/upload`,
    {
      method: "POST",
      headers: getUploadAuthHeaders(fileBytes),
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
    { method: "GET", headers: getAuthHeaders("") }
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
    { method: "GET", cache: "no-store", headers: getAuthHeaders("") }
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
  updates: { name?: string; sortOrder?: number; notes?: string }
): Promise<AssetServiceAsset> {
  const body = JSON.stringify(updates);
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(body) },
      body,
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
  const body = JSON.stringify({ assetIds });
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(body) },
      body,
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
    { method: "DELETE", headers: getAuthHeaders("") }
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
    { method: "GET", headers: getAuthHeaders("") }
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
    { method: "GET", headers: getAuthHeaders("") }
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
  const body = JSON.stringify({ params });
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/pipeline/${userId}/${projectId}/${assetId}/${stepId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(body) },
      body,
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
    { method: "POST", headers: getAuthHeaders("") }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Asset service auto pipeline failed: ${response.status} - ${text}`);
  }

  return response.json();
}

/**
 * Response from user deletion.
 */
export interface DeleteUserResponse {
  projectsDeleted: number;
  assetsDeleted: number;
  gcsObjectsDeleted: number;
}

/**
 * Delete all assets and data for a user.
 * This is used when deleting a user account.
 */
export async function deleteUserFromAssetService(
  userId: string
): Promise<DeleteUserResponse> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/users/${userId}`,
    { method: "DELETE", headers: getAuthHeaders("") }
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Asset service user deletion failed: ${response.status} - ${text}`);
  }

  if (response.status === 404) {
    // User had no data in asset service
    return { projectsDeleted: 0, assetsDeleted: 0, gcsObjectsDeleted: 0 };
  }

  return response.json();
}

/**
 * Delete all assets for a specific project.
 */
/**
 * Search result from asset service.
 */
export interface SearchHit {
  id: string;
  userId?: string;
  projectId?: string;
  name: string;
  fileName?: string;
  type: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  description?: string;
  labels?: string[];
  uploadedAt?: string;
  updatedAt?: string;
  highlights?: {
    name?: string;
    description?: string;
    searchableText?: string;
  };
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  query: string;
  page?: number;
  totalPages?: number;
  processingTimeMs?: number;
  error?: string;
}

/**
 * Search assets in a project.
 */
export async function searchAssetsFromService(
  userId: string,
  projectId: string,
  query: string,
  options: { type?: string; limit?: number } = {}
): Promise<SearchResponse> {
  const body = JSON.stringify({
    query,
    type: options.type,
    limit: options.limit || 20,
  });

  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/search/${userId}/${projectId}/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(body) },
      body,
    }
  );

  if (!response.ok) {
    if (response.status === 503) {
      return {
        hits: [],
        total: 0,
        query,
        error: "Search is not configured",
      };
    }
    const text = await response.text();
    throw new Error(`Asset service search failed: ${response.status} - ${text}`);
  }

  return response.json();
}

export async function deleteProjectFromAssetService(
  userId: string,
  projectId: string
): Promise<{ assetsDeleted: number; gcsObjectsDeleted: number }> {
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}`,
    { method: "DELETE", headers: getAuthHeaders("") }
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Asset service project deletion failed: ${response.status} - ${text}`);
  }

  if (response.status === 404) {
    return { assetsDeleted: 0, gcsObjectsDeleted: 0 };
  }

  return response.json();
}

/**
 * Response from starting a transcode job.
 */
export interface TranscodeResponse {
  queued: boolean;
  jobId?: string;
  message: string;
}

/**
 * Start a transcode job for an existing asset.
 */
export async function transcodeAsset(
  userId: string,
  projectId: string,
  assetId: string,
  options: TranscodeOptions
): Promise<TranscodeResponse> {
  const body = JSON.stringify(options);
  const response = await fetch(
    `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}/transcode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(body) },
      body,
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Asset not found");
    }
    if (response.status === 400) {
      const data = await response.json();
      throw new Error(data.detail || "Cannot transcode this asset");
    }
    const text = await response.text();
    throw new Error(`Transcode request failed: ${response.status} - ${text}`);
  }

  return response.json();
}
