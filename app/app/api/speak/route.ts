import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { synthesizeSpeech, type SupportedTtsEncoding } from "@/app/lib/services/tts";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().min(1, "Text is required").max(5000, "Text too long"),
  voiceName: z.string().optional().default("en-US-Journey-F"),
  languageCode: z.string().optional().default("en-US"),
  speakingRate: z.number().min(0.25).max(2).optional().default(1.0),
});

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

/**
 * Lightweight TTS endpoint that returns audio directly without storing as asset.
 * Used for speaking chat messages aloud.
 */
export async function POST(request: NextRequest) {
  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = requestSchema.parse(await request.json());

    // Strip markdown formatting for cleaner speech
    const cleanText = stripMarkdown(payload.text);

    const audioBuffer = await synthesizeSpeech({
      text: cleanText,
      voiceName: payload.voiceName,
      languageCode: payload.languageCode,
      speakingRate: payload.speakingRate,
      audioEncoding: "mp3",
    });

    // Return audio directly as response
    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", issues: error.flatten() },
        { status: 400 }
      );
    }

    console.error("[Speak] TTS synthesis failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}

/**
 * Strip markdown formatting for cleaner TTS output
 */
function stripMarkdown(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "Code block omitted.")
    // Remove inline code
    .replace(/`[^`]+`/g, (match) => match.slice(1, -1))
    // Remove headers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "Image: $1")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, "")
    // Remove bullet points
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // Remove numbered lists prefix
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
