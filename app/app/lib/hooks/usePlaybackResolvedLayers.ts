"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layer } from "@/app/types/timeline";

// Match legacy /file and logical /playback paths (both resolved via playback-url API)
const PLAYBACK_PATH_RE = /^\/api\/assets\/([^/]+)\/(?:file|playback)\?projectId=([^&]+)(&|$)/;

function isPlaybackPath(src: string): boolean {
  return PLAYBACK_PATH_RE.test(src);
}

function parsePlaybackPath(src: string): { assetId: string; projectId: string } | null {
  const m = src.match(PLAYBACK_PATH_RE);
  if (!m) return null;
  return { assetId: m[1]!, projectId: m[2]! };
}

/**
 * Resolves /api/assets/.../file or .../playback paths to signed GCS playback URLs
 * so the browser loads media directly from GCS.
 * Returns resolved layers and a ready flag (false while fetching).
 */
export function usePlaybackResolvedLayers(
  layers: Layer[],
  projectId: string | null,
  options?: { enabled?: boolean }
): { layers: Layer[]; ready: boolean } {
  const enabled = options?.enabled !== false && !!projectId;
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(!enabled);

  const playbackPaths = useMemo(() => {
    if (!enabled) return [];
    const out: string[] = [];
    for (const layer of layers) {
      if (layer.type === "video") {
        for (const clip of layer.clips) {
          const v = clip as { src?: string; maskSrc?: string };
          if (v.src && isPlaybackPath(v.src) && !out.includes(v.src)) out.push(v.src);
          if (v.maskSrc && isPlaybackPath(v.maskSrc) && !out.includes(v.maskSrc)) out.push(v.maskSrc);
        }
      } else if (layer.type === "audio" || layer.type === "image") {
        for (const clip of layer.clips) {
          const c = clip as { src?: string };
          if (c.src && isPlaybackPath(c.src) && !out.includes(c.src)) out.push(c.src);
        }
      }
    }
    return out;
  }, [enabled, layers]);

  useEffect(() => {
    if (!enabled || playbackPaths.length === 0) {
      setUrlMap({});
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    const fetchAll = async () => {
      const map: Record<string, string> = {};
      await Promise.all(
        playbackPaths.map(async (path) => {
          const parsed = parsePlaybackPath(path);
          if (!parsed || cancelled) return;
          try {
            const res = await fetch(
              `/api/assets/${parsed.assetId}/playback-url?projectId=${encodeURIComponent(parsed.projectId)}`,
              { credentials: "include" }
            );
            if (!res.ok || cancelled) return;
            const data = await res.json();
            if (data?.url && !cancelled) map[path] = data.url;
          } catch {
            // Leave path unresolved (will 404 if used as src)
          }
        })
      );
      if (!cancelled) {
        setUrlMap((prev) => ({ ...prev, ...map }));
        setReady(true);
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [enabled, playbackPaths.join(" ")]);

  const resolvedLayers = useMemo((): Layer[] => {
    if (!enabled || Object.keys(urlMap).length === 0) return layers;
    return layers.map((layer) => {
      if (layer.type === "video") {
        return {
          ...layer,
          clips: layer.clips.map((clip) => {
            const v = clip as unknown as { src?: string; maskSrc?: string };
            const src = (v.src && urlMap[v.src] ? urlMap[v.src] : v.src) ?? (clip as { src: string }).src;
            const maskSrc = v.maskSrc && urlMap[v.maskSrc] ? urlMap[v.maskSrc] : v.maskSrc;
            return { ...clip, src, ...(maskSrc !== undefined && { maskSrc }) };
          }),
        };
      }
      if (layer.type === "audio" || layer.type === "image") {
        return {
          ...layer,
          clips: layer.clips.map((clip) => {
            const c = clip as unknown as { src?: string };
            const src = (c.src && urlMap[c.src] ? urlMap[c.src] : c.src) ?? (clip as { src: string }).src;
            return { ...clip, src };
          }),
        };
      }
      return layer;
    });
  }, [enabled, layers, urlMap]);

  return { layers: resolvedLayers, ready };
}
