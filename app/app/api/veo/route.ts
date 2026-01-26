import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";
import { parseGoogleServiceAccount, assertGoogleCredentials } from "@/app/lib/server/google-cloud";

export const runtime = "nodejs";

const PROJECT_ID = process.env.VEO_PROJECT_ID;
const LOCATION = process.env.VEO_LOCATION || "us-central1";
const MODEL_ID = process.env.VEO_MODEL_ID || "veo-3.0-generate-001";

const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;
const PREDICT_URL = `${BASE_URL}:predictLongRunning`;
const FETCH_URL = `${BASE_URL}:fetchPredictOperation`;

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 30;

interface MediaInput {
  data?: string;
  mimeType?: string;
}

interface ReferenceImageInput extends MediaInput {
  referenceType?: string;
}

function normalizeBase64(value?: string) {
  if (!value) return undefined;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return value.trim();
  return value.slice(commaIndex + 1).trim();
}

function toVeoMedia(media?: MediaInput) {
  if (!media?.mimeType) return undefined;
  const normalized = normalizeBase64(media.data);
  if (!normalized) return undefined;
  return {
    bytesBase64Encoded: normalized,
    mimeType: media.mimeType,
  };
}

const VEO_SERVICE_ACCOUNT_ENV = ["VEO_SERVICE_ACCOUNT_KEY"] as const;

function assertEnv() {
  if (!PROJECT_ID) {
    throw new Error("VEO_PROJECT_ID is not configured");
  }
  assertGoogleCredentials({ preferredEnvVars: [...VEO_SERVICE_ACCOUNT_ENV] });
}

async function getAccessToken() {
  assertEnv();
  const creds = parseGoogleServiceAccount({ preferredEnvVars: [...VEO_SERVICE_ACCOUNT_ENV] });
  console.log("[VEO] using service account", creds.client_email, "project", creds.project_id);
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
  console.log("[VEO] token prefix", token.slice(0, 10));
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
      throw new Error(`Failed to fetch Veo operation status: ${text}`);
    }

    const payload = (await response.json()) as {
      done?: boolean;
      response?: {
        videos?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
      };
      error?: { message?: string };
    };

    if (payload.error) {
      throw new Error(payload.error.message || "Veo returned an error");
    }

    if (payload.done) {
      return payload.response;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for Veo video generation");
}

export async function POST(request: NextRequest) {
  try {
    const {
      prompt,
      durationSeconds = 8,
      aspectRatio = "16:9",
      resolution = "720p",
      generateAudio = true,
      resizeMode,
      image,
      lastFrame,
      video,
      referenceImages,
      negativePrompt,
      personGeneration,
      projectId,
    } = (await request.json()) as {
      prompt?: string;
      durationSeconds?: 4 | 6 | 8;
      aspectRatio?: "16:9" | "9:16";
      resolution?: "720p" | "1080p" | "4k";
      generateAudio?: boolean;
      resizeMode?: "pad" | "crop";
      image?: MediaInput;
      lastFrame?: MediaInput;
      video?: MediaInput;
      referenceImages?: ReferenceImageInput[];
      negativePrompt?: string;
      personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
      projectId?: string;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const requiresEightSeconds =
      Boolean(video) || Boolean(referenceImages?.length) || resolution === "1080p" || resolution === "4k";
    if (requiresEightSeconds && durationSeconds !== 8) {
      return NextResponse.json(
        { error: "Veo requires an 8 second duration for the selected inputs/resolution." },
        { status: 400 }
      );
    }

    if (video && resolution !== "720p") {
      return NextResponse.json(
        { error: "Video extension currently supports 720p output only." },
        { status: 400 }
      );
    }

    if (lastFrame && !image) {
      return NextResponse.json(
        { error: "A starting image is required when specifying a last frame." },
        { status: 400 }
      );
    }

    if (referenceImages && referenceImages.length > 3) {
      return NextResponse.json(
        { error: "Veo 3.1 supports up to 3 reference images." },
        { status: 400 }
      );
    }

    assertEnv();
    const token = await getAccessToken();

    const instance: Record<string, unknown> = {
      prompt: prompt.trim(),
    };

    const instanceImage = toVeoMedia(image);
    if (instanceImage) {
      instance.image = instanceImage;
    }

    const lastFrameMedia = toVeoMedia(lastFrame);
    if (lastFrameMedia) {
      instance.lastFrame = lastFrameMedia;
    }

    const videoMedia = toVeoMedia(video);
    if (videoMedia) {
      instance.video = videoMedia;
    }

    if (referenceImages?.length) {
      instance.referenceImages = referenceImages
        .map((ref) => {
          const media = toVeoMedia(ref);
          if (!media) return null;
          return {
            image: media,
            referenceType: ref.referenceType ?? "asset",
          };
        })
        .filter((value): value is { image: { bytesBase64Encoded: string; mimeType: string }; referenceType: string } =>
          Boolean(value)
        );
    }

    const parameters: Record<string, unknown> = {
      durationSeconds,
      aspectRatio,
      resolution,
      generateAudio,
      sampleCount: 1,
    };

    if (resizeMode && instanceImage) {
      parameters.resizeMode = resizeMode;
    }

    if (negativePrompt?.trim()) {
      parameters.negativePrompt = negativePrompt.trim();
    }

    if (personGeneration) {
      parameters.personGeneration = personGeneration;
    }

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
      return NextResponse.json(
        { error: `Veo request failed: ${errorText}` },
        { status: predictResponse.status }
      );
    }

    const predictPayload = (await predictResponse.json()) as { name?: string };
    if (!predictPayload.name) {
      return NextResponse.json({ error: "Veo did not return an operation name" }, { status: 500 });
    }

    const finalResponse = await pollOperation(token, predictPayload.name);
    const firstVideo = finalResponse?.videos?.[0];

    if (!firstVideo?.bytesBase64Encoded) {
      return NextResponse.json({ error: "Veo response did not contain video data" }, { status: 500 });
    }

    const buffer = Buffer.from(firstVideo.bytesBase64Encoded, "base64");
    const mimeType = firstVideo.mimeType || "video/mp4";
    const asset = await saveBufferAsAsset({
      data: buffer,
      mimeType,
      originalName: `veo-${Date.now()}.mp4`,
      projectId,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error("Veo generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
