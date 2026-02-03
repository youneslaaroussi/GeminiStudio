"use client";

import { useEffect, useRef, useState } from "react";
import { extractFrames } from "@/app/lib/media/extract-frames";
import { getVideoMetadata } from "@/app/lib/media/video-media-cache";

const DB_NAME = "gemini-studio-filmstrips";
const STORE_NAME = "filmstrips";
const memoryCache = new Map<string, string>();

function openFilmstripDb(): Promise<IDBDatabase | null> {
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

async function getCachedFilmstrip(key: string): Promise<string | null> {
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  try {
    const db = await openFilmstripDb();
    if (!db) return null;
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(typeof value === "string" ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function putCachedFilmstrip(key: string, dataUrl: string): Promise<void> {
  memoryCache.set(key, dataUrl);
  try {
    const db = await openFilmstripDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(dataUrl, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore storage errors; memory cache is still populated.
  }
}

export interface UseFilmstripInput {
  src: string | undefined;
  cacheKey: string | undefined;
  width: number;
  height: number;
  offsetSeconds?: number;
  durationSeconds?: number;
}

export interface UseFilmstripResult {
  filmstripDataUrl: string | null;
  isLoading: boolean;
}

/**
 * Extract video frames into a filmstrip image using Mediabunny.
 * Frames are laid out left-to-right to fill the given width/height.
 * Result is cached by cacheKey (memory + IndexedDB).
 */
export function useFilmstrip({
  src,
  cacheKey,
  width,
  height,
  offsetSeconds = 0,
  durationSeconds,
}: UseFilmstripInput): UseFilmstripResult {
  const [filmstripDataUrl, setFilmstripDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestRequest = useRef(0);

  const resolvedCacheKey = cacheKey ?? src;

  const shouldRender = Boolean(
    src &&
      resolvedCacheKey &&
      width > 0 &&
      height > 0 &&
      (durationSeconds === undefined || durationSeconds > 0)
  );

  useEffect(() => {
    if (!shouldRender) {
      setFilmstripDataUrl(null);
      return;
    }

    let cancelled = false;
    let hasSetProgressiveData = false; // Track if THIS extraction set any data
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    (async () => {
      console.log("[Filmstrip] Starting extraction", { src, cacheKey: resolvedCacheKey, width, height, offsetSeconds, durationSeconds });
      
      const cached = await getCachedFilmstrip(resolvedCacheKey!);
      if (cached && !cancelled && requestId === latestRequest.current) {
        console.log("[Filmstrip] Found in cache");
        setFilmstripDataUrl(cached);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // Use fast metadata-only extraction (no waveform, so doesn't block)
        console.log("[Filmstrip] Getting metadata...");
        const startMeta = performance.now();
        const metadata = await getVideoMetadata(src!);
        console.log("[Filmstrip] Metadata received in", (performance.now() - startMeta).toFixed(0), "ms", metadata);
        if (cancelled) {
          console.log("[Filmstrip] Cancelled after metadata");
          return;
        }

        const sourceDuration = metadata.duration || 10;
        const fromSeconds = Math.max(0, offsetSeconds);
        const toSeconds = Math.min(
          sourceDuration,
          offsetSeconds + (durationSeconds ?? sourceDuration)
        );
        const segmentDuration = toSeconds - fromSeconds;
        if (segmentDuration <= 0) {
          console.log("[Filmstrip] Invalid segment duration", { fromSeconds, toSeconds, segmentDuration });
          setIsLoading(false);
          return;
        }

        const trackWidth = metadata.width || 16;
        const trackHeight = metadata.height || 9;
        const aspectRatio = trackWidth / trackHeight;
        
        // Calculate how many frames would fit at native aspect ratio
        const idealFrameCount = Math.ceil(width / (height * aspectRatio));
        // Cap to max 30 frames - for long videos, each frame just covers more time
        // This prevents decoder errors and keeps extraction fast
        const MAX_FRAMES = 30;
        const amountOfFramesFit = Math.max(1, Math.min(idealFrameCount, MAX_FRAMES));

        const timestamps: number[] = [];
        for (let i = 0; i < amountOfFramesFit; i++) {
          timestamps.push(
            fromSeconds + (segmentDuration / amountOfFramesFit) * (i + 0.5)
          );
        }
        console.log("[Filmstrip] Extracting", timestamps.length, "frames (ideal:", idealFrameCount, ") at timestamps:", timestamps.slice(0, 5), "...");

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          console.log("[Filmstrip] Failed to get canvas context");
          setIsLoading(false);
          return;
        }

        let slotIndex = 0;
        const slotWidth = width / timestamps.length;
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL_MS = 150; // Update UI every 150ms for smooth progressive rendering

        const startFrames = performance.now();
        await extractFrames({
          src: src!,
          timestampsInSeconds: timestamps,
          onVideoSample: (sample) => {
            if (cancelled) return;
            const dx = slotIndex * slotWidth;
            const sampleAspect = sample.displayWidth / sample.displayHeight;
            const slotAspect = slotWidth / height;
            
            // Use "cover" style - fill the slot completely, crop overflow
            let drawWidth: number;
            let drawHeight: number;
            if (sampleAspect > slotAspect) {
              // Sample is wider than slot - fit height, crop sides
              drawHeight = height;
              drawWidth = height * sampleAspect;
            } else {
              // Sample is taller than slot - fit width, crop top/bottom
              drawWidth = slotWidth;
              drawHeight = slotWidth / sampleAspect;
            }
            const drawX = dx + (slotWidth - drawWidth) / 2;
            const drawY = (height - drawHeight) / 2;
            sample.draw(ctx, drawX, drawY, drawWidth, drawHeight);
            slotIndex++;
            
            // Progressive rendering - update the UI periodically as frames come in
            const now = performance.now();
            if (now - lastUpdateTime > UPDATE_INTERVAL_MS || slotIndex === timestamps.length) {
              lastUpdateTime = now;
              if (!cancelled && requestId === latestRequest.current) {
                hasSetProgressiveData = true;
                const progressDataUrl = canvas.toDataURL("image/jpeg", 0.7); // Lower quality for progress updates
                setFilmstripDataUrl(progressDataUrl);
                console.log("[Filmstrip] Progressive update:", slotIndex, "/", timestamps.length);
              }
            }
          },
          signal: controller.signal,
        });
        console.log("[Filmstrip] Frames extracted in", (performance.now() - startFrames).toFixed(0), "ms, drew", slotIndex, "frames");

        if (cancelled || requestId !== latestRequest.current) {
          console.log("[Filmstrip] Cancelled after extraction");
          return;
        }

        // Final high-quality render
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        console.log("[Filmstrip] Generated final data URL, length:", dataUrl.length);
        setFilmstripDataUrl(dataUrl);
        await putCachedFilmstrip(resolvedCacheKey!, dataUrl);
        console.log("[Filmstrip] Cached and set!");
      } catch (err) {
        // Check if it's an abort error (not a real error)
        const isAbort = cancelled || controller.signal.aborted || 
          (err instanceof Error && err.message === "Aborted");
        
        if (isAbort) {
          // Only clear if THIS extraction set progressive data (don't wipe out previous successful result)
          if (hasSetProgressiveData) {
            console.log("[Filmstrip] Aborted, clearing partial data from this extraction");
            setFilmstripDataUrl(null);
          } else {
            console.log("[Filmstrip] Aborted before setting any data, keeping previous result");
          }
        } else {
          console.error("[Filmstrip] Error:", err);
          if (requestId === latestRequest.current) {
            setFilmstripDataUrl(null);
          }
        }
      } finally {
        if (!cancelled && requestId === latestRequest.current) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    src,
    resolvedCacheKey,
    shouldRender,
    width,
    height,
    offsetSeconds,
    durationSeconds,
  ]);

  return { filmstripDataUrl, isLoading };
}
