/**
 * Gemini Files API
 *
 * Utilities for uploading and managing files with Google's Gemini Files API.
 * Files uploaded via this API can be used in generateContent requests and
 * persist for 48 hours.
 *
 * @see https://ai.google.dev/gemini-api/docs/files
 */

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com";

/**
 * Metadata returned when a file is uploaded to the Gemini Files API
 */
export interface GeminiFile {
  /** File name in the format "files/{id}" */
  name: string;
  /** Display name for the file */
  displayName?: string;
  /** MIME type of the file */
  mimeType: string;
  /** Size in bytes */
  sizeBytes: string;
  /** Creation timestamp */
  createTime: string;
  /** Last update timestamp */
  updateTime: string;
  /** Expiration timestamp (files expire after 48 hours) */
  expirationTime: string;
  /** SHA256 hash of the file */
  sha256Hash?: string;
  /** URI to use in generateContent requests */
  uri: string;
  /** Processing state: PROCESSING, ACTIVE, or FAILED */
  state: "PROCESSING" | "ACTIVE" | "FAILED";
  /** Error if state is FAILED */
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Options for uploading a file
 */
export interface UploadFileOptions {
  /** Display name for the file (optional) */
  displayName?: string;
  /** MIME type of the file */
  mimeType: string;
}

/**
 * Error thrown when the Files API returns an error
 */
export class GeminiFilesApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "GeminiFilesApiError";
  }
}

/**
 * Upload a file to the Gemini Files API from a buffer
 *
 * @param data - The file data as a Buffer
 * @param options - Upload options including mimeType
 * @returns The uploaded file metadata
 *
 * @example
 * ```ts
 * const buffer = await fs.readFile("video.mp4");
 * const file = await uploadFile(buffer, {
 *   mimeType: "video/mp4",
 *   displayName: "My Video"
 * });
 * // Use file.uri in generateContent requests
 * ```
 */
export async function uploadFile(
  data: Buffer,
  options: UploadFileOptions
): Promise<GeminiFile> {
  if (!API_KEY) {
    throw new GeminiFilesApiError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
      500
    );
  }

  const numBytes = data.byteLength;

  // Step 1: Start resumable upload and get upload URL
  const startResponse = await fetch(
    `${BASE_URL}/upload/v1beta/files?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": options.mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: options.displayName,
        },
      }),
    }
  );

  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new GeminiFilesApiError(
      `Failed to start upload: ${startResponse.status}`,
      startResponse.status,
      errorText
    );
  }

  const uploadUrl = startResponse.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new GeminiFilesApiError(
      "No upload URL returned from Files API",
      500
    );
  }

  // Step 2: Upload the file data
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(data),
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new GeminiFilesApiError(
      `Failed to upload file: ${uploadResponse.status}`,
      uploadResponse.status,
      errorText
    );
  }

  const result = (await uploadResponse.json()) as { file: GeminiFile };
  return result.file;
}

/**
 * Upload a file to Gemini Files API from a URL
 *
 * This fetches the content from the URL and uploads it to the Files API.
 * Useful for uploading files from GCS signed URLs or other HTTP sources.
 *
 * @param url - The URL to fetch the file from
 * @param options - Upload options including mimeType
 * @returns The uploaded file metadata
 *
 * @example
 * ```ts
 * const file = await uploadFileFromUrl(
 *   "https://storage.googleapis.com/bucket/video.mp4?signature=...",
 *   { mimeType: "video/mp4", displayName: "My Video" }
 * );
 * // Use file.uri in generateContent requests
 * ```
 */
export async function uploadFileFromUrl(
  url: string,
  options: UploadFileOptions
): Promise<GeminiFile> {
  console.log(`[gemini-files-api] Fetching file from URL...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new GeminiFilesApiError(
      `Failed to fetch file from URL: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(
    `[gemini-files-api] Fetched ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB, uploading to Files API...`
  );

  return uploadFile(buffer, options);
}

/**
 * Get metadata for a file
 *
 * @param name - The file name (e.g., "files/abc123")
 * @returns The file metadata
 */
export async function getFile(name: string): Promise<GeminiFile> {
  if (!API_KEY) {
    throw new GeminiFilesApiError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
      500
    );
  }

  const response = await fetch(
    `${BASE_URL}/v1beta/${name}?key=${API_KEY}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new GeminiFilesApiError(
      `Failed to get file: ${response.status}`,
      response.status,
      errorText
    );
  }

  return response.json() as Promise<GeminiFile>;
}

/**
 * Wait for a file to finish processing
 *
 * Files are processed asynchronously after upload. This function polls
 * until the file reaches ACTIVE state or fails.
 *
 * @param name - The file name (e.g., "files/abc123")
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 60000)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 2000)
 * @returns The file metadata once active
 */
export async function waitForFileActive(
  name: string,
  maxWaitMs = 60000,
  pollIntervalMs = 2000
): Promise<GeminiFile> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const file = await getFile(name);

    if (file.state === "ACTIVE") {
      console.log(`[gemini-files-api] File ${name} is ready`);
      return file;
    }

    if (file.state === "FAILED") {
      throw new GeminiFilesApiError(
        `File processing failed: ${file.error?.message ?? "Unknown error"}`,
        500,
        file.error
      );
    }

    console.log(
      `[gemini-files-api] File ${name} is ${file.state}, waiting...`
    );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new GeminiFilesApiError(
    `Timeout waiting for file ${name} to become active`,
    408
  );
}

/**
 * Delete a file from the Files API
 *
 * @param name - The file name (e.g., "files/abc123")
 */
export async function deleteFile(name: string): Promise<void> {
  if (!API_KEY) {
    throw new GeminiFilesApiError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
      500
    );
  }

  const response = await fetch(
    `${BASE_URL}/v1beta/${name}?key=${API_KEY}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new GeminiFilesApiError(
      `Failed to delete file: ${response.status}`,
      response.status,
      errorText
    );
  }
}

/**
 * List all uploaded files
 *
 * @param pageSize - Number of files per page (default: 100)
 * @param pageToken - Token for pagination
 * @returns List of files and optional next page token
 */
export async function listFiles(
  pageSize = 100,
  pageToken?: string
): Promise<{ files: GeminiFile[]; nextPageToken?: string }> {
  if (!API_KEY) {
    throw new GeminiFilesApiError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
      500
    );
  }

  const params = new URLSearchParams({
    key: API_KEY,
    pageSize: String(pageSize),
  });
  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const response = await fetch(`${BASE_URL}/v1beta/files?${params}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new GeminiFilesApiError(
      `Failed to list files: ${response.status}`,
      response.status,
      errorText
    );
  }

  return response.json() as Promise<{
    files: GeminiFile[];
    nextPageToken?: string;
  }>;
}

/**
 * Check if a URL is a YouTube video URL
 */
export function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com/watch") || url.includes("youtu.be/");
}

/**
 * Check if a URL is a Gemini Files API URI
 */
export function isGeminiFileUri(url: string): boolean {
  return url.startsWith("https://generativelanguage.googleapis.com/v1beta/files/");
}
