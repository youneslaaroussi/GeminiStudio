"use client";

import { useEffect, useRef, useState } from "react";
import { extractFrames } from "@/app/lib/media/extract-frames";
import { getVideoMetadata } from "@/app/lib/media/video-media-cache";

const DB_NAME = "gemini-studio-filmstrips";
const STORE_NAME = "filmstrips";
const memoryCache = new Map<string, CachedFilmstrip>();

/** Defer work so main preview can load first (avoids competing for same asset). */
const DEFER_MS = 5000;
function whenIdleOrDeferred(cb: () => void): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(cb, { timeout: DEFER_MS });
  } else {
    setTimeout(cb, DEFER_MS);
  }
}

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

interface CachedFilmstrip {
  dataUrl: string;
  sourceDuration: number;
}

async function getCachedFilmstrip(key: string): Promise<CachedFilmstrip | null> {
  const mem = memoryCache.get(key);
  if (mem) return mem;
  try {
    const db = await openFilmstripDb();
    if (!db) return null;
    return await new Promise<CachedFilmstrip | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value == null) {
          resolve(null);
          return;
        }
        if (typeof value === "string") {
          resolve({ dataUrl: value, sourceDuration: 0 });
          return;
        }
        resolve(
          value.dataUrl && typeof value.sourceDuration === "number"
            ? { dataUrl: value.dataUrl, sourceDuration: value.sourceDuration }
            : null
        );
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function putCachedFilmstrip(
  key: string,
  data: CachedFilmstrip
): Promise<void> {
  memoryCache.set(key, data);
  try {
    const db = await openFilmstripDb();
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

export interface UseFilmstripInput {
  src: string | undefined;
  cacheKey: string | undefined;
  width: number;
  height: number;
}

export interface UseFilmstripResult {
  filmstripDataUrl: string | null;
  /** Full source duration in seconds; use with clip offset/duration for CSS crop. */
  sourceDurationSeconds: number | null;
  isLoading: boolean;
}

/**
 * Extract video frames for the full source into a filmstrip image (one per asset).
 * Cached by cacheKey (memory + IndexedDB). Clip segments are shown by cropping
 * the full strip in the UI (offset/duration), so cutting clips does not regenerate.
 * Extraction is deferred so main preview can load first and avoid competing for the same asset.
 */
export function useFilmstrip({
  src,
  cacheKey,
  width,
  height,
}: UseFilmstripInput): UseFilmstripResult {
  const [filmstripDataUrl, setFilmstripDataUrl] = useState<string | null>(null);
  const [sourceDurationSeconds, setSourceDurationSeconds] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestRequest = useRef(0);

  const resolvedCacheKey = cacheKey ?? src;

  const shouldRender = Boolean(
    src && resolvedCacheKey && width > 0 && height > 0
  );

  useEffect(() => {
    if (!shouldRender) {
      setFilmstripDataUrl(null);
      setSourceDurationSeconds(null);
      return;
    }

    let cancelled = false;
    let hasSetProgressiveData = false;
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    const runExtraction = () => {
      (async () => {
        const cached = await getCachedFilmstrip(resolvedCacheKey!);
        if (cached && !cancelled && requestId === latestRequest.current) {
          setFilmstripDataUrl(cached.dataUrl);
          setSourceDurationSeconds(
            cached.sourceDuration > 0 ? cached.sourceDuration : null
          );
          if (cached.sourceDuration === 0) {
            getVideoMetadata(src!).then((meta) => {
              if (!cancelled && requestId === latestRequest.current) {
                setSourceDurationSeconds(meta.duration || null);
              }
            });
          }
          setIsLoading(false);
          return;
        }

        setIsLoading(true);

        try {
          const metadata = await getVideoMetadata(src!);
          if (cancelled) return;

          const sourceDuration = metadata.duration || 10;
          setSourceDurationSeconds(sourceDuration);

          const trackWidth = metadata.width || 16;
          const trackHeight = metadata.height || 9;
          const aspectRatio = trackWidth / trackHeight;
          const idealFrameCount = Math.ceil(width / (height * aspectRatio));
          const MAX_FRAMES = 30;
          const amountOfFramesFit = Math.max(1, Math.min(idealFrameCount, MAX_FRAMES));

          const timestamps: number[] = [];
          for (let i = 0; i < amountOfFramesFit; i++) {
            timestamps.push(
              (sourceDuration / amountOfFramesFit) * (i + 0.5)
            );
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            setIsLoading(false);
            return;
          }

          let slotIndex = 0;
          const slotWidth = width / timestamps.length;
          let lastUpdateTime = 0;
          const UPDATE_INTERVAL_MS = 150;

          await extractFrames({
            src: src!,
            timestampsInSeconds: timestamps,
            onVideoSample: (sample) => {
              if (cancelled) return;
              const dx = slotIndex * slotWidth;
              const sampleAspect = sample.displayWidth / sample.displayHeight;
              const slotAspect = slotWidth / height;
              let drawWidth: number;
              let drawHeight: number;
              if (sampleAspect > slotAspect) {
                drawHeight = height;
                drawWidth = height * sampleAspect;
              } else {
                drawWidth = slotWidth;
                drawHeight = slotWidth / sampleAspect;
              }
              const drawX = dx + (slotWidth - drawWidth) / 2;
              const drawY = (height - drawHeight) / 2;
              sample.draw(ctx, drawX, drawY, drawWidth, drawHeight);
              slotIndex++;
              const now = performance.now();
              if (now - lastUpdateTime > UPDATE_INTERVAL_MS || slotIndex === timestamps.length) {
                lastUpdateTime = now;
                if (!cancelled && requestId === latestRequest.current) {
                  hasSetProgressiveData = true;
                  setFilmstripDataUrl(canvas.toDataURL("image/jpeg", 0.7));
                }
              }
            },
            signal: controller.signal,
          });

          if (cancelled || requestId !== latestRequest.current) return;

          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          setFilmstripDataUrl(dataUrl);
          await putCachedFilmstrip(resolvedCacheKey!, {
            dataUrl,
            sourceDuration: sourceDuration,
          });
        } catch (err) {
          const isAbort =
            cancelled ||
            controller.signal.aborted ||
            (err instanceof Error && err.message === "Aborted");
          if (isAbort && hasSetProgressiveData) {
            setFilmstripDataUrl(null);
          } else if (!isAbort && requestId === latestRequest.current) {
            setFilmstripDataUrl(null);
          }
        } finally {
          if (!cancelled && requestId === latestRequest.current) {
            setIsLoading(false);
          }
        }
      })();
    };

    // If cache hit (memory or IDB), show immediately; otherwise defer extraction so preview can load first
    (async () => {
      const cached = await getCachedFilmstrip(resolvedCacheKey!);
      if (cached && !cancelled && requestId === latestRequest.current) {
        setFilmstripDataUrl(cached.dataUrl);
        setSourceDurationSeconds(
          cached.sourceDuration > 0 ? cached.sourceDuration : null
        );
        if (cached.sourceDuration === 0) {
          getVideoMetadata(src!).then((meta) => {
            if (!cancelled && requestId === latestRequest.current) {
              setSourceDurationSeconds(meta.duration || null);
            }
          });
        }
        setIsLoading(false);
        return;
      }
      whenIdleOrDeferred(() => {
        if (cancelled || requestId !== latestRequest.current) return;
        runExtraction();
      });
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [src, resolvedCacheKey, shouldRender, width, height]);

  return { filmstripDataUrl, sourceDurationSeconds, isLoading };
}
