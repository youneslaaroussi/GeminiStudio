import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { synthesizeSpeech, type SupportedTtsEncoding } from "@/app/lib/services/tts";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";

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

function buildFileName(baseName: string, encoding: SupportedTtsEncoding) {
  const { extension } = ENCODING_METADATA[encoding];
  const trimmed = baseName.replace(/[\\/:*?"<>|]+/g, "").slice(0, 120).trim();
  const fallback = `tts-${Date.now()}`;
  const name = trimmed.length ? trimmed : fallback;
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

export async function POST(request: NextRequest) {
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
    const asset = await saveBufferAsAsset({
      data: audioBuffer,
      originalName: fileName,
      mimeType,
      projectId: payload.projectId,
    });

    return NextResponse.json({ asset }, { status: 201 });
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
