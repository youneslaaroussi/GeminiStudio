/**
 * Shared config: credits consumed per action.
 * Use getCreditsForAction() so costs can depend on context (e.g. resolution) later.
 */

export type CreditAction =
  | "veo_generation"
  | "render"
  | "lyria_generation";

/** Base credits per action. Overrides via context when provided. */
export const CREDITS_PER_ACTION: Record<CreditAction, number> = {
  veo_generation: 10,
  render: 5,
  lyria_generation: 8,
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
