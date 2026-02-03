import { NextRequest, NextResponse } from "next/server";
import { getMediaCategory, normalizeGeminiMimeType } from "@/app/lib/server/gemini/multimodal";
import {
  uploadFileFromUrl,
  waitForFileActive,
  isYouTubeUrl,
  isGeminiFileUri,
  GeminiFilesApiError,
} from "@/app/lib/server/gemini/files-api";
import { DEFAULT_DIGEST_MODEL } from "@/app/lib/model-ids";
import { verifyAuth } from "@/app/lib/server/auth";

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
  /** Video clip start offset (e.g. "30s" or "1m30s") */
  startOffset?: string;
  /** Video clip end offset (e.g. "60s" or "2m") */
  endOffset?: string;
  /** Frames per second for video sampling (default: 1) */
  fps?: number;
  /** Media resolution: "low" uses fewer tokens, "high" for more detail */
  mediaResolution?: "low" | "medium" | "high";
}

// REST API uses snake_case
interface GeminiContentPart {
  text?: string;
  file_data?: {
    file_uri: string;
    mime_type?: string;
  };
  video_metadata?: {
    start_offset?: string;
    end_offset?: string;
    fps?: number;
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
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const isVideo = category === "video";

    // Build video metadata if provided (Gemini supports start/end offset natively).
    const videoMetadata: GeminiContentPart["video_metadata"] = {};
    if (isVideo) {
      if (body.startOffset) videoMetadata.start_offset = body.startOffset;
      if (body.endOffset) videoMetadata.end_offset = body.endOffset;
      if (body.fps) videoMetadata.fps = body.fps;
    }
    const hasVideoMetadata = Object.keys(videoMetadata).length > 0;

    // Determine the file URI to use with Gemini
    let fileUri: string;

    if (isYouTubeUrl(body.assetUrl)) {
      // YouTube URLs can be used directly
      fileUri = body.assetUrl;
      console.log(`[digest] Using YouTube URL directly`);
    } else if (isGeminiFileUri(body.assetUrl)) {
      // Already a Gemini Files API URI
      fileUri = body.assetUrl;
      console.log(`[digest] Using existing Gemini Files API URI`);
    } else if (body.assetUrl.startsWith("http://") || body.assetUrl.startsWith("https://")) {
      // HTTP(S) URL - need to upload to Files API first
      console.log(`[digest] Uploading to Gemini Files API from URL...`);

      try {
        const uploadedFile = await uploadFileFromUrl(body.assetUrl, {
          mimeType: normalizedMimeType,
          displayName: body.assetName,
        });

        // Wait for the file to be processed
        const activeFile = await waitForFileActive(uploadedFile.name);
        fileUri = activeFile.uri;

        console.log(`[digest] File uploaded successfully: ${fileUri}`);
      } catch (err) {
        if (err instanceof GeminiFilesApiError) {
          return NextResponse.json(
            { error: `Failed to upload file: ${err.message}`, details: err.details },
            { status: err.statusCode }
          );
        }
        throw err;
      }
    } else {
      return NextResponse.json(
        { error: `Invalid asset URL format. Expected http://, https://, or YouTube URL.` },
        { status: 400 }
      );
    }

    // Build the content parts - media first, then text (Gemini best practice)
    const parts: GeminiContentPart[] = [];

    const filePart: GeminiContentPart = {
      file_data: {
        file_uri: fileUri,
        // Note: mime_type is optional when using Files API URIs
      },
    };
    if (hasVideoMetadata) filePart.video_metadata = videoMetadata;
    parts.push(filePart);

    // Add user query or default analysis request
    const userPrompt = body.query?.trim()
      ? `${systemPrompt}\n\nUser's specific question: ${body.query.trim()}`
      : systemPrompt;

    parts.push({ text: userPrompt });

    // Build media resolution config (snake_case for REST API)
    const mediaResolutionMap: Record<string, string> = {
      low: "MEDIA_RESOLUTION_LOW",
      medium: "MEDIA_RESOLUTION_MEDIUM",
      high: "MEDIA_RESOLUTION_HIGH",
    };
    const mediaResolution = body.mediaResolution
      ? mediaResolutionMap[body.mediaResolution]
      : undefined;

    const generationConfig: Record<string, unknown> = {
      temperature: 0.2, // Lower temperature for more factual analysis
      max_output_tokens: depth === "exhaustive" ? 8192 : depth === "detailed" ? 4096 : 1024,
    };

    // Add media resolution if specified
    if (mediaResolution) {
      generationConfig.media_resolution = mediaResolution;
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generation_config: generationConfig,
    };

    console.log("[digest] Calling generateContent with file_uri:", fileUri);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[digest] Gemini API error:", errorText);

      // Try to parse error for more details
      let errorMessage = `Gemini API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = `Gemini API error: ${errorJson.error.message}`;
        }
      } catch {
        // Keep default message
      }

      return NextResponse.json(
        { error: errorMessage, details: errorText },
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
