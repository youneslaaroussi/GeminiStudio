"use client";

import { useEffect, useRef } from "react";
import { useProjectStore } from "@/app/lib/store/project-store";

const DEFAULT_INTERVAL_MS = 30_000;

interface UseAutoSaveOptions {
  /** Polling interval in milliseconds. Default: 30000 */
  intervalMs?: number;
  /** Whether auto-save is enabled. Default: true */
  enabled?: boolean;
}

/**
 * Polls periodically and saves the project when there are unsaved changes.
 * Only runs when projectId is set and the window is focused (optional, we can skip focus check for simplicity).
 */
export function useAutoSave(options: UseAutoSaveOptions = {}) {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const tick = () => {
      const state = useProjectStore.getState();
      if (state.projectId && state.hasUnsavedChanges) {
        state.saveProject();
      }
    };

    intervalRef.current = setInterval(tick, intervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, intervalMs]);
}
