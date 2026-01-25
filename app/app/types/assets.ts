export type AssetType = "video" | "audio" | "image" | "other";

export interface RemoteAsset {
  id: string;
  name: string;
  url: string;
  type: AssetType;
  mimeType: string;
  size: number;
  uploadedAt: string;
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
