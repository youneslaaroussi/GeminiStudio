export type TranscriptionStatus = "pending" | "processing" | "completed" | "error";

export interface TranscriptionSegment {
  start: number;
  speech: string;
}

export interface ProjectTranscription {
  assetId: string;
  assetName: string;
  assetUrl: string;
  jobId?: string;
  transcript?: string;
  error?: string;
  languageCodes: string[];
  status: TranscriptionStatus;
  createdAt: string;
  updatedAt: string;
  segments?: TranscriptionSegment[];
}
