/**
 * Gemini Multimodal Utilities
 *
 * Reusable utilities for preparing multimodal content for Gemini API requests.
 * Handles uploading files to GCS and converting them to Gemini-compatible format.
 */

import crypto from "crypto";
import { uploadToGcs } from "../gcs-upload";
import {
  type ChatAttachment,
  type GeminiContentPart,
  type MediaCategory,
  type AttachmentProcessingConfig,
  type ProcessedAttachment,
  type MediaResolution,
  GEMINI_SUPPORTED_MIME_TYPES,
} from "./types";

// Re-export types for convenience
export * from "./types";

/** Default max size for inline encoding (4MB) */
const DEFAULT_MAX_INLINE_SIZE = 4 * 1024 * 1024;

/** Default GCS path prefix for chat attachments */
const DEFAULT_GCS_PATH_PREFIX = "chat-attachments";

/**
 * Determine the media category from a MIME type
 */
export function getMediaCategory(mimeType: string): MediaCategory {
  const normalized = mimeType.toLowerCase();

  if (GEMINI_SUPPORTED_MIME_TYPES.image.some((t) => normalized.startsWith(t.split("/")[0]) && normalized.includes(t.split("/")[1]))) {
    return "image";
  }
  if (normalized.startsWith("image/")) {
    return "image";
  }

  if (GEMINI_SUPPORTED_MIME_TYPES.video.some((t) => normalized === t) || normalized.startsWith("video/")) {
    return "video";
  }

  if (GEMINI_SUPPORTED_MIME_TYPES.audio.some((t) => normalized === t) || normalized.startsWith("audio/")) {
    return "audio";
  }

  if (GEMINI_SUPPORTED_MIME_TYPES.document.some((t) => normalized === t)) {
    return "document";
  }

  // Check for text-based documents
  if (normalized.startsWith("text/")) {
    return "document";
  }

  return "unknown";
}

/**
 * Check if a MIME type is supported by Gemini
 */
export function isSupportedMimeType(mimeType: string): boolean {
  const category = getMediaCategory(mimeType);
  return category !== "unknown";
}

/**
 * Get a normalized MIME type that Gemini will accept
 * Some MIME types need to be mapped to their Gemini-compatible equivalents
 */
export function normalizeGeminiMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();

  // Map common variations
  const mimeMap: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/x-m4a": "audio/m4a",
    "video/x-msvideo": "video/mp4",
    "image/jpg": "image/jpeg",
  };

  return mimeMap[normalized] ?? normalized;
}

/**
 * Generate a unique file path for GCS upload
 */
export function generateGcsPath(
  sessionId: string,
  fileName: string,
  prefix = DEFAULT_GCS_PATH_PREFIX
): string {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${prefix}/${sessionId}/${timestamp}-${randomSuffix}-${safeFileName}`;
}

/**
 * Create a chat attachment from a file buffer
 */
export function createAttachmentFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Omit<ChatAttachment, "id" | "uploadedAt" | "gcsUri" | "localUrl" | "signedUrl" | "inlineData"> {
  return {
    name: fileName,
    mimeType: normalizeGeminiMimeType(mimeType),
    size: buffer.byteLength,
    category: getMediaCategory(mimeType),
  };
}

interface PrepareAttachmentOptions {
  /** The file data */
  data: Buffer;
  /** Original filename */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** Session/conversation ID for organizing uploads */
  sessionId: string;
  /** Processing configuration */
  config?: AttachmentProcessingConfig;
}

/**
 * Prepare an attachment for use with Gemini
 *
 * This function handles:
 * - Determining whether to use inline data or GCS upload
 * - Uploading to GCS for large files
 * - Converting to Gemini-compatible content parts
 *
 * @example
 * ```ts
 * const { attachment, geminiPart } = await prepareAttachment({
 *   data: fileBuffer,
 *   fileName: "photo.jpg",
 *   mimeType: "image/jpeg",
 *   sessionId: "chat-123",
 * });
 * ```
 */
export async function prepareAttachment({
  data,
  fileName,
  mimeType,
  sessionId,
  config = {},
}: PrepareAttachmentOptions): Promise<ProcessedAttachment> {
  const {
    maxInlineSize = DEFAULT_MAX_INLINE_SIZE,
    uploadToGcs: shouldUpload = true,
    gcsPathPrefix = DEFAULT_GCS_PATH_PREFIX,
    generateSignedUrls = true,
    mediaResolution = "MEDIA_RESOLUTION_MEDIUM",
  } = config;

  const normalizedMimeType = normalizeGeminiMimeType(mimeType);
  const category = getMediaCategory(normalizedMimeType);
  const id = crypto.randomUUID();

  // For small files, use inline data
  const useInline = data.byteLength <= maxInlineSize && category !== "video";

  const attachment: ChatAttachment = {
    id,
    name: fileName,
    mimeType: normalizedMimeType,
    size: data.byteLength,
    category,
    uploadedAt: new Date().toISOString(),
  };

  let geminiPart: GeminiContentPart;

  if (useInline && !shouldUpload) {
    // Use inline base64 data
    const base64Data = data.toString("base64");
    attachment.inlineData = base64Data;

    geminiPart = {
      inlineData: {
        data: base64Data,
        mimeType: normalizedMimeType,
      },
    };
  } else if (shouldUpload) {
    // Upload to GCS
    const destination = generateGcsPath(sessionId, fileName, gcsPathPrefix);
    const uploadResult = await uploadToGcs({
      data,
      mimeType: normalizedMimeType,
      destination,
      generateSignedUrl: generateSignedUrls,
    });

    attachment.gcsUri = uploadResult.gcsUri;
    if (uploadResult.signedUrl) {
      attachment.signedUrl = uploadResult.signedUrl;
    }

    geminiPart = {
      fileData: {
        fileUri: uploadResult.gcsUri,
        mimeType: normalizedMimeType,
      },
    };

    // Add media resolution for supported types
    if (category === "image" || category === "video" || category === "document") {
      (geminiPart as { mediaResolution?: { level: MediaResolution } }).mediaResolution = {
        level: mediaResolution,
      };
    }
  } else {
    // Fallback to inline for files that can't be uploaded
    const base64Data = data.toString("base64");
    attachment.inlineData = base64Data;

    geminiPart = {
      inlineData: {
        data: base64Data,
        mimeType: normalizedMimeType,
      },
    };
  }

  return { attachment, geminiPart };
}

/**
 * Convert an existing attachment to a Gemini content part
 *
 * Use this when you have an attachment that was already processed
 * and stored, and you need to include it in a new Gemini request.
 */
export function attachmentToGeminiPart(
  attachment: ChatAttachment,
  mediaResolution: MediaResolution = "MEDIA_RESOLUTION_MEDIUM"
): GeminiContentPart {
  // Prefer GCS URI if available
  if (attachment.gcsUri || attachment.signedUrl) {
    const fileUri =
      attachment.signedUrl ??
      (attachment.gcsUri
        ? gcsUriToHttpsUrl(attachment.gcsUri)
        : undefined);

    if (!fileUri) {
      throw new Error(
        `Attachment ${attachment.id} has a GCS URI that cannot be converted to HTTPS`
      );
    }

    const part: GeminiContentPart = {
      fileData: {
        fileUri,
        mimeType: attachment.mimeType,
      },
    };

    // Add media resolution for supported types
    if (
      attachment.category === "image" ||
      attachment.category === "video" ||
      attachment.category === "document"
    ) {
      (part as { mediaResolution?: { level: MediaResolution } }).mediaResolution = {
        level: mediaResolution,
      };
    }

    return part;
  }

  // Fall back to inline data
  if (attachment.inlineData) {
    return {
      inlineData: {
        data: attachment.inlineData,
        mimeType: attachment.mimeType,
      },
    };
  }

  throw new Error(
    `Attachment ${attachment.id} has no GCS URI or inline data available`
  );
}

function gcsUriToHttpsUrl(gcsUri: string): string | undefined {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gcsUri);
  if (!match) return undefined;

  const [, bucket, objectName] = match;
  const encodedObjectName = objectName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://storage.googleapis.com/${bucket}/${encodedObjectName}`;
}

