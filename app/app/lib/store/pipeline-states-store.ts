import { create } from "zustand";
import type { PipelineStepState } from "@/app/types/pipeline";

interface PipelineStatesState {
  projectId: string | null;
  states: Record<string, PipelineStepState[]>;
  isLoading: boolean;
  error: string | null;
  lastFetchAt: number;
  setProjectId: (projectId: string | null) => void;
  setStates: (states: Record<string, PipelineStepState[]>) => void;
  upsertAssetState: (assetId: string, steps: PipelineStepState[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
}

export const usePipelineStatesStore = create<PipelineStatesState>((set, get) => ({
  projectId: null,
  states: {},
  isLoading: false,
  error: null,
  lastFetchAt: 0,

  setProjectId: (projectId) => {
    set({ projectId });
    if (!projectId) {
      set({ states: {}, error: null });
    }
  },

  setStates: (states) => set({ states, lastFetchAt: Date.now() }),

  upsertAssetState: (assetId, steps) =>
    set((s) => ({
      states: { ...s.states, [assetId]: steps },
      lastFetchAt: Date.now(),
    })),

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  refresh: async () => {
    const { projectId } = get();
    if (!projectId) return;

    set({ isLoading: true, error: null });

    try {
      const { getAuthHeaders } = await import("@/app/lib/hooks/useAuthFetch");
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

      set({ states: statesMap, lastFetchAt: Date.now() });
    } catch (err) {
      console.error("Pipeline states fetch error:", err);
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
