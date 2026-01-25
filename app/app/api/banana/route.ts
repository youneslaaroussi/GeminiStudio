import { NextRequest, NextResponse } from "next/server";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";

export const runtime = "nodejs";

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const BANANA_MODEL = process.env.BANANA_MODEL_ID || "gemini-3-pro-image-preview";

interface BananaSourceImage {
  data?: string;
  mimeType?: string;
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

  try {
    const { prompt, aspectRatio = "1:1", imageSize = "1K", sourceImage } = (await request.json()) as {
      prompt?: string;
      aspectRatio?: string;
      imageSize?: "1K" | "2K" | "4K";
      sourceImage?: BananaSourceImage;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
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
    const asset = await saveBufferAsAsset({
      data: buffer,
      mimeType,
      originalName: `banana-${Date.now()}${extension}`,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error("Banana Pro generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
