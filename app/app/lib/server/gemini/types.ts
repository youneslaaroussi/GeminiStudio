/**
 * Gemini Multimodal Types
 *
 * Types for working with multimodal content in Gemini API requests.
 * These types map to the Gemini API's expected format for different media types.
 */

/**
 * Supported MIME types for different media categories in Gemini
 */
export const GEMINI_SUPPORTED_MIME_TYPES = {
  image: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
  ],
  video: [
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-flv",
    "video/mpeg",
    "video/mpg",
    "video/wmv",
    "video/3gpp",
  ],
  audio: [
    "audio/x-aac",
    "audio/aac",
    "audio/flac",
    "audio/mp3",
    "audio/mpeg",
    "audio/m4a",
    "audio/mp4",
    "audio/ogg",
    "audio/pcm",
    "audio/wav",
    "audio/webm",
  ],
  document: [
    "application/pdf",
    "text/plain",
  ],
} as const;

export type GeminiImageMimeType = (typeof GEMINI_SUPPORTED_MIME_TYPES.image)[number];
export type GeminiVideoMimeType = (typeof GEMINI_SUPPORTED_MIME_TYPES.video)[number];
export type GeminiAudioMimeType = (typeof GEMINI_SUPPORTED_MIME_TYPES.audio)[number];
export type GeminiDocumentMimeType = (typeof GEMINI_SUPPORTED_MIME_TYPES.document)[number];
export type GeminiSupportedMimeType =
  | GeminiImageMimeType
  | GeminiVideoMimeType
  | GeminiAudioMimeType
  | GeminiDocumentMimeType;

/**
 * Media category based on MIME type
 */
export type MediaCategory = "image" | "video" | "audio" | "document" | "unknown";

/**
 * Options for media resolution in Gemini requests
 * Higher resolution = more tokens but better quality
 */
export type MediaResolution =
  | "MEDIA_RESOLUTION_LOW"
  | "MEDIA_RESOLUTION_MEDIUM"
  | "MEDIA_RESOLUTION_HIGH"
  | "MEDIA_RESOLUTION_UNSPECIFIED";

/**
 * File data for Gemini API - references a file in GCS or via URL
 */
export interface GeminiFileData {
  fileUri: string;
  mimeType: string;
}

/**
 * Inline data for Gemini API - base64 encoded content
 */
export interface GeminiInlineData {
  data: string; // base64 encoded
  mimeType: string;
}

/**
 * A content part that can be sent to Gemini
 */
export interface GeminiFilePart {
  fileData: GeminiFileData;
  mediaResolution?: {
    level: MediaResolution;
  };
}

export interface GeminiInlinePart {
  inlineData: GeminiInlineData;
}

export interface GeminiTextPart {
  text: string;
}

export type GeminiContentPart = GeminiFilePart | GeminiInlinePart | GeminiTextPart;

/**
 * Attachment metadata stored with chat messages
 */
export interface ChatAttachment {
  /** Unique identifier */
  id: string;
  /** Original filename */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Media category */
  category: MediaCategory;
  /** GCS URI if uploaded to cloud storage */
  gcsUri?: string;
  /** Local URL for display (e.g., /uploads/...) */
  localUrl?: string;
  /** Signed URL for temporary access */
  signedUrl?: string;
  /** Base64 data for small inline files */
  inlineData?: string;
  /** Thumbnail URL for preview */
  thumbnailUrl?: string;
  /** Upload timestamp */
  uploadedAt: string;
}

/**
 * Configuration for how attachments should be processed
 */
export interface AttachmentProcessingConfig {
  /** Maximum file size in bytes for inline encoding (default: 4MB) */
  maxInlineSize?: number;
  /** Whether to upload to GCS (default: true for large files) */
  uploadToGcs?: boolean;
  /** GCS bucket to use (default: ASSET_GCS_BUCKET env var) */
  bucket?: string;
  /** GCS path prefix (default: "chat-attachments") */
  gcsPathPrefix?: string;
  /** Whether to generate signed URLs (default: true) */
  generateSignedUrls?: boolean;
  /** Media resolution for Gemini (default: MEDIA_RESOLUTION_MEDIUM) */
  mediaResolution?: MediaResolution;
}

/**
 * Result of processing an attachment for Gemini
 */
export interface ProcessedAttachment {
  /** The original attachment metadata */
  attachment: ChatAttachment;
  /** The Gemini-compatible content part */
  geminiPart: GeminiContentPart;
}

/**
 * Video metadata options for Gemini
 */
export interface VideoMetadata {
  /** Start offset in seconds */
  startOffset?: number;
  /** End offset in seconds */
  endOffset?: number;
  /** Frames per second for sampling */
  fps?: number;
}
