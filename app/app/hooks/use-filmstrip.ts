"use client";

import { useEffect, useRef, useState } from "react";
import { SharedMediaLoader } from "@/app/lib/media/shared-media-loader";

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
 * Uses SharedMediaLoader to avoid duplicate fetches across filmstrip/waveform/metadata.
 * Cached by cacheKey (memory + IndexedDB). Clip segments are shown by cropping
 * the full strip in the UI (offset/duration), so cutting clips does not regenerate.
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
    if (!shouldRender || !src) {
      // Don't clear existing data when temporarily disabled
      // Only clear if we have no src at all
      if (!src) {
        setFilmstripDataUrl(null);
        setSourceDurationSeconds(null);
      }
      return;
    }

    let cancelled = false;
    const requestId = ++latestRequest.current;

    const run = async () => {
      // Check cache first (fast path)
      const cached = await SharedMediaLoader.loadFilmstripFromCache(src, width, height);
      if (cached && !cancelled && requestId === latestRequest.current) {
        setFilmstripDataUrl(cached.dataUrl);
        setSourceDurationSeconds(cached.sourceDuration > 0 ? cached.sourceDuration : null);
        setIsLoading(false);
        return;
      }

      // Also check for metadata cache to get duration early
      const cachedMeta = await SharedMediaLoader.loadFromCache(src);
      if (cachedMeta.metadata && !cancelled && requestId === latestRequest.current) {
        setSourceDurationSeconds(cachedMeta.metadata.duration || null);
      }

      setIsLoading(true);

      // Subscribe to updates from the shared loader
      const unsubscribe = SharedMediaLoader.subscribe(
        src,
        { needsFilmstrip: true, filmstripWidth: width, filmstripHeight: height },
        (partial) => {
          if (cancelled || requestId !== latestRequest.current) return;

          if (partial.metadata) {
            setSourceDurationSeconds(partial.metadata.duration || null);
          }
          if (partial.filmstrip) {
            setFilmstripDataUrl(partial.filmstrip.dataUrl);
            setSourceDurationSeconds(partial.filmstrip.sourceDuration || null);
            setIsLoading(false);
          }
        }
      );

      try {
        // Request extraction (queued, deduplicated)
        // NOTE: Don't pass abort signal - let SharedMediaLoader complete and cache
        // even if this component re-renders. Result will be available for next request.
        const result = await SharedMediaLoader.requestExtraction(src, {
          needsFilmstrip: true,
          filmstripWidth: width,
          filmstripHeight: height,
        });

        if (cancelled || requestId !== latestRequest.current) return;

        // Set final result
        if (result.filmstrip) {
          setFilmstripDataUrl(result.filmstrip.dataUrl);
          setSourceDurationSeconds(result.filmstrip.sourceDuration || null);
        }
        setSourceDurationSeconds(result.metadata.duration || null);
      } catch (err) {
        // On error, DON'T clear the filmstrip data
        // Keep showing the old data until new data arrives
        if (!cancelled) {
          console.error("[useFilmstrip] Extraction error:", err);
        }
      } finally {
        unsubscribe();
        if (!cancelled && requestId === latestRequest.current) {
          setIsLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [src, resolvedCacheKey, shouldRender, width, height]);

  return { filmstripDataUrl, sourceDurationSeconds, isLoading };
}
