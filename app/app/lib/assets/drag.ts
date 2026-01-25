"use client";

import {
  ASSET_DRAG_DATA_MIME,
  type AssetDragPayload,
  type AssetType,
  DEFAULT_ASSET_DURATIONS,
} from "@/app/types/assets";
import type { ClipType, TimelineClip } from "@/app/types/timeline";
import { createAudioClip, createImageClip, createVideoClip } from "@/app/types/timeline";

export function hasAssetDragData(event: React.DragEvent | DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes(ASSET_DRAG_DATA_MIME);
}

export function readDraggedAsset(event: React.DragEvent | DragEvent): AssetDragPayload | null {
  const raw = event.dataTransfer?.getData(ASSET_DRAG_DATA_MIME);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as AssetDragPayload;
    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}

export function assetMatchesLayer(assetType: AssetType, layerType: ClipType) {
  if (assetType === "other") return layerType === "video";
  return assetType === layerType;
}

export function createClipFromAsset(payload: AssetDragPayload, start: number): TimelineClip {
  const duration =
    typeof payload.duration === "number" && payload.duration > 0
      ? payload.duration
      : DEFAULT_ASSET_DURATIONS[payload.type] ?? 5;
  const name = payload.name || "Uploaded Asset";
  const options = {
    assetId: payload.id,
    width: payload.width,
    height: payload.height,
  };
  switch (payload.type) {
    case "audio":
      return createAudioClip(payload.url, name, start, duration, { assetId: payload.id });
    case "image":
      return createImageClip(payload.url, name, start, duration, options);
    case "video":
    case "other":
    default:
      return createVideoClip(payload.url, name, start, duration, options);
  }
}
