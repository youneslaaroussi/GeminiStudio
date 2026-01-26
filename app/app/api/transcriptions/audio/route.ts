import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/app/lib/server/google-cloud";

export const runtime = "nodejs";

/**
 * Upload extracted audio for transcription.
 * This endpoint uploads an audio file directly to GCS and returns the GCS URI.
 * Used when transcribing video files - we extract audio client-side and upload it here.
 */
export async function POST(request: NextRequest) {
  const BUCKET = process.env.ASSET_GCS_BUCKET || process.env.SPEECH_GCS_BUCKET;
  if (!BUCKET) {
    return NextResponse.json(
      { error: "GCS bucket not configured" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("audio");
  const assetId = formData.get("assetId");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No audio file provided" },
      { status: 400 }
    );
  }

  if (!assetId || typeof assetId !== "string") {
    return NextResponse.json(
      { error: "assetId is required" },
      { status: 400 }
    );
  }

  try {
    const token = await getGoogleAccessToken(
      "https://www.googleapis.com/auth/devstorage.full_control"
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const objectName = `transcription-audio/${assetId}/${Date.now()}-${crypto.randomUUID()}.wav`;

    const url =
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o` +
      `?uploadType=media&name=${encodeURIComponent(objectName)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "audio/wav",
        "Content-Length": buffer.byteLength.toString(),
      },
      body: buffer,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to upload to GCS: ${text}`);
    }

    const payload = (await response.json()) as { name: string };
    const gcsUri = `gs://${BUCKET}/${payload.name}`;

    return NextResponse.json({ gcsUri });
  } catch (error) {
    console.error("Failed to upload transcription audio", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
