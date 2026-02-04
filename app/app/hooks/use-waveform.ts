"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVideoMediaInfo, extractWaveformProgressive } from "@/app/lib/media/video-media-cache";

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
   * Media type - 'video' uses consolidated cache, 'audio' fetches directly.
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

/** Defer extraction so main preview can load first (avoids competing for same asset). */
const DEFER_MS = 2000;
function whenIdleOrDeferred(cb: () => void): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(cb, { timeout: DEFER_MS });
  } else {
    setTimeout(cb, DEFER_MS);
  }
}

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

async function getWaveformData(cacheKey: string, src: string): Promise<WaveformData | null> {
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

/**
 * Get waveform data for video sources using consolidated cache.
 * This avoids a separate fetch since metadata + waveform are extracted together.
 */
async function getVideoWaveformData(cacheKey: string, src: string): Promise<WaveformData | null> {
  // Check local waveform cache first (in case it was loaded before)
  const cached = await getCachedWaveform(cacheKey);
  if (cached) {
    memoryCache.set(cacheKey, cached);
    return cached;
  }

  try {
    // Use consolidated video media cache
    const mediaInfo = await getVideoMediaInfo(src);
    if (!mediaInfo.waveformSamples.length) {
      return null;
    }
    const data: WaveformData = {
      samples: mediaInfo.waveformSamples,
      durationSeconds: mediaInfo.waveformDuration,
    };
    // Store in waveform cache for future use
    memoryCache.set(cacheKey, data);
    await putCachedWaveform(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!shouldRender) {
      setPath("");
      setDuration(null);
      return;
    }

    let cancelled = false;
    let hasSetProgressiveData = false; // Track if THIS extraction set any data
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    // Resolve from memory cache immediately (no defer)
    const memCached = resolvedCacheKey ? memoryCache.get(resolvedCacheKey) : null;
    if (memCached) {
      updatePath(memCached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const runExtraction = () => {
      (async () => {
        const cached = resolvedCacheKey ? memoryCache.get(resolvedCacheKey) : null;
        if (cached) {
          updatePath(cached);
          setIsLoading(false);
          return;
        }

        // For video, use progressive extraction
        if (mediaType === "video" && src) {
        try {
          const result = await extractWaveformProgressive(
            src,
            (samples, progress) => {
              if (cancelled || requestId !== latestRequest.current) return;
              hasSetProgressiveData = true;
              // Update path progressively as samples come in
              const partialData: WaveformData = {
                samples,
                durationSeconds: 0, // Will be set properly at the end
              };
              const clipped = clipSamples(partialData, offsetSeconds, durationSeconds);
              setPath(buildPath(clipped, width, height));
            },
            controller.signal
          );

          if (cancelled || requestId !== latestRequest.current) return;

          const finalData: WaveformData = {
            samples: result.samples,
            durationSeconds: result.duration,
          };
          memoryCache.set(resolvedCacheKey!, finalData);
          await putCachedWaveform(resolvedCacheKey!, finalData);
          updatePath(finalData);
          setIsLoading(false);
        } catch (err) {
          // Check if it's an abort (not a real error)
          const isAbort = cancelled || controller.signal.aborted;
          if (!isAbort) {
            console.error("[useWaveform] Progressive extraction error:", err);
          }
          // Only clear if THIS extraction set data (don't wipe out previous successful result)
          if (!cancelled && requestId === latestRequest.current && hasSetProgressiveData) {
            setIsLoading(false);
            setPath("");
          }
        }
        return;
      }

      // For audio, use direct fetch (non-progressive)
      const data = src && resolvedCacheKey
        ? await getWaveformData(resolvedCacheKey, src)
        : null;
      if (!data || cancelled || requestId !== latestRequest.current) {
        if (!cancelled && requestId === latestRequest.current) {
          setIsLoading(false);
          setPath("");
          setDuration(null);
        }
        return;
      }
      if (!cancelled) {
        updatePath(data);
        setIsLoading(false);
      }
    })();
    };

    // Defer extraction so main preview can load first
    whenIdleOrDeferred(() => {
      if (cancelled || requestId !== latestRequest.current) return;
      runExtraction();
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resolvedCacheKey, shouldRender, src, mediaType, updatePath, offsetSeconds, durationSeconds, width, height]);

  useEffect(() => {
    if (!shouldRender) return;
    const cached = resolvedCacheKey ? memoryCache.get(resolvedCacheKey) : null;
    if (cached) {
      updatePath(cached);
    }
  }, [resolvedCacheKey, shouldRender, updatePath]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { path, durationSeconds: duration, isLoading };
}
