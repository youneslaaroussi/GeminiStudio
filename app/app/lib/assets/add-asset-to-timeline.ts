"use client";

import type { AssetType } from "@/app/types/assets";
import { DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";
import type { TimelineClip } from "@/app/types/timeline";
import {
  createAudioClip,
  createImageClip,
  createVideoClip,
} from "@/app/types/timeline";

const IMAGE_CLIP_DEFAULT_DURATION = 5;

export interface AddAssetToTimelineParams {
  assetId: string;
  projectId: string | null;
  type: AssetType;
  name: string;
  duration: number;
  start: number;
  width?: number;
  height?: number;
  sourceDuration?: number;
  layerId?: string;
  addClip: (clip: TimelineClip, layerId?: string) => void;
}

/**
 * Single code path for adding an asset to the timeline.
 * Fetches a signed playback URL; only adds the clip if we get one.
 * Used by both the Add button in the assets panel and by drag-and-drop.
 */
export async function addAssetToTimeline(
  params: AddAssetToTimelineParams
): Promise<boolean> {
  const {
    assetId,
    projectId,
    type,
    name,
    duration,
    start,
    width,
    height,
    sourceDuration,
    layerId,
    addClip,
  } = params;

  if (!projectId) {
    return false;
  }

  // Verify playback URL exists before adding (we never store URL; resolve at preview/render)
  const res = await fetch(
    `/api/assets/${assetId}/playback-url?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" }
  );
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as { url?: string };
  if (!data?.url || !data.url.startsWith("http")) {
    return false;
  }

  const clipName = name || "Asset";
  const resolvedDuration =
    type === "image" ? IMAGE_CLIP_DEFAULT_DURATION : (duration || DEFAULT_ASSET_DURATIONS[type]) ?? 5;
  const resolvedSourceDuration = sourceDuration ?? resolvedDuration;

  if (type === "video" || type === "other") {
    addClip(
      createVideoClip(assetId, clipName, start, resolvedDuration, {
        width,
        height,
        sourceDuration: resolvedSourceDuration,
      }),
      layerId
    );
  } else if (type === "audio") {
    addClip(
      createAudioClip(assetId, clipName, start, resolvedDuration, {
        sourceDuration: resolvedSourceDuration,
      }),
      layerId
    );
  } else if (type === "image") {
    addClip(
      createImageClip(assetId, clipName, start, IMAGE_CLIP_DEFAULT_DURATION, { width, height }),
      layerId
    );
  } else {
    return false;
  }

  return true;
}
