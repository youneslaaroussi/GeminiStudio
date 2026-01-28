"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getAuthHeaders } from "./useAuthFetch";
import type { PipelineStepState } from "@/app/types/pipeline";

export interface PipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}

interface UsePipelineStatesOptions {
  /** Polling interval in milliseconds. Default: 5000 */
  interval?: number;
  /** Whether polling is enabled. Default: true */
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
 * Hook for fetching and polling all pipeline states for a project.
 */
export function usePipelineStates(
  projectId: string | null,
  options: UsePipelineStatesOptions = {}
): UsePipelineStatesResult {
  const { interval = 5000, enabled = true } = options;

  const [states, setStates] = useState<Record<string, PipelineStepState[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStates = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const url = new URL("/api/pipeline", window.location.origin);
      url.searchParams.set("projectId", projectId);

      const response = await fetch(url.toString(), {
        headers: authHeaders,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Unauthorized");
        }
        throw new Error("Failed to fetch pipeline states");
      }

      const data = await response.json();
      const statesMap: Record<string, PipelineStepState[]> = {};

      for (const state of data.states || []) {
        statesMap[state.assetId] = state.steps;
      }

      setStates(statesMap);
    } catch (err) {
      console.error("Pipeline states fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Check if any assets have active jobs
  const hasActiveJobs = Object.values(states).some((steps) =>
    steps.some((step) => step.status === "running" || step.status === "waiting")
  );

  // Set up polling
  useEffect(() => {
    if (!enabled || !projectId) {
      return;
    }

    // Initial fetch
    fetchStates();

    // Start polling
    intervalRef.current = setInterval(fetchStates, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, projectId, interval, fetchStates]);

  // Reset state when project changes
  useEffect(() => {
    setStates({});
    setError(null);
  }, [projectId]);

  return {
    states,
    isLoading,
    error,
    hasActiveJobs,
    refresh: fetchStates,
  };
}
