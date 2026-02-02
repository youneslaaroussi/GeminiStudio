import { create } from "zustand";

/**
 * General-purpose store for requesting highlights on assets (or other targets).
 * Call requestAssetHighlight(assetId) from anywhere; components that display
 * assets subscribe and react (highlight, scroll, switch tab, etc.).
 *
 * Reusable for: chat mention clicks, search results, tool outputs, etc.
 */

const DEFAULT_DURATION_MS = 2000;

export type HighlightTarget = { type: "asset"; id: string };

interface HighlightState {
  /** Current highlight request; cleared automatically after duration */
  request: { target: HighlightTarget; timestamp: number } | null;
  /** Request a highlight. Subscribers (layout, AssetList) react accordingly. */
  requestHighlight: (
    target: HighlightTarget,
    options?: { durationMs?: number }
  ) => void;
}

export const useAssetHighlightStore = create<HighlightState>((set, get) => ({
  request: null,
  requestHighlight: (target, options) => {
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const timestamp = Date.now();
    set({ request: { target, timestamp } });
    setTimeout(() => {
      const state = get();
      if (state.request?.timestamp === timestamp) {
        set({ request: null });
      }
    }, durationMs);
  },
}));

/** Convenience: request highlight for an asset (switches to assets tab via layout subscription) */
export function requestAssetHighlight(
  assetId: string,
  options?: { durationMs?: number }
) {
  useAssetHighlightStore.getState().requestHighlight(
    { type: "asset", id: assetId },
    options
  );
}
