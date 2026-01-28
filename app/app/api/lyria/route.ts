import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import { parseGoogleServiceAccount, assertGoogleCredentials } from "@/app/lib/server/google-cloud";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { uploadToAssetService, isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";

export const runtime = "nodejs";

const PROJECT_ID = process.env.LYRIA_PROJECT_ID || process.env.VEO_PROJECT_ID;
const LOCATION = process.env.LYRIA_LOCATION || "us-central1";
const MODEL_ID = "lyria-002";

const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;
const PREDICT_URL = `${BASE_URL}:predict`;

const LYRIA_SERVICE_ACCOUNT_ENV = ["LYRIA_SERVICE_ACCOUNT_KEY", "VEO_SERVICE_ACCOUNT_KEY"] as const;

async function verifyToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

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

export async function POST(request: NextRequest) {
  try {
    if (!isAssetServiceEnabled()) {
      return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
    }

    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
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

    // Build instance object per Lyria API spec
    const instance: Record<string, unknown> = {
      prompt: prompt.trim(),
    };

    // Use snake_case as per API spec
    if (negativePrompt?.trim()) {
      instance.negative_prompt = negativePrompt.trim();
    }

    // seed goes in instance, not parameters
    if (seed !== undefined) {
      instance.seed = seed;
    }

    // sample_count goes in parameters (snake_case)
    const parameters: Record<string, unknown> = {};
    if (sampleCount !== undefined && seed === undefined) {
      parameters.sample_count = Math.min(Math.max(1, sampleCount), 4);
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

    const predictPayload = (await predictResponse.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };

    const predictions = predictPayload.predictions ?? [];

    if (predictions.length === 0 || !predictions[0]?.bytesBase64Encoded) {
      return NextResponse.json({ error: "Lyria response did not contain audio data" }, { status: 500 });
    }

    // Save the first audio sample as an asset via asset service
    const firstAudio = predictions[0];
    console.log("[LYRIA] Generation complete, mimeType:", firstAudio.mimeType);

    const buffer = Buffer.from(firstAudio.bytesBase64Encoded!, "base64");
    console.log("[LYRIA] Audio buffer size:", buffer.length, "bytes");

    // Lyria outputs WAV at 48kHz
    const mimeType = "audio/wav";
    const fileName = `lyria-${Date.now()}.wav`;

    const file = new File([buffer], fileName, { type: mimeType });
    const result = await uploadToAssetService(userId, projectId, file, {
      source: "lyria",
      runPipeline: true,
    });

    console.log("[LYRIA] Generated audio asset:", result.asset.id);

    return NextResponse.json({ asset: result.asset }, { status: 201 });
  } catch (error) {
    console.error("Lyria generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
