/**
 * Shared model IDs for Gemini / Google AI.
 * Override via env where supported (e.g. DIGEST_MODEL_ID, PROMPT_MODEL_ID, VEO_MODEL_ID).
 */

/** Only 2.5 flash is supported for Live API: https://ai.google.dev/gemini-api/docs/live */
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

/** Digest/analysis (env: DIGEST_MODEL_ID) */
export const DEFAULT_DIGEST_MODEL = "gemini-3-pro-preview";

/** Banana image generation (env: BANANA_MODEL_ID) */
export const DEFAULT_BANANA_MODEL = "gemini-3-pro-image-preview";

/** Prompt expansion / ideas (env: PROMPT_MODEL_ID) */
export const DEFAULT_PROMPT_MODEL = "gemini-3-flash-preview";

/** Veo video generation (env: VEO_MODEL_ID) */
export const DEFAULT_VEO_MODEL = "veo-3.0-generate-001";

/** Lyria music/audio generation */
export const LYRIA_MODEL = "lyria-002";

/** Speech recognition (env: SPEECH_MODEL) */
export const DEFAULT_SPEECH_MODEL = "chirp_3";
