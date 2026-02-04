/**
 * Collects unique video, audio, and image URLs from timeline layers for preloading.
 * Used so the preview can warm the browser cache before playback.
 */

import type { Layer, VideoClip, AudioClip, ImageClip } from "@/app/types/timeline";

export interface TimelineMediaUrl {
  src: string;
  type: "video" | "audio" | "image";
  /** Clip start time for optional priority ordering (earlier = preload first). */
  start?: number;
}

/**
 * Returns a deduplicated list of media URLs (video, audio, image) from the given layers.
 * Includes main clip src and, for video clips, maskSrc when present.
 */
export function getTimelineMediaUrls(layers: Layer[]): TimelineMediaUrl[] {
  const seen = new Set<string>();
  const result: TimelineMediaUrl[] = [];

  for (const layer of layers) {
    if (layer.type === "video") {
      for (const clip of layer.clips as VideoClip[]) {
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
      for (const clip of layer.clips as AudioClip[]) {
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
      for (const clip of layer.clips as ImageClip[]) {
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
