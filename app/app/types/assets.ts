export type AssetType = "video" | "audio" | "image" | "other";

export type TranscodeStatus = "pending" | "processing" | "completed" | "error";

export interface RemoteAsset {
  id: string;
  name: string;
  url: string;
  type: AssetType;
  mimeType: string;
  size: number;
  uploadedAt: string;
  projectId?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  gcsUri?: string;
  signedUrl?: string;
  description?: string; // AI-generated short description
  notes?: string; // User notes (what the asset is for)
  // Transcode status (set when transcoding is triggered)
  transcodeStatus?: TranscodeStatus;
  transcodeError?: string; // Error message if transcodeStatus is "error"
}

export interface AssetDragPayload {
  id: string;
  name: string;
  url: string;
  type: AssetType;
  duration?: number;
  width?: number;
  height?: number;
}

export const ASSET_DRAG_DATA_MIME = "application/x-gemini-asset";

export const DEFAULT_ASSET_DURATIONS: Record<AssetType, number> = {
  video: 10,
  audio: 15,
  image: 5,
  other: 5,
};

export function defaultAssetDuration(type: AssetType) {
  return DEFAULT_ASSET_DURATIONS[type] ?? 5;
}
