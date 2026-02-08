import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { verifyAuth } from "@/app/lib/server/auth";
import { getCurrentGeminiKey, runWithGeminiKeyRotation } from "@/app/lib/server/gemini-api-keys";
import { DEFAULT_DIGEST_MODEL } from "@/app/lib/model-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmptyBody = { type: "empty"; assetsContext: string };
type AfterResponseBody = { type: "afterResponse"; conversationText: string };
type Body = EmptyBody | AfterResponseBody;

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z
        .string()
        .min(1, "Each suggestion must be non-empty.")
        .max(200)
        .describe("A short follow-up prompt the user could send.")
    )
    .min(1, "Return at least one suggestion.")
    .max(5)
    .describe("1 to 5 short, actionable follow-up prompts."),
});

const EMPTY_SYSTEM = `You suggest 1–5 short, actionable follow-up prompts for a video-editing assistant chat. The user has not sent any message yet; context is the list of assets in their project.
You MUST return at least one suggestion. Each suggestion must be a single short sentence the user could send as their next message (e.g. "Add a title card at the start", "Trim the first 10 seconds of my intro clip").
Base suggestions on the asset names and types provided. Suggest things that make sense for those assets (e.g. transcribe, add to timeline, create a montage).
Keep each suggestion under 80 characters. Be specific to their assets when possible.`;

const AFTER_RESPONSE_SYSTEM = `You suggest 3–5 short, actionable follow-up prompts for a video-editing assistant chat. The conversation so far (user and assistant messages, text only) is provided.
Each suggestion must be a single short sentence the user could send as their next message.
Suggestions should naturally continue the conversation: clarify, go deeper, or do a related task (e.g. "Apply that to the second clip too", "Export in 4K", "Add background music").
Keep each suggestion under 80 characters.`;

function normalizeActions(raw: string[]): string[] {
  return raw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((s) => String(s).trim().slice(0, 200))
    .slice(0, 5);
}

async function generateSuggestions(prompt: string): Promise<string[]> {
  const key = getCurrentGeminiKey();
  if (!key) return [];
  return runWithGeminiKeyRotation(async (apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: DEFAULT_DIGEST_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: zodToJsonSchema(suggestionsSchema),
      },
    });
    const text = response.text?.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      const result = suggestionsSchema.parse(parsed);
      return normalizeActions(result.suggestions);
    } catch {
      return [];
    }
  });
}

export async function POST(request: NextRequest) {
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!getCurrentGeminiKey()) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.type === "empty") {
    const assetsContext =
      typeof body.assetsContext === "string" ? body.assetsContext.trim() : "";
    // Stricter: when no assets context, return nothing (no suggestions without context)
    if (!assetsContext) {
      return NextResponse.json({ actions: [] });
    }
    const userContent = `Assets in the project (name, type, optional description):\n\n${assetsContext}`;

    try {
      const actions = await generateSuggestions(`${EMPTY_SYSTEM}\n\n${userContent}`);
      return NextResponse.json({ actions });
    } catch {
      return NextResponse.json({ actions: [] });
    }
  }

  if (body.type === "afterResponse") {
    const conversationText =
      typeof body.conversationText === "string"
        ? body.conversationText.trim()
        : "";
    if (!conversationText) {
      return NextResponse.json(
        { error: "Missing or empty conversationText" },
        { status: 400 }
      );
    }
    const userContent = `Conversation (text only):\n\n${conversationText}`;

    try {
      const actions = await generateSuggestions(`${AFTER_RESPONSE_SYSTEM}\n\n${userContent}`);
      return NextResponse.json({ actions });
    } catch {
      return NextResponse.json({ actions: [] });
    }
  }

  return NextResponse.json(
    {
      error:
        "Body must be { type: 'empty', assetsContext } or { type: 'afterResponse', conversationText }",
    },
    { status: 400 }
  );
}
