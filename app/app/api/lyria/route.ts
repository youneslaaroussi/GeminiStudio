import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";
import { parseGoogleServiceAccount, assertGoogleCredentials } from "@/app/lib/server/google-cloud";

export const runtime = "nodejs";

const PROJECT_ID = process.env.LYRIA_PROJECT_ID || process.env.VEO_PROJECT_ID;
const LOCATION = process.env.LYRIA_LOCATION || "us-central1";
const MODEL_ID = "lyria-002";

const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;
const PREDICT_URL = `${BASE_URL}:predictLongRunning`;
const FETCH_URL = `${BASE_URL}:fetchPredictOperation`;

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes max wait

const LYRIA_SERVICE_ACCOUNT_ENV = ["LYRIA_SERVICE_ACCOUNT_KEY", "VEO_SERVICE_ACCOUNT_KEY"] as const;

function assertEnv() {
  if (!PROJECT_ID) {
    throw new Error("LYRIA_PROJECT_ID (or VEO_PROJECT_ID) is not configured");
  }
  assertGoogleCredentials({ preferredEnvVars: [...LYRIA_SERVICE_ACCOUNT_ENV] });
}

async function getAccessToken() {
  assertEnv();
  const creds = parseGoogleServiceAccount({ preferredEnvVars: [...LYRIA_SERVICE_ACCOUNT_ENV] });
  console.log("[LYRIA] using service account", creds.client_email, "project", creds.project_id);
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token || null;
  if (!token) {
    throw new Error("Unable to acquire Google Cloud access token");
  }
  return token;
}

async function pollOperation(token: string, operationName: string) {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const response = await fetch(FETCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operationName }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch Lyria operation status: ${text}`);
    }

    const payload = (await response.json()) as {
      done?: boolean;
      response?: {
        audioSamples?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
      };
      error?: { message?: string };
    };

    if (payload.error) {
      throw new Error(payload.error.message || "Lyria returned an error");
    }

    if (payload.done) {
      return payload.response;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for Lyria music generation");
}

export async function POST(request: NextRequest) {
  try {
    const {
      prompt,
      negativePrompt,
      sampleCount,
      seed,
      projectId,
    } = (await request.json()) as {
      prompt?: string;
      negativePrompt?: string;
      sampleCount?: number;
      seed?: number;
      projectId?: string;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Cannot use both seed and sampleCount
    if (seed !== undefined && sampleCount !== undefined && sampleCount > 1) {
      return NextResponse.json(
        { error: "Cannot use seed with multiple samples. Set sample count to 1 when using a seed." },
        { status: 400 }
      );
    }

    assertEnv();
    const token = await getAccessToken();

    const instance: Record<string, unknown> = {
      prompt: prompt.trim(),
    };

    if (negativePrompt?.trim()) {
      instance.negativePrompt = negativePrompt.trim();
    }

    const parameters: Record<string, unknown> = {};

    if (sampleCount !== undefined) {
      parameters.sampleCount = Math.min(Math.max(1, sampleCount), 4);
    }

    if (seed !== undefined) {
      parameters.seed = seed;
    }

    console.log("[LYRIA] Request:", { prompt: prompt.slice(0, 100), negativePrompt, sampleCount, seed });

    const predictResponse = await fetch(PREDICT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [instance],
        parameters,
      }),
    });

    if (!predictResponse.ok) {
      const errorText = await predictResponse.text();
      console.error("[LYRIA] Request failed:", errorText);
      return NextResponse.json(
        { error: `Lyria request failed: ${errorText}` },
        { status: predictResponse.status }
      );
    }

    const predictPayload = (await predictResponse.json()) as { name?: string };
    if (!predictPayload.name) {
      return NextResponse.json({ error: "Lyria did not return an operation name" }, { status: 500 });
    }

    console.log("[LYRIA] Operation started:", predictPayload.name);

    const finalResponse = await pollOperation(token, predictPayload.name);
    const audioSamples = finalResponse?.audioSamples ?? [];

    if (audioSamples.length === 0 || !audioSamples[0]?.bytesBase64Encoded) {
      return NextResponse.json({ error: "Lyria response did not contain audio data" }, { status: 500 });
    }

    // Save the first audio sample as an asset
    const firstAudio = audioSamples[0];
    const buffer = Buffer.from(firstAudio.bytesBase64Encoded!, "base64");
    const mimeType = firstAudio.mimeType || "audio/wav";
    const extension = mimeType === "audio/wav" ? ".wav" : ".mp3";

    const asset = await saveBufferAsAsset({
      data: buffer,
      mimeType,
      originalName: `lyria-${Date.now()}${extension}`,
      projectId,
    });

    console.log("[LYRIA] Generated audio asset:", asset.id);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error("Lyria generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
