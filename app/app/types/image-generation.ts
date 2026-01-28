export type ImageGenerationJobStatus = "pending" | "generating" | "completed" | "error";

export interface ImageGenerationJobParams {
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  imageSize: "1K" | "2K" | "4K";
  sourceImage?: { data?: string; mimeType?: string };
  projectId: string;
}

export interface ImageGenerationJob {
  id: string;
  status: ImageGenerationJobStatus;
  params: ImageGenerationJobParams;
  progress?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
