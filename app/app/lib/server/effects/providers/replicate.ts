import type { VideoEffectStatus } from "@/app/types/video-effects";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const API_BASE_URL = "https://api.replicate.com/v1";

export interface ReplicatePrediction {
  id: string;
  status: string;
  output?: unknown;
  error?: string | null;
  urls?: {
    get?: string;
    stream?: string;
  };
  metrics?: Record<string, unknown>;
}

export class ReplicateProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ReplicateProviderError";
  }
}

function getHeaders() {
  if (!REPLICATE_API_TOKEN) {
    throw new ReplicateProviderError(
      "REPLICATE_API_TOKEN is not configured in the environment"
    );
  }
  return {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function createReplicatePrediction(options: {
  version: string;
  input: Record<string, unknown>;
}): Promise<ReplicatePrediction> {
  const response = await fetch(`${API_BASE_URL}/predictions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      version: options.version,
      input: options.input,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ReplicateProviderError(
      `Failed to create prediction (${response.status}): ${text}`
    );
  }

  const payload = (await response.json()) as ReplicatePrediction;
  return payload;
}

export async function getReplicatePrediction(predictionId: string) {
  const response = await fetch(`${API_BASE_URL}/predictions/${predictionId}`, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ReplicateProviderError(
      `Failed to fetch prediction (${response.status}): ${text}`
    );
  }

  const payload = (await response.json()) as ReplicatePrediction;
  return payload;
}

export function mapReplicateStatus(status: string): VideoEffectStatus {
  if (status === "starting" || status === "processing") return "running";
  if (status === "succeeded") return "completed";
  if (status === "failed" || status === "canceled") return "error";
  return "pending";
}
