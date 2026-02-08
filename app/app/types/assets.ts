export type AssetType = "video" | "audio" | "image" | "component" | "other";

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
  // Component asset fields (only present when type === "component")
  code?: string; // Motion Canvas TSX source code
  componentName?: string; // Exported class name
  inputDefs?: ComponentInputDef[]; // Input definitions
}

/** Input definition for a custom component */
export interface ComponentInputDef {
  /** Input name (used as prop key) */
  name: string;
  /** Type of the input */
  type: 'string' | 'number' | 'boolean' | 'color' | 'enum';
  /** Default value (for enum, must be one of options) */
  default: string | number | boolean;
  /** Optional label for UI */
  label?: string;
  /** For type "enum": list of allowed options the user can choose from */
  options?: string[];
}

export interface AssetDragPayload {
  id: string;
  name: string;
  url: string;
  type: AssetType;
  duration?: number;
  width?: number;
  height?: number;
  // Component asset fields (for drag-to-timeline)
  componentName?: string;
  inputDefs?: ComponentInputDef[];
}

export const ASSET_DRAG_DATA_MIME = "application/x-gemini-asset";

export const DEFAULT_ASSET_DURATIONS: Record<AssetType, number> = {
  video: 10,
  audio: 15,
  image: 5,
  component: 5,
  other: 5,
};

export function defaultAssetDuration(type: AssetType) {
  return DEFAULT_ASSET_DURATIONS[type] ?? 5;
}
