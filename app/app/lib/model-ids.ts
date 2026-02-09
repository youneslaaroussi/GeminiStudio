/**
 * Shared model IDs for Gemini / Google AI.
 * Priority lists: use GEMINI_*_MODEL_IDS (comma-separated); fallback to single env or default.
 * Each request tries models in order; next request starts again from first (no state).
 */

/** Only 2.5 flash is supported for Live API: https://ai.google.dev/gemini-api/docs/live */
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

/** Digest/analysis (env: DIGEST_MODEL_ID) */
export const DEFAULT_DIGEST_MODEL = "gemini-3-pro-preview";

/** Default chat/model priority: only these three in this order. Anything else is not used as default. */
const DEFAULT_CHAT_MODEL_IDS = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"];
const DEFAULT_RECOMMENDED_ACTIONS_MODEL = "gemini-2.0-flash";
const DEFAULT_BANANA_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_PROMPT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TITLE_MODEL = "gemini-2.0-flash";

/** Recommended follow-up actions in chat (env: RECOMMENDED_ACTIONS_MODEL_ID or GEMINI_RECOMMENDED_ACTIONS_MODEL_IDS). */
export { DEFAULT_RECOMMENDED_ACTIONS_MODEL, DEFAULT_BANANA_MODEL, DEFAULT_PROMPT_MODEL };

export function getRecommendedActionsModelId(): string {
  return getRecommendedActionsModelIds()[0]!;
}

function parseModelIdsEnv(envVar: string | undefined, singleFallback: string | undefined, defaultId: string): string[] {
  if (envVar?.trim()) {
    const list = envVar.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  if (singleFallback?.trim()) return [singleFallback.trim()];
  return [defaultId];
}

/** Chat (main agent). Env: GEMINI_CHAT_MODEL_IDS or AI_CHAT_GOOGLE_MODEL. Default order: gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro. */
export function getChatModelIds(): string[] {
  const envList = process.env.GEMINI_CHAT_MODEL_IDS?.trim();
  if (envList) {
    const list = envList.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  const single = process.env.AI_CHAT_GOOGLE_MODEL?.trim();
  if (single) return [single];
  return [...DEFAULT_CHAT_MODEL_IDS];
}

/** Title generation. Env: GEMINI_TITLE_MODEL_IDS or AI_TITLE_GOOGLE_MODEL / GEMINI_TITLE_MODEL. */
export function getTitleModelIds(): string[] {
  return parseModelIdsEnv(
    process.env.GEMINI_TITLE_MODEL_IDS,
    process.env.AI_TITLE_GOOGLE_MODEL ?? process.env.GEMINI_TITLE_MODEL,
    DEFAULT_TITLE_MODEL
  );
}

/** Recommended actions. Env: GEMINI_RECOMMENDED_ACTIONS_MODEL_IDS or RECOMMENDED_ACTIONS_MODEL_ID. */
export function getRecommendedActionsModelIds(): string[] {
  return parseModelIdsEnv(
    process.env.GEMINI_RECOMMENDED_ACTIONS_MODEL_IDS,
    process.env.RECOMMENDED_ACTIONS_MODEL_ID,
    DEFAULT_RECOMMENDED_ACTIONS_MODEL
  );
}

/** Banana image generation. Env: GEMINI_BANANA_MODEL_IDS or BANANA_MODEL_ID. */
export function getBananaModelIds(): string[] {
  return parseModelIdsEnv(
    process.env.GEMINI_BANANA_MODEL_IDS,
    process.env.BANANA_MODEL_ID,
    DEFAULT_BANANA_MODEL
  );
}

/** Prompt expansion / ideas. Env: GEMINI_PROMPT_MODEL_IDS or PROMPT_MODEL_ID. */
export function getPromptModelIds(): string[] {
  return parseModelIdsEnv(
    process.env.GEMINI_PROMPT_MODEL_IDS,
    process.env.PROMPT_MODEL_ID,
    DEFAULT_PROMPT_MODEL
  );
}

/** Veo video generation (env: VEO_MODEL_ID) */
export const DEFAULT_VEO_MODEL = "veo-3.0-generate-001";

/** Lyria music/audio generation */
export const LYRIA_MODEL = "lyria-002";

/** Speech recognition (env: SPEECH_MODEL) */
export const DEFAULT_SPEECH_MODEL = "chirp_3";
