import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/app/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const TITLE_MODEL =
  process.env.AI_TITLE_GOOGLE_MODEL ?? process.env.GEMINI_TITLE_MODEL ?? "gemini-2.0-flash";

const SYSTEM_PROMPT = `You suggest a short project title for a video editing app based on the user's first message or conversation.

Rules:
- If the message has enough substance to derive a project topic (e.g. "make a travel vlog about Japan", "edit my interview clip"), respond with JSON: {"accepted": true, "title": "Short Title Here"}. Keep title under 50 characters, no quotes in the title.
- If the message is too vague (e.g. "hi", "hello", "thanks", "ok"), respond with JSON: {"accepted": false, "reason": "Not enough context"}.
- Output only valid JSON, no markdown or extra text.`;

export interface GenerateTitleResponse {
  accepted: boolean;
  title?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: { context: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const context =
    typeof body?.context === "string" ? body.context.trim() : "";
  if (!context) {
    return NextResponse.json(
      { error: "Missing or empty context" },
      { status: 400 }
    );
  }

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          { text: `Conversation context:\n\n${context}` },
        ],
      },
    ],
    generation_config: {
      temperature: 0.2,
      max_output_tokens: 256,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TITLE_MODEL}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[generate-title] Gemini API error:", errorText);
    return NextResponse.json(
      { error: "Title generation failed" },
      { status: 500 }
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text =
    payload.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("") ?? "";

  if (!text) {
    return NextResponse.json(
      { accepted: false, reason: "No response from model" },
      { status: 200 }
    );
  }

  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: GenerateTitleResponse;
  try {
    parsed = JSON.parse(cleaned) as GenerateTitleResponse;
  } catch {
    return NextResponse.json(
      { accepted: false, reason: "Invalid model response" },
      { status: 200 }
    );
  }

  if (parsed.accepted && typeof parsed.title === "string" && parsed.title.trim()) {
    return NextResponse.json({
      accepted: true,
      title: parsed.title.trim().slice(0, 100),
    });
  }

  return NextResponse.json({
    accepted: false,
    reason: parsed.reason ?? "Not enough context",
  });
}
