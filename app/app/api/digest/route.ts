import { NextRequest, NextResponse } from "next/server";
import { getMediaCategory, normalizeGeminiMimeType } from "@/app/lib/server/gemini/multimodal";
import { DEFAULT_DIGEST_MODEL } from "@/app/lib/model-ids";

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL_ID = process.env.DIGEST_MODEL_ID || DEFAULT_DIGEST_MODEL;

export const runtime = "nodejs";

interface DigestRequestBody {
  /** URL of the asset to analyze */
  assetUrl: string;
  /** MIME type of the asset */
  mimeType: string;
  /** Asset name for context */
  assetName?: string;
  /** Optional specific question or analysis prompt */
  query?: string;
  /** Analysis depth */
  depth?: "quick" | "detailed" | "exhaustive";
}

interface GeminiContentPart {
  text?: string;
  fileData?: {
    fileUri: string;
    mimeType: string;
  };
}

function buildSystemPrompt(
  category: string,
  assetName: string | undefined,
  depth: "quick" | "detailed" | "exhaustive"
): string {
  const depthInstructions = {
    quick: "Provide a brief, focused summary (2-3 sentences).",
    detailed: "Provide a comprehensive analysis covering key aspects, notable details, and any relevant observations.",
    exhaustive: "Provide an extremely thorough analysis. For videos: describe scene by scene, note all visual elements, audio, dialogue, transitions. For images: describe every detail, composition, colors, subjects, background elements. For audio: transcribe speech, describe sounds, note timing and patterns.",
  };

  const categoryPrompts: Record<string, string> = {
    video: `You are analyzing a video${assetName ? ` named "${assetName}"` : ""}. ${depthInstructions[depth]}

Cover these aspects as relevant:
- Overall content and subject matter
- Visual style, cinematography, and composition
- Key scenes or moments with timestamps
- Audio elements (dialogue, music, sound effects)
- Technical quality and notable production elements
- Any text, graphics, or overlays visible`,

    image: `You are analyzing an image${assetName ? ` named "${assetName}"` : ""}. ${depthInstructions[depth]}

Cover these aspects as relevant:
- Main subject and composition
- Visual style, colors, and lighting
- Background elements and setting
- Any text or graphics visible
- Technical quality and notable details
- Emotional tone or mood conveyed`,

    audio: `You are analyzing an audio file${assetName ? ` named "${assetName}"` : ""}. ${depthInstructions[depth]}

Cover these aspects as relevant:
- Type of audio content (speech, music, sound effects, etc.)
- For speech: transcribe key parts, identify speakers if possible
- For music: genre, instruments, tempo, mood
- Sound quality and notable production elements
- Timestamps for key moments or transitions`,

    document: `You are analyzing a document${assetName ? ` named "${assetName}"` : ""}. ${depthInstructions[depth]}

Cover these aspects as relevant:
- Document type and purpose
- Main content and key points
- Structure and organization
- Any notable formatting or visual elements`,
  };

  return categoryPrompts[category] ?? `You are analyzing a media file${assetName ? ` named "${assetName}"` : ""}. ${depthInstructions[depth]} Describe its content, notable features, and any relevant details.`;
}

export async function POST(request: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as DigestRequestBody;

    if (!body.assetUrl) {
      return NextResponse.json({ error: "assetUrl is required" }, { status: 400 });
    }

    if (!body.mimeType) {
      return NextResponse.json({ error: "mimeType is required" }, { status: 400 });
    }

    const normalizedMimeType = normalizeGeminiMimeType(body.mimeType);
    const category = getMediaCategory(normalizedMimeType);

    if (category === "unknown") {
      return NextResponse.json(
        { error: `Unsupported media type: ${body.mimeType}` },
        { status: 400 }
      );
    }

    const depth = body.depth ?? "detailed";
    const systemPrompt = buildSystemPrompt(category, body.assetName, depth);

    // Build the content parts - media first, then text (Gemini best practice)
    const parts: GeminiContentPart[] = [
      {
        fileData: {
          fileUri: body.assetUrl,
          mimeType: normalizedMimeType,
        },
      },
    ];

    // Add user query or default analysis request
    const userPrompt = body.query?.trim()
      ? `${systemPrompt}\n\nUser's specific question: ${body.query.trim()}`
      : systemPrompt;

    parts.push({ text: userPrompt });

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
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.2, // Lower temperature for more factual analysis
            maxOutputTokens: depth === "exhaustive" ? 8192 : depth === "detailed" ? 4096 : 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[digest] Gemini API error:", errorText);
      return NextResponse.json(
        { error: `Gemini API error: ${response.status}` },
        { status: response.status }
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const analysisText = payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join("\n\n");

    if (!analysisText) {
      return NextResponse.json(
        { error: "No analysis generated" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      analysis: analysisText,
      category,
      depth,
      usage: payload.usageMetadata,
    });
  } catch (error) {
    console.error("[digest] Failed to analyze asset:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
