"use client";

import { useEffect, useRef, useState } from "react";
import type { ResolvedLayer } from "@/app/types/timeline";
import {
  getTimelineMediaUrls,
  type TimelineMediaUrl,
} from "@/app/lib/media/timeline-media-urls";

const PRELOAD_CONCURRENCY = 3;

export interface PreloadProgress {
  /** Total number of assets to preload this run (video + audio URLs). */
  total: number;
  /** Number that have finished loading (canplay/loadeddata/error). */
  loaded: number;
}

function preloadOne(
  item: TimelineMediaUrl,
  controller: AbortController
): Promise<void> {
  if (item.type === "image") {
    return new Promise((resolve) => {
      const el = document.createElement("img");
      el.style.position = "absolute";
      el.style.width = "0";
      el.style.height = "0";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);

      const onDone = () => {
        el.removeEventListener("load", onLoad);
        el.removeEventListener("error", onError);
        el.remove();
        resolve();
      };

      const onLoad = () => onDone();
      const onError = () => onDone();

      el.addEventListener("load", onLoad, { once: true });
      el.addEventListener("error", onError, { once: true });

      if (controller.signal.aborted) {
        el.remove();
        resolve();
        return;
      }
      controller.signal.addEventListener(
        "abort",
        () => {
          el.remove();
          resolve();
        },
        { once: true }
      );

      el.src = item.src;
    });
  }

  return new Promise((resolve) => {
    const el =
      item.type === "video"
        ? document.createElement("video")
        : document.createElement("audio");
    el.preload = "auto";
    el.style.position = "absolute";
    el.style.width = "0";
    el.style.height = "0";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);

    const onDone = () => {
      el.removeEventListener("canplay", onCanplay);
      el.removeEventListener("error", onError);
      el.removeEventListener("loadeddata", onLoadedData);
      el.remove();
      resolve();
    };

    const onCanplay = () => onDone();
    const onLoadedData = () => onDone();
    const onError = () => onDone();

    el.addEventListener("canplay", onCanplay, { once: true });
    el.addEventListener("loadeddata", onLoadedData, { once: true });
    el.addEventListener("error", onError, { once: true });

    if (controller.signal.aborted) {
      el.remove();
      resolve();
      return;
    }
    controller.signal.addEventListener(
      "abort",
      () => {
        el.remove();
        resolve();
      },
      { once: true }
    );

    el.src = item.src;
  });
}

async function preloadQueue(
  items: TimelineMediaUrl[],
  concurrency: number,
  controller: AbortController,
  onItemDone: () => void
): Promise<void> {
  const queue = [...items];
  let active = 0;

  const runNext = (): Promise<void> => {
    if (controller.signal.aborted || queue.length === 0) {
      if (active === 0) return Promise.resolve();
      return new Promise((r) => {
        const check = () => {
          if (active === 0) r();
          else setTimeout(check, 50);
        };
        check();
      });
    }
    const item = queue.shift();
    if (!item) return Promise.resolve();
    active++;
    return preloadOne(item, controller).then(() => {
      onItemDone();
      active--;
      return runNext();
    });
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext()
  );
  await Promise.all(workers);
}

/**
 * Stable key for the set of media URLs in the timeline so the preload effect
 * reruns whenever we add/remove a clip that changes which assets are used.
 */
function getTimelineMediaUrlsKey(layers: ResolvedLayer[]): string {
  const urls = getTimelineMediaUrls(layers);
  return urls
    .map((u) => u.src)
    .sort()
    .join("\n");
}

/**
 * Preloads all video and audio URLs used in the timeline so that when Motion Canvas
 * reaches each clip during preview, the media is already in the browser cache.
 * Runs in the background with limited concurrency; does not block the UI.
 * Reruns whenever the set of media URLs in the timeline changes (e.g. adding a new clip).
 * Returns progress { total, loaded } for showing a preload indicator.
 */
export function usePreloadTimelineMedia(
  layers: ResolvedLayer[],
  options?: { enabled?: boolean }
): PreloadProgress {
  const enabled = options?.enabled !== false;
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const controllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<PreloadProgress>({ total: 0, loaded: 0 });

  const urlsKey = getTimelineMediaUrlsKey(layers);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    const urls = getTimelineMediaUrls(layers);
    if (urls.length === 0) {
      setProgress({ total: 0, loaded: 0 });
      return;
    }

    // Sort by clip start so earlier clips are preloaded first
    const sorted = [...urls].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

    // Skip URLs we already preloaded (same set from previous run)
    const toPreload = sorted.filter((u) => !preloadedUrlsRef.current.has(u.src));
    if (toPreload.length === 0) {
      setProgress({ total: 0, loaded: 0 });
      return;
    }

    setProgress({ total: toPreload.length, loaded: 0 });
    const controller = new AbortController();
    controllerRef.current = controller;

    preloadQueue(toPreload, PRELOAD_CONCURRENCY, controller, () => {
      setProgress((prev) => ({
        ...prev,
        loaded: Math.min(prev.loaded + 1, prev.total),
      }));
    }).then(() => {
      if (!controller.signal.aborted) {
        toPreload.forEach((u) => preloadedUrlsRef.current.add(u.src));
      }
    });

    return () => {
      controller.abort();
      controllerRef.current = null;
    };
  }, [urlsKey, enabled, layers]);

  return progress;
}
