/**
 * Collects unique video, audio, and image URLs from timeline layers for preloading.
 * Call with resolved layers (src set at preview time; never stored).
 */

import type { ResolvedLayer, ResolvedVideoClip, ResolvedAudioClip, ResolvedImageClip } from "@/app/types/timeline";

export interface TimelineMediaUrl {
  src: string;
  type: "video" | "audio" | "image";
  /** Clip start time for optional priority ordering (earlier = preload first). */
  start?: number;
}

/**
 * Returns a deduplicated list of media URLs from resolved layers (for preload).
 */
export function getTimelineMediaUrls(layers: ResolvedLayer[]): TimelineMediaUrl[] {
  const seen = new Set<string>();
  const result: TimelineMediaUrl[] = [];

  for (const layer of layers) {
    if (layer.type === "video") {
      for (const clip of layer.clips as ResolvedVideoClip[]) {
        if (clip.src && !seen.has(clip.src)) {
          seen.add(clip.src);
          result.push({
            src: clip.src,
            type: "video",
            start: clip.start,
          });
        }
        if (clip.maskSrc && !seen.has(clip.maskSrc)) {
          seen.add(clip.maskSrc);
          result.push({
            src: clip.maskSrc,
            type: "video",
            start: clip.start,
          });
        }
      }
    } else if (layer.type === "audio") {
      for (const clip of layer.clips as ResolvedAudioClip[]) {
        if (clip.src && !seen.has(clip.src)) {
          seen.add(clip.src);
          result.push({
            src: clip.src,
            type: "audio",
            start: clip.start,
          });
        }
      }
    } else if (layer.type === "image") {
      for (const clip of layer.clips as ResolvedImageClip[]) {
        if (clip.src && !seen.has(clip.src)) {
          seen.add(clip.src);
          result.push({
            src: clip.src,
            type: "image",
            start: clip.start,
          });
        }
      }
    }
  }

  return result;
}
