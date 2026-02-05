"use client";

import { useEffect, useRef, useState } from "react";
import { SharedMediaLoader, type FilmstripResult } from "@/app/lib/media/shared-media-loader";

export interface UseFilmstripInput {
  /** Video source URL */
  src: string | undefined;
}

export interface UseFilmstripResult {
  /** Data URL of the filmstrip image (fixed 600x40 dimensions) */
  filmstripDataUrl: string | null;
  /** Full source duration in seconds; use with clip offset/duration for CSS crop */
  sourceDurationSeconds: number | null;
  /** Fixed width of the filmstrip image */
  filmstripWidth: number | null;
  /** Fixed height of the filmstrip image */
  filmstripHeight: number | null;
  isLoading: boolean;
}

/**
 * Extract video frames for the full source into a filmstrip image.
 * 
 * Filmstrips are generated at fixed dimensions (600x40) and cached by source URL.
 * The UI should use CSS to scale/crop the filmstrip to fit the clip width.
 * This means:
 * - Filmstrip is extracted ONCE per video (not per zoom level)
 * - No re-extraction on zoom/resize
 * - Cropping for trimmed clips is done via CSS
 */
export function useFilmstrip({ src }: UseFilmstripInput): UseFilmstripResult {
  const [filmstrip, setFilmstrip] = useState<FilmstripResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!src) {
      setFilmstrip(null);
      return;
    }

    let cancelled = false;
    const requestId = ++latestRequest.current;

    const run = async () => {
      // Check cache first (fast path)
      const cached = await SharedMediaLoader.loadFilmstripFromCache(src);
      if (cached && !cancelled && requestId === latestRequest.current) {
        setFilmstrip(cached);
        setIsLoading(false);
        return;
      }

      // Also check for cached data that might have filmstrip
      const cachedData = await SharedMediaLoader.loadFromCache(src);
      if (cachedData.filmstrip && !cancelled && requestId === latestRequest.current) {
        setFilmstrip(cachedData.filmstrip);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      // Subscribe to updates from the shared loader
      const unsubscribe = SharedMediaLoader.subscribe(
        src,
        { needsFilmstrip: true },
        (partial) => {
          if (cancelled || requestId !== latestRequest.current) return;

          if (partial.filmstrip) {
            setFilmstrip(partial.filmstrip);
            setIsLoading(false);
          }
        }
      );

      try {
        // Request extraction (queued, deduplicated)
        const result = await SharedMediaLoader.requestExtraction(src, {
          needsFilmstrip: true,
        });

        if (cancelled || requestId !== latestRequest.current) return;

        if (result.filmstrip) {
          setFilmstrip(result.filmstrip);
        }
      } catch (err) {
        // On error, DON'T clear the filmstrip data
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
  }, [src]);

  return {
    filmstripDataUrl: filmstrip?.dataUrl ?? null,
    sourceDurationSeconds: filmstrip?.sourceDuration ?? null,
    filmstripWidth: filmstrip?.width ?? null,
    filmstripHeight: filmstrip?.height ?? null,
    isLoading,
  };
}
