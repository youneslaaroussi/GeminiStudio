"use client";

import { useEffect, useState } from "react";
import { usePipelineStatesStore } from "@/app/lib/store/pipeline-states-store";

export interface AssetFrame {
  url: string;
  timestamp: number;
  index: number;
}

export interface AssetFramesData {
  frames: AssetFrame[];
  duration: number;
  frameCount: number;
}

/**
 * Get frame URLs - uses pipeline state (Firestore) to know when ready,
 * fetches fresh signed URLs from API when step succeeds (URLs expire, can't store).
 * Used for filmstrip and CoordinatePicker preview.
 */
export function useAssetFrames(
  assetId: string | undefined,
  projectId: string | null
): { frames: AssetFrame[]; duration: number; isLoading: boolean } {
  const [data, setData] = useState<AssetFramesData>({
    frames: [],
    duration: 0,
    frameCount: 0,
  });

  const states = usePipelineStatesStore((s) => s.states);
  const steps = assetId ? (states[assetId] ?? []) : [];
  const frameStep = steps.find((s) => s.id === "frame-sampling");
  const stepStatus = frameStep?.status ?? "idle";

  const isLoading =
    !!assetId &&
    !!projectId &&
    (stepStatus === "running" || stepStatus === "waiting");

  useEffect(() => {
    if (!assetId || !projectId || stepStatus !== "succeeded") {
      if (stepStatus !== "succeeded") {
        setData({ frames: [], duration: 0, frameCount: 0 });
      }
      return;
    }

    let cancelled = false;

    fetch(
      `/api/assets/${assetId}/frames?projectId=${encodeURIComponent(projectId)}`,
      { credentials: "include" }
    )
      .then((res) =>
        res.ok ? res.json() : { frames: [], duration: 0, frameCount: 0 }
      )
      .then((d: AssetFramesData) => {
        if (!cancelled) {
          setData(d);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ frames: [], duration: 0, frameCount: 0 });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, projectId, stepStatus]);

  return {
    frames: data.frames,
    duration: data.duration,
    isLoading,
  };
}

/**
 * Pick the frame closest to the given timestamp from sampled frames.
 */
export function getFrameAtTimestamp(
  frames: AssetFrame[],
  duration: number,
  timestamp: number
): AssetFrame | undefined {
  if (!frames.length || duration <= 0) return undefined;
  const ratio = Math.max(0, Math.min(1, timestamp / duration));
  const index = Math.min(
    Math.floor(ratio * frames.length),
    frames.length - 1
  );
  return frames[index];
}
