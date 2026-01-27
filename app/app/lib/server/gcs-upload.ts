import { getGoogleAccessToken } from "./google-cloud";
import { createV4SignedUrl } from "./gcs-signed-url";

const DEFAULT_BUCKET = process.env.ASSET_GCS_BUCKET;

export interface GcsUploadResult {
  /** The gs:// URI for the uploaded object */
  gcsUri: string;
  /** A signed URL for HTTP access (optional, based on config) */
  signedUrl?: string;
  /** The bucket name */
  bucket: string;
  /** The object name/path in the bucket */
  objectName: string;
}

export interface UploadToGcsOptions {
  /** The file data to upload */
  data: Buffer;
  /** MIME type of the file */
  mimeType: string;
  /** Destination path/name in the bucket (e.g., "chat-attachments/abc123/image.png") */
  destination: string;
  /** Optional bucket name (defaults to ASSET_GCS_BUCKET env var) */
  bucket?: string;
  /** Whether to generate a signed URL for HTTP access */
  generateSignedUrl?: boolean;
  /** Signed URL expiration in seconds (default: 7 days) */
  signedUrlTtlSeconds?: number;
  /** Preferred service account env vars for authentication */
  preferredEnvVars?: string[];
}

/**
 * Upload a buffer to Google Cloud Storage
 *
 * This is a reusable utility for uploading files to GCS. It handles:
 * - Authentication via service account
 * - Uploading the file data
 * - Generating both gs:// URIs and optional signed URLs
 *
 * @example
 * ```ts
 * const result = await uploadToGcs({
 *   data: buffer,
 *   mimeType: "image/png",
 *   destination: "chat-attachments/session-123/image.png",
 *   generateSignedUrl: true,
 * });
 * console.log(result.gcsUri); // gs://bucket/chat-attachments/session-123/image.png
 * ```
 */
export async function uploadToGcs({
  data,
  mimeType,
  destination,
  bucket = DEFAULT_BUCKET,
  generateSignedUrl = false,
  signedUrlTtlSeconds = 60 * 60 * 24 * 7, // 7 days
  preferredEnvVars,
}: UploadToGcsOptions): Promise<GcsUploadResult> {
  if (!bucket) {
    throw new Error("GCS bucket not configured. Set ASSET_GCS_BUCKET environment variable.");
  }

  const token = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/devstorage.full_control",
    preferredEnvVars ? { preferredEnvVars } : undefined
  );

  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(destination)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": data.byteLength.toString(),
    },
    body: data as BodyInit,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload to GCS: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as { name: string };
  const objectName = payload.name;
  const gcsUri = `gs://${bucket}/${objectName}`;

  const result: GcsUploadResult = {
    gcsUri,
    bucket,
    objectName,
  };

  if (generateSignedUrl) {
    result.signedUrl = createV4SignedUrl({
      bucket,
      objectName,
      expiresInSeconds: signedUrlTtlSeconds,
    });
  }

  return result;
}

/**
 * Check if a GCS URI exists and is accessible
 */
export async function checkGcsObjectExists(
  gcsUri: string,
  preferredEnvVars?: string[]
): Promise<boolean> {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }

  const [, bucket, objectName] = match;
  const token = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/devstorage.read_only",
    preferredEnvVars ? { preferredEnvVars } : undefined
  );

  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`;
  const response = await fetch(url, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.ok;
}

/**
 * Delete an object from GCS
 */
export async function deleteGcsObject(
  gcsUri: string,
  preferredEnvVars?: string[]
): Promise<void> {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }

  const [, bucket, objectName] = match;
  const token = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/devstorage.full_control",
    preferredEnvVars ? { preferredEnvVars } : undefined
  );

  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to delete GCS object: ${response.status} ${text}`);
  }
}
