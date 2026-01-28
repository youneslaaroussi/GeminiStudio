"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getAuthHeaders } from "./useAuthFetch";
import type { PipelineStepState } from "@/app/types/pipeline";

export interface PipelineState {
  assetId: string;
  steps: PipelineStepState[];
  updatedAt: string;
}

interface UsePipelinePollingOptions {
  /** Polling interval in milliseconds. Default: 3000 */
  interval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
  /** Stop polling when all steps are complete. Default: true */
  stopOnComplete?: boolean;
}

interface UsePipelinePollingResult {
  state: PipelineState | null;
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
  hasRunningSteps: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for polling pipeline state for an asset.
 *
 * Automatically polls the pipeline state at regular intervals and stops
 * when all steps are complete (succeeded, failed, or idle).
 */
export function usePipelinePolling(
  assetId: string | null,
  projectId: string | null,
  options: UsePipelinePollingOptions = {}
): UsePipelinePollingResult {
  const {
    interval = 3000,
    enabled = true,
    stopOnComplete = true,
  } = options;

  const [state, setState] = useState<PipelineState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchState = useCallback(async () => {
    if (!assetId || !projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const url = new URL(`/api/assets/${assetId}/pipeline`, window.location.origin);
      url.searchParams.set("projectId", projectId);

      const response = await fetch(url.toString(), {
        headers: authHeaders,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Unauthorized");
        }
        throw new Error("Failed to fetch pipeline state");
      }

      const data = await response.json();
      setState(data);
    } catch (err) {
      console.error("Pipeline polling error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [assetId, projectId]);

  // Determine if pipeline is complete
  const isComplete = state?.steps.every(
    (step) =>
      step.status === "succeeded" ||
      step.status === "failed" ||
      step.status === "idle"
  ) ?? false;

  const hasRunningSteps = state?.steps.some(
    (step) => step.status === "running" || step.status === "waiting"
  ) ?? false;

  // Set up polling
  useEffect(() => {
    if (!enabled || !assetId || !projectId) {
      return;
    }

    // Initial fetch
    fetchState();

    // Start polling
    intervalRef.current = setInterval(() => {
      // Stop polling if complete and stopOnComplete is true
      if (stopOnComplete && isComplete && !hasRunningSteps) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      fetchState();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, assetId, projectId, interval, stopOnComplete, isComplete, hasRunningSteps, fetchState]);

  // Reset state when asset changes
  useEffect(() => {
    setState(null);
    setError(null);
  }, [assetId]);

  return {
    state,
    isLoading,
    error,
    isComplete,
    hasRunningSteps,
    refresh: fetchState,
  };
}
