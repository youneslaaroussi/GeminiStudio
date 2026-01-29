import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { uploadToAssetService, isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";

export const runtime = "nodejs";

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const BANANA_MODEL = process.env.BANANA_MODEL_ID || "gemini-3-pro-image-preview";

interface BananaSourceImage {
  data?: string;
  mimeType?: string;
}

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

function normalizeBase64(value?: string) {
  if (!value) return undefined;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return value.trim();
  return value.slice(commaIndex + 1).trim();
}

function getImageExtension(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

export async function POST(request: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  if (!isAssetServiceEnabled()) {
    return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { prompt, aspectRatio = "1:1", imageSize = "1K", sourceImage, projectId } = (await request.json()) as {
      prompt?: string;
      aspectRatio?: string;
      imageSize?: "1K" | "2K" | "4K";
      sourceImage?: BananaSourceImage;
      projectId?: string;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const normalizedSource = sourceImage?.mimeType
      ? {
          mimeType: sourceImage.mimeType,
          data: normalizeBase64(sourceImage.data),
        }
      : undefined;

    if (normalizedSource && !normalizedSource.data) {
      return NextResponse.json({ error: "Source image data is invalid" }, { status: 400 });
    }

    const cost = getCreditsForAction("image_generation");
    try {
      await deductCredits(userId, cost, "image_generation");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Insufficient credits";
      return NextResponse.json({ error: msg, required: cost }, { status: 402 });
    }

    const parts = [] as Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>;
    parts.push({ text: prompt.trim() });
    if (normalizedSource) {
      parts.push({ inlineData: { data: normalizedSource.data!, mimeType: normalizedSource.mimeType } });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${BANANA_MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio,
              imageSize,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: text }, { status: response.status });
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data?: string; mimeType?: string };
          }>;
        };
      }>;
    };

    const inlineData = payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts || [])
      .find((part) => part.inlineData?.data);

    if (!inlineData?.inlineData?.data) {
      return NextResponse.json(
        { error: "Gemini Banana Pro did not return image data" },
        { status: 500 }
      );
    }

    const mimeType = inlineData.inlineData.mimeType || "image/png";
    const buffer = Buffer.from(inlineData.inlineData.data, "base64");
    const extension = getImageExtension(mimeType);
    const fileName = `banana-${Date.now()}${extension}`;

    const file = new File([buffer], fileName, { type: mimeType });
    const result = await uploadToAssetService(userId, projectId, file, {
      source: "banana",
      runPipeline: true,
    });

    console.log("[Banana] Generated image asset:", result.asset.id);

    return NextResponse.json({ asset: result.asset }, { status: 201 });
  } catch (error) {
    console.error("Banana Pro generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
