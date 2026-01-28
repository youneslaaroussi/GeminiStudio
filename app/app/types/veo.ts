export type VeoJobStatus = "pending" | "running" | "completed" | "error";

export interface VeoJobParams {
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  resolution: "720p" | "1080p" | "4k";
  generateAudio: boolean;
  resizeMode?: "pad" | "crop";
  negativePrompt?: string;
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  projectId?: string;
  // Base64 encoded media inputs
  image?: { data?: string; mimeType?: string };
  lastFrame?: { data?: string; mimeType?: string };
  video?: { data?: string; mimeType?: string };
  referenceImages?: Array<{ data?: string; mimeType?: string; referenceType?: string }>;
}

export interface VeoJob {
  id: string;
  status: VeoJobStatus;
  params: VeoJobParams;
  resultAssetId?: string;
  resultAssetUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredVeoJob extends VeoJob {
  operationName?: string;
}
