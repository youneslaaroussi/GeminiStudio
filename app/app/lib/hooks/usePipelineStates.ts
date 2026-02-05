"use client";

import { useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/server/firebase";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { usePipelineStatesStore } from "@/app/lib/store/pipeline-states-store";
import type { PipelineStepState } from "@/app/types/pipeline";

export interface PipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}

interface UsePipelineStatesOptions {
  /** Whether listening is enabled. Default: true */
  enabled?: boolean;
}

interface UsePipelineStatesResult {
  /** Pipeline states keyed by assetId */
  states: Record<string, PipelineStepState[]>;
  isLoading: boolean;
  error: string | null;
  /** Whether any assets have running/waiting steps */
  hasActiveJobs: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for real-time pipeline states via Firestore listeners.
 * No polling - asset service writes pipeline state to Firestore when steps complete,
 * so caption updates appear instantly in timeline/preview.
 */
export function usePipelineStates(
  projectId: string | null,
  options: UsePipelineStatesOptions = {}
): UsePipelineStatesResult {
  const { enabled = true } = options;

  const { user } = useAuth();
  const userId = user?.uid ?? null;
  const assets = useAssetsStore((s) => s.assets);

  const states = usePipelineStatesStore((s) => s.states);
  const isLoading = usePipelineStatesStore((s) => s.isLoading);
  const error = usePipelineStatesStore((s) => s.error);
  const refresh = usePipelineStatesStore((s) => s.refresh);
  const hasActiveJobs = Object.values(states).some((steps) =>
    steps.some((step) => step.status === "running" || step.status === "waiting")
  );

  const assetIds = assets.map((a) => a.id).sort().join(",");

  useEffect(() => {
    if (!enabled || !projectId || !userId) {
      usePipelineStatesStore.getState().setProjectId(null);
      return;
    }

    usePipelineStatesStore.getState().setProjectId(projectId);

    const ids = assetIds ? assetIds.split(",") : [];
    if (ids.length === 0) {
      return;
    }

    const unsubscribes: (() => void)[] = [];

    for (const assetId of ids) {
      const stateRef = doc(
        db,
        "users",
        userId,
        "projects",
        projectId,
        "assets",
        assetId,
        "pipeline",
        "state"
      );

      const unsub = onSnapshot(
        stateRef,
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const steps = (data?.steps ?? []) as PipelineStepState[];
          usePipelineStatesStore.getState().upsertAssetState(assetId, steps);
        },
        (err) => {
          console.error(`Pipeline state listener error for asset ${assetId}:`, err);
        }
      );
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach((u) => u());
    };
  }, [enabled, projectId, userId, assetIds]);

  return {
    states,
    isLoading,
    error,
    hasActiveJobs,
    refresh,
  };
}
