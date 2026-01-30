import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const VOICE_OPTIONS = [
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
] as const;

// Map simple voice names to full Google Cloud TTS voice IDs
const VOICE_ID_MAP: Record<string, string> = {
  Puck: "en-US-Chirp3-HD-Puck",
  Charon: "en-US-Chirp3-HD-Charon",
  Kore: "en-US-Chirp3-HD-Kore",
  Fenrir: "en-US-Chirp3-HD-Fenrir",
  Aoede: "en-US-Chirp3-HD-Aoede",
  Leda: "en-US-Chirp3-HD-Leda",
  Orus: "en-US-Chirp3-HD-Orus",
  Zephyr: "en-US-Chirp3-HD-Zephyr",
};

const generateTtsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  text: z.string().min(2, "Text must be at least 2 characters").max(5000, "Text must be under 5000 characters"),
  voice: z.enum(VOICE_OPTIONS).default("Kore"),
});

export const generateTtsTool: ToolDefinition<typeof generateTtsSchema, Project> = {
  name: "generateSpeech",
  label: "Generate Speech (TTS)",
  description:
    "Generate natural-sounding speech from text using Google's TTS model. Great for voiceovers, narration, and accessibility.",
  runLocation: "client",
  inputSchema: generateTtsSchema,
  fields: [
    {
      name: "projectId",
      label: "Project ID",
      type: "text",
      placeholder: "project_abc123...",
      description: "The project to associate this audio with.",
      required: true,
    },
    {
      name: "text",
      label: "Text to Speak",
      type: "textarea",
      placeholder: "Enter the text you want to convert to speech...",
      description: "The text to convert to speech (up to 5000 characters).",
      required: true,
    },
    {
      name: "voice",
      label: "Voice",
      type: "select",
      options: [
        { value: "Puck", label: "Puck - Upbeat, playful male" },
        { value: "Charon", label: "Charon - Deep, authoritative male" },
        { value: "Kore", label: "Kore - Warm, friendly female" },
        { value: "Fenrir", label: "Fenrir - Bold, energetic male" },
        { value: "Aoede", label: "Aoede - Bright, cheerful female" },
        { value: "Leda", label: "Leda - Calm, soothing female" },
        { value: "Orus", label: "Orus - Clear, professional male" },
        { value: "Zephyr", label: "Zephyr - Soft, gentle" },
      ],
      defaultValue: "Kore",
      description: "Choose the voice for the speech.",
    },
  ],
  async run(input) {
    try {
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Speech generation must be run from the client side.",
        };
      }

      const voiceName = VOICE_ID_MAP[input.voice] || VOICE_ID_MAP.Kore;

      const payload = {
        text: input.text.trim(),
        voiceName,
        languageCode: "en-US",
        audioEncoding: "mp3" as const,
        projectId: input.projectId,
      };

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { asset?: { id: string; signedUrl?: string }; error?: string; required?: number };

      if (response.status === 402) {
        return {
          status: "error" as const,
          error: data.error ?? "Insufficient credits",
          details: data.required != null ? { requiredCredits: data.required } : undefined,
        };
      }

      if (!response.ok || !data.asset) {
        return {
          status: "error" as const,
          error: data.error || "Failed to generate speech",
        };
      }

      const asset = data.asset;

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Speech generated successfully with ${input.voice} voice!`,
          },
          {
            type: "json" as const,
            data: {
              assetId: asset.id,
              audioUrl: asset.signedUrl,
              voice: input.voice,
              textLength: input.text.length,
            },
          },
        ],
        meta: {
          assetId: asset.id,
          audioUrl: asset.signedUrl,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "error" as const,
        error: message,
      };
    }
  },
};
