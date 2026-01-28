import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { synthesizeSpeech, type SupportedTtsEncoding } from "@/app/lib/services/tts";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { uploadToAssetService, isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    text: z.string().trim().max(5000).optional(),
    ssml: z.string().trim().max(10000).optional(),
    voiceName: z.string().min(1, "Voice name is required"),
    languageCode: z.string().min(2, "Language code is required"),
    speakingRate: z.number().min(0.25).max(2).optional(),
    audioEncoding: z.union([z.literal("mp3"), z.literal("ogg_opus"), z.literal("linear16")]).optional(),
    fileName: z.string().trim().max(200).optional(),
    projectId: z.string().trim().min(1, "projectId is required"),
  })
  .refine((value) => value.text || value.ssml, {
    message: "Provide either text or ssml content to synthesize.",
    path: ["text"],
  });

const ENCODING_METADATA: Record<SupportedTtsEncoding, { extension: string; mimeType: string }> = {
  mp3: { extension: ".mp3", mimeType: "audio/mpeg" },
  ogg_opus: { extension: ".ogg", mimeType: "audio/ogg" },
  linear16: { extension: ".wav", mimeType: "audio/wav" },
};

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

function buildFileName(baseName: string, encoding: SupportedTtsEncoding) {
  const { extension } = ENCODING_METADATA[encoding];
  const trimmed = baseName.replace(/[\\/:*?"<>|]+/g, "").slice(0, 120).trim();
  const fallback = `tts-${Date.now()}`;
  const name = trimmed.length ? trimmed : fallback;
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = requestSchema.parse(await request.json());
    const encoding: SupportedTtsEncoding = payload.audioEncoding ?? "mp3";

    const audioBuffer = await synthesizeSpeech({
      text: payload.text,
      ssml: payload.ssml,
      voiceName: payload.voiceName,
      languageCode: payload.languageCode,
      speakingRate: payload.speakingRate,
      audioEncoding: encoding,
    });

    const { mimeType } = ENCODING_METADATA[encoding];
    const fileName = buildFileName(payload.fileName ?? "tts-audio", encoding);

    // Create File from Buffer - use Uint8Array view to handle the conversion
    const file = new File([new Uint8Array(audioBuffer)], fileName, { type: mimeType });
    const result = await uploadToAssetService(userId, payload.projectId, file, {
      source: "tts",
      runPipeline: true,
    });

    console.log("[TTS] Generated audio asset:", result.asset.id);

    return NextResponse.json({ asset: result.asset }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", issues: error.flatten() },
        { status: 400 }
      );
    }

    console.error("TTS synthesis failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}
