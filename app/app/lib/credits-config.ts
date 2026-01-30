/**
 * Shared config: credits consumed per action.
 * Use getCreditsForAction() so costs can depend on context (e.g. resolution) later.
 */

export type CreditAction =
  | "veo_generation"
  | "render"
  | "lyria_generation"
  | "tts"
  | "image_generation"
  | "chat"
  | "live_voice_chat"
  | "upload_video"
  | "upload_image"
  | "upload_audio";

/** Base credits per action. Overrides via context when provided. */
export const CREDITS_PER_ACTION: Record<CreditAction, number> = {
  veo_generation: 10,
  render: 5,
  lyria_generation: 8,
  tts: 2,
  image_generation: 4,
  chat: 3,
  live_voice_chat: 3,
  upload_video: 5,
  upload_image: 2,
  upload_audio: 3,
};

export interface VeoCreditsContext {
  resolution?: "720p" | "1080p" | "4k";
  durationSeconds?: number;
}

export interface CreditsContext {
  veo?: VeoCreditsContext;
}

/**
 * Return credits required for an action. Optional context can change the cost
 * (e.g. Veo 1080p/4k costs more than 720p).
 */
export function getCreditsForAction(
  action: CreditAction,
  context?: CreditsContext
): number {
  const base = CREDITS_PER_ACTION[action] ?? 0;
  if (action === "veo_generation" && context?.veo?.resolution) {
    const mult: Record<string, number> = { "720p": 1, "1080p": 2, "4k": 4 };
    return Math.max(1, Math.round(base * (mult[context.veo.resolution] ?? 1)));
  }
  return base;
}

/**
 * Get upload credit action from MIME type.
 */
export function getUploadActionFromMimeType(mimeType: string): CreditAction {
  if (mimeType.startsWith("video/")) return "upload_video";
  if (mimeType.startsWith("audio/")) return "upload_audio";
  if (mimeType.startsWith("image/")) return "upload_image";
  // Default to image for unknown types (cheapest)
  return "upload_image";
}

/**
 * Get total upload credits for a list of files.
 */
export function getUploadCreditsForFiles(files: Array<{ type: string }>): number {
  return files.reduce((total, file) => {
    const action = getUploadActionFromMimeType(file.type);
    return total + getCreditsForAction(action);
  }, 0);
}

/**
 * Get upload credit breakdown by type.
 */
export function getUploadCreditBreakdown(
  files: Array<{ type: string }>
): { videos: number; images: number; audio: number; totalCredits: number } {
  let videos = 0;
  let images = 0;
  let audio = 0;

  for (const file of files) {
    if (file.type.startsWith("video/")) videos++;
    else if (file.type.startsWith("audio/")) audio++;
    else images++;
  }

  const totalCredits =
    videos * CREDITS_PER_ACTION.upload_video +
    images * CREDITS_PER_ACTION.upload_image +
    audio * CREDITS_PER_ACTION.upload_audio;

  return { videos, images, audio, totalCredits };
}
