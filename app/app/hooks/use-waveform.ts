"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePipelineStatesStore } from "@/app/lib/store/pipeline-states-store";

export interface UseWaveformInput {
  src?: string;
  cacheKey?: string;
  width: number;
  height: number;
  offsetSeconds?: number;
  durationSeconds?: number;
  mediaType?: "video" | "audio";
  /** When provided with projectId, reads waveform from pipeline state (Firestore real-time) */
  assetId?: string;
  projectId?: string | null;
}

interface WaveformData {
  samples: number[];
  durationSeconds: number;
}

interface UseWaveformResult {
  path: string;
  durationSeconds: number | null;
  isLoading: boolean;
}

function clipSamples(
  data: WaveformData,
  offsetSeconds = 0,
  durationSeconds?: number
): number[] {
  const { samples, durationSeconds: totalDuration } = data;
  if (!samples.length || totalDuration <= 0) return [];
  const startRatio = Math.max(0, Math.min(1, offsetSeconds / totalDuration));
  const endRatio = durationSeconds
    ? Math.max(startRatio, Math.min(1, (offsetSeconds + durationSeconds) / totalDuration))
    : 1;

  const startIndex = Math.floor(startRatio * (samples.length - 1));
  const endIndex = Math.max(startIndex + 1, Math.ceil(endRatio * (samples.length - 1)));
  return samples.slice(startIndex, endIndex);
}

function buildPath(samples: number[], width: number, height: number): string {
  if (!samples.length || width <= 0 || height <= 0) return "";
  const maxVal = Math.max(...samples, 0.0001);
  const normalized = samples.map((sample) => (sample / maxVal) * 0.95);
  const centerY = height / 2;
  const step = normalized.length > 1 ? width / (normalized.length - 1) : width;

  let path = `M0 ${centerY.toFixed(2)}`;
  normalized.forEach((sample, index) => {
    const x = index * step;
    const y = centerY - sample * centerY;
    path += ` L${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  for (let index = normalized.length - 1; index >= 0; index--) {
    const sample = normalized[index];
    const x = index * step;
    const y = centerY + sample * centerY;
    path += ` L${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return `${path} Z`;
}

export function useWaveform({
  src,
  cacheKey,
  width,
  height,
  offsetSeconds = 0,
  durationSeconds,
  mediaType = "audio",
  assetId,
  projectId,
}: UseWaveformInput): UseWaveformResult {
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  const states = usePipelineStatesStore((s) => s.states);
  const steps = assetId ? (states[assetId] ?? []) : [];
  const waveformStep = steps.find((s) => s.id === "waveform");

  const resolvedCacheKey = cacheKey ?? src;
  const shouldRender = useMemo(
    () => Boolean((assetId || src) && resolvedCacheKey && width > 0 && height > 0),
    [assetId, resolvedCacheKey, src, width, height]
  );

  const updatePath = useCallback(
    (data: WaveformData) => {
      const clipped = clipSamples(data, offsetSeconds, durationSeconds);
      setPath(buildPath(clipped, width, height));
      setDuration(data.durationSeconds);
    },
    [durationSeconds, offsetSeconds, width, height]
  );

  // When assetId+projectId, read from pipeline state (Firestore) - no API call
  useEffect(() => {
    if (!shouldRender || !assetId || !projectId) {
      if (!assetId && !src) {
        setPath("");
        setDuration(null);
      }
      return;
    }

    if (waveformStep?.status === "succeeded") {
      const samples = (waveformStep.metadata?.samples as number[] | undefined) ?? [];
      const dur = (waveformStep.metadata?.duration as number | undefined) ?? 0;
      if (samples.length > 0 && resolvedCacheKey) {
        const data: WaveformData = { samples, durationSeconds: dur };
        updatePath(data);
        return;
      }
    }

    setPath("");
    setDuration(null);
  }, [
    assetId,
    projectId,
    resolvedCacheKey,
    shouldRender,
    updatePath,
    waveformStep?.status,
    waveformStep?.metadata,
  ]);

  // Re-render path when clip/offset/duration change (recompute clipped samples)
  useEffect(() => {
    if (!shouldRender || !assetId || !waveformStep || waveformStep.status !== "succeeded") return;
    const samples = (waveformStep.metadata?.samples as number[] | undefined) ?? [];
    const dur = (waveformStep.metadata?.duration as number | undefined) ?? 0;
    if (samples.length > 0) {
      updatePath({ samples, durationSeconds: dur });
    }
  }, [
    assetId,
    shouldRender,
    waveformStep?.status,
    waveformStep?.metadata,
    updatePath,
    offsetSeconds,
    durationSeconds,
  ]);

  const isLoading =
    !!assetId &&
    !!projectId &&
    !!waveformStep &&
    (waveformStep.status === "running" || waveformStep.status === "waiting");

  return { path, durationSeconds: duration, isLoading };
}
