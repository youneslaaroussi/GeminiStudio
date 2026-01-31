import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_PROMPT_MODEL } from "@/app/lib/model-ids";
import { verifyAuth } from "@/app/lib/server/auth";

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL_ID = process.env.PROMPT_MODEL_ID || DEFAULT_PROMPT_MODEL;

export const runtime = "nodejs";

interface PromptIdeaBody {
  idea?: string;
  tone?: string;
  aspectRatio?: "16:9" | "9:16";
  durationSeconds?: 4 | 6 | 8;
  includeAudio?: boolean;
}

interface PromptSuggestion {
  cinematography: string;
  subject: string;
  action: string;
  context: string;
  styleAmbiance: string;
  audioDirection: string;
  finalPrompt: string;
}

function buildSystemPrompt(body: PromptIdeaBody) {
  const ratio = body.aspectRatio ?? "16:9";
  const duration = body.durationSeconds ?? 8;
  const audio = body.includeAudio !== false;

  return `You are a professional Veo 3.1 prompt engineer. Using the five-part formula from the Google Cloud "Ultimate prompting guide for Veo 3.1" (Cinematography + Subject + Action + Context + Style & Ambiance) produce a JSON object that breaks down an enhanced prompt. 
- Cinematography should mention shot type, movement, and lens guidance.
- Subject must distill the primary character or focal object.
- Action describes the motion or dialogue.
- Context captures the location/background details.
- Style & Ambiance controls mood, era, lighting, and camera treatment.
- Add Audio directions inspired by the guide's soundstage best practices (dialogue, ambience, SFX). If the request disables audio, note "Muted".
- Final prompt should be a single paragraph weaving the sections together and explicitly state the duration (${duration}s) and aspect ratio ${ratio}. Mention that Veo should ${audio ? "generate immersive audio" : "stay silent"}.
Respond ONLY with minified JSON using this exact schema: {"cinematography":"","subject":"","action":"","context":"","styleAmbiance":"","audioDirection":"","finalPrompt":""}. Do not wrap the JSON in markdown code fences.`;
}

function extractJsonCandidate(text?: string) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

export async function POST(request: NextRequest) {
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!API_KEY) {
    return NextResponse.json({ error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" }, { status: 500 });
  }

  try {
    const body = (await request.json()) as PromptIdeaBody;
    if (!body.idea || !body.idea.trim()) {
      return NextResponse.json({ error: "Idea or seed prompt is required" }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(body);
    const userContent = `Idea: ${body.idea.trim()}${body.tone ? `\nTone or reference: ${body.tone}` : ""}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n${userContent}` }],
            },
          ],
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
            text?: string;
          }>;
        };
      }>;
    };

    const text = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .find((value): value is string => Boolean(value));

    const jsonString = extractJsonCandidate(text);
    if (!jsonString) {
      return NextResponse.json({ error: "Prompt model did not return structured data" }, { status: 500 });
    }

    const suggestion = JSON.parse(jsonString) as PromptSuggestion;

    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error("Prompt generation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