/**
 * Prepare multiple attachments in parallel
 */
export async function prepareAttachments(
  files: Array<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }>,
  sessionId: string,
  config?: AttachmentProcessingConfig
): Promise<ProcessedAttachment[]> {
  return Promise.all(
    files.map((file) =>
      prepareAttachment({
        data: file.data,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sessionId,
        config,
      })
    )
  );
}

/**
 * Build Gemini content parts from attachments and text
 *
 * Following Gemini best practices:
 * - Single media: place media before text
 * - Multiple media: can be interleaved or placed before text
 */
export function buildGeminiContentParts(
  text: string,
  attachments: ChatAttachment[],
  mediaResolution?: MediaResolution
): GeminiContentPart[] {
  const parts: GeminiContentPart[] = [];

  // Add media parts first (Gemini best practice)
  for (const attachment of attachments) {
    parts.push(attachmentToGeminiPart(attachment, mediaResolution));
  }

  // Add text part
  if (text.trim()) {
    parts.push({ text });
  }

  return parts;
}

/**
 * Estimate token count for media
 *
 * Based on Gemini documentation:
 * - Images: ~560-1120 tokens per image depending on resolution
 * - Video: ~70 tokens per frame at 1 FPS
 * - Audio: varies by duration
 * - PDFs: ~560 tokens per page
 */
export function estimateMediaTokens(
  attachment: ChatAttachment,
  resolution: MediaResolution = "MEDIA_RESOLUTION_MEDIUM"
): number {
  const tokensPerResolution: Record<MediaResolution, number> = {
    MEDIA_RESOLUTION_LOW: 280,
    MEDIA_RESOLUTION_MEDIUM: 560,
    MEDIA_RESOLUTION_HIGH: 1120,
    MEDIA_RESOLUTION_UNSPECIFIED: 560,
  };

  switch (attachment.category) {
    case "image":
      return tokensPerResolution[resolution];
    case "video":
      // Rough estimate: assume 30 second video at 1 FPS
      // ~70 tokens per frame
      return 30 * 70;
    case "audio":
      // Rough estimate based on file size
      // ~25 tokens per second, estimate ~1MB = 60 seconds
      return Math.ceil((attachment.size / (1024 * 1024)) * 60 * 25);
    case "document":
      // Estimate ~560 tokens per page, ~50KB per page
      return Math.ceil((attachment.size / (50 * 1024)) * 560);
    default:
      return 0;
  }
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/m4a": ".m4a",
    "audio/flac": ".flac",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };

  return extensions[mimeType.toLowerCase()] ?? "";
}
