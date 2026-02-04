"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SharedMediaLoader } from "@/app/lib/media/shared-media-loader";

export interface UseWaveformInput {
  src?: string;
  cacheKey?: string;
  width: number;
  height: number;
  /**
   * Offset inside the source media in seconds.
   */
  offsetSeconds?: number;
  /**
   * Duration of the visible portion in seconds. If not provided, the entire
   * waveform is rendered.
   */
  durationSeconds?: number;
  /**
   * Media type - 'video' uses SharedMediaLoader, 'audio' fetches directly.
   * Defaults to 'audio' for backwards compatibility.
   */
  mediaType?: "video" | "audio";
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

const DB_NAME = "gemini-studio-waveforms";
const STORE_NAME = "waveforms";
const memoryCache = new Map<string, WaveformData>();

// ============================================================================
// IndexedDB helpers for audio waveform cache
// ============================================================================

function openWaveformDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedWaveform(key: string): Promise<WaveformData | null> {
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  try {
    const db = await openWaveformDb();
    if (!db) return null;
    return await new Promise<WaveformData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value && Array.isArray(value.samples)) {
          resolve({
            samples: value.samples,
            durationSeconds: value.durationSeconds ?? 0,
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function putCachedWaveform(key: string, data: WaveformData) {
  memoryCache.set(key, data);
  try {
    const db = await openWaveformDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore storage errors; memory cache is still populated.
  }
}

// ============================================================================
// Audio waveform extraction (direct fetch - still needed for audio-only clips)
// ============================================================================

async function loadWaveformFromSource(src: string): Promise<WaveformData | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioContext.close();

    const channelData = audioBuffer.getChannelData(0);
    if (!channelData || channelData.length === 0) {
      return null;
    }

    const sampleCount = Math.min(800, Math.max(200, Math.floor(channelData.length / 5000)));
    const blockSize = Math.floor(channelData.length / sampleCount);
    if (!blockSize || !Number.isFinite(blockSize)) {
      return null;
    }

    const samples: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const blockStart = i * blockSize;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[blockStart + j] ?? 0);
      }
      samples.push(blockSize ? sum / blockSize : 0);
    }

    return { samples, durationSeconds: audioBuffer.duration };
  } catch {
    return null;
  }
}

async function getAudioWaveformData(cacheKey: string, src: string): Promise<WaveformData | null> {
  const cached = await getCachedWaveform(cacheKey);
  if (cached) {
    memoryCache.set(cacheKey, cached);
    return cached;
  }

  const loaded = await loadWaveformFromSource(src);
  if (loaded) {
    await putCachedWaveform(cacheKey, loaded);
  }
  return loaded;
}

// ============================================================================
// Waveform path building
// ============================================================================

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

// ============================================================================
// Main hook
// ============================================================================

export function useWaveform({
  src,
  cacheKey,
  width,
  height,
  offsetSeconds = 0,
  durationSeconds,
  mediaType = "audio",
}: UseWaveformInput): UseWaveformResult {
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestRequest = useRef(0);

  const resolvedCacheKey = cacheKey ?? src;

  const shouldRender = useMemo(
    () => Boolean(src && resolvedCacheKey && width > 0 && height > 0),
    [resolvedCacheKey, src, width, height]
  );

  const updatePath = useCallback(
    (data: WaveformData) => {
      const clipped = clipSamples(data, offsetSeconds, durationSeconds);
      setPath(buildPath(clipped, width, height));
      setDuration(data.durationSeconds);
    },
    [durationSeconds, offsetSeconds, width, height]
  );

  useEffect(() => {
    if (!shouldRender || !src) {
      // Don't clear when temporarily disabled (keep showing old data)
      if (!src) {
        setPath("");
        setDuration(null);
      }
      return;
    }

    let cancelled = false;
    const requestId = ++latestRequest.current;

    // Check memory cache immediately (fast path)
    const memCached = resolvedCacheKey ? memoryCache.get(resolvedCacheKey) : null;
    if (memCached) {
      updatePath(memCached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const run = async () => {
      // For VIDEO: use SharedMediaLoader (queued, deduplicated, shares Input)
      if (mediaType === "video") {
        // Check cache first
        const cached = await SharedMediaLoader.loadFromCache(src);
        if (cached.waveform && !cancelled && requestId === latestRequest.current) {
          const data: WaveformData = {
            samples: cached.waveform.samples,
            durationSeconds: cached.waveform.duration,
          };
          memoryCache.set(resolvedCacheKey!, data);
          updatePath(data);
          setIsLoading(false);
          return;
        }

        // Subscribe to updates from the shared loader
        const unsubscribe = SharedMediaLoader.subscribe(
          src,
          { needsWaveform: true },
          (partial) => {
            if (cancelled || requestId !== latestRequest.current) return;

            if (partial.waveform) {
              const data: WaveformData = {
                samples: partial.waveform.samples,
                durationSeconds: partial.waveform.duration,
              };
              memoryCache.set(resolvedCacheKey!, data);
              updatePath(data);
              setIsLoading(false);
            }
          }
        );

        try {
          // Request extraction (queued, deduplicated)
          // NOTE: Don't pass abort signal - let SharedMediaLoader complete and cache
          // even if this component re-renders. Result will be available for next request.
          const result = await SharedMediaLoader.requestExtraction(src, {
            needsWaveform: true,
          });

          if (cancelled || requestId !== latestRequest.current) return;

          // Set final result
          if (result.waveform) {
            const data: WaveformData = {
              samples: result.waveform.samples,
              durationSeconds: result.waveform.duration,
            };
            memoryCache.set(resolvedCacheKey!, data);
            updatePath(data);
          }
        } catch (err) {
          // On error, DON'T clear the waveform data
          if (!cancelled) {
            console.error("[useWaveform] Extraction error:", err);
          }
        } finally {
          unsubscribe();
          if (!cancelled && requestId === latestRequest.current) {
            setIsLoading(false);
          }
        }
        return;
      }

      // For AUDIO: use direct fetch (still fetches full file, but only for audio-only clips)
      try {
        const data = await getAudioWaveformData(resolvedCacheKey!, src);
        if (!data || cancelled || requestId !== latestRequest.current) {
          if (!cancelled && requestId === latestRequest.current) {
            setIsLoading(false);
          }
          return;
        }
        updatePath(data);
      } catch (err) {
        console.error("[useWaveform] Audio extraction error:", err);
      } finally {
        if (!cancelled && requestId === latestRequest.current) {
          setIsLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [resolvedCacheKey, shouldRender, src, mediaType, updatePath, offsetSeconds, durationSeconds, width, height]);

  // Re-render path when clip/offset changes (uses cached data)
  useEffect(() => {
    if (!shouldRender) return;
    const cached = resolvedCacheKey ? memoryCache.get(resolvedCacheKey) : null;
    if (cached) {
      updatePath(cached);
    }
  }, [resolvedCacheKey, shouldRender, updatePath]);

  return { path, durationSeconds: duration, isLoading };
}
