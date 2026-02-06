"use client";

import { useMemo, useState, useEffect } from "react";
import type {
  Layer,
  ResolvedLayer,
  ResolvedTimelineClip,
  VideoClip,
  AudioClip,
  ImageClip,
} from "@/app/types/timeline";

/**
 * Resolve assetId → signed playback URL for each clip.
 * Returns layers with src (and maskSrc for video) set — for preview/render only; never persisted.
 */
export function usePlaybackResolvedLayers(
  layers: Layer[],
  projectId: string | null,
  _options?: { enabled?: boolean }
): { layers: ResolvedLayer[]; ready: boolean } {
  const [urlCache, setUrlCache] = useState<Map<string, string>>(new Map());
  const [fetchPassDone, setFetchPassDone] = useState(false);

  // Collect unique asset IDs (main + mask)
  const assetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const layer of layers) {
      for (const clip of layer.clips) {
        if (clip.type !== "text" && "assetId" in clip && clip.assetId) {
          ids.add(clip.assetId);
        }
        if (clip.type === "video" && "maskAssetId" in clip && clip.maskAssetId) {
          ids.add(clip.maskAssetId);
        }
      }
    }
    return Array.from(ids);
  }, [layers]);

  // Fetch playback URLs for all asset IDs
  useEffect(() => {
    if (!projectId || assetIds.length === 0) {
      setUrlCache(new Map());
      setFetchPassDone(true);
      return;
    }
    setFetchPassDone(false);
    let cancelled = false;
    const next = new Map<string, string>();

    Promise.all(
      assetIds.map(async (assetId) => {
        const res = await fetch(
          `/api/assets/${assetId}/playback-url?projectId=${encodeURIComponent(projectId)}`,
          { credentials: "include" }
        );
        if (!res.ok || cancelled) return { assetId, url: null };
        const data = (await res.json()) as { url?: string };
        const url = data?.url && data.url.startsWith("http") ? data.url : null;
        return { assetId, url };
      })
    ).then((results) => {
      if (cancelled) return;
      for (const { assetId, url } of results) {
        if (url) next.set(assetId, url);
      }
      setUrlCache(next);
      setFetchPassDone(true);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, assetIds.join(",")]);

  const resolvedLayers = useMemo((): ResolvedLayer[] => {
    return layers.map((layer) => ({
      ...layer,
      clips: layer.clips.map((clip): ResolvedTimelineClip => {
        if (clip.type === "text") return clip;
        const assetId = "assetId" in clip ? clip.assetId : undefined;
        const src = assetId ? urlCache.get(assetId) ?? "" : "";
        if (clip.type === "video") {
          const v = clip as VideoClip;
          const maskSrc = v.maskAssetId ? urlCache.get(v.maskAssetId) ?? "" : undefined;
          return { ...v, src, maskSrc };
        }
        if (clip.type === "audio") {
          return { ...(clip as AudioClip), src };
        }
        return { ...(clip as ImageClip), src };
      }),
    }));
  }, [layers, urlCache]);

  const ready = assetIds.length === 0 || fetchPassDone;

  return { layers: resolvedLayers, ready };
}
