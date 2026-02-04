"use client";

import {
  ASSET_DRAG_DATA_MIME,
  type AssetDragPayload,
  type AssetType,
  DEFAULT_ASSET_DURATIONS,
} from "@/app/types/assets";
import {
  TEMPLATE_DRAG_DATA_MIME,
  type TemplateDragPayload,
} from "@/app/types/templates";
import type { ClipType, TextClip, TimelineClip } from "@/app/types/timeline";
import {
  createAudioClip,
  createImageClip,
  createVideoClip,
  createTextClipFromTemplate,
} from "@/app/types/timeline";

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

const IMAGE_CLIP_DEFAULT_DURATION = 5;

export function createClipFromAsset(payload: AssetDragPayload, start: number): TimelineClip {
  const sourceDuration =
    typeof payload.duration === "number" && payload.duration > 0
      ? payload.duration
      : undefined;
  const duration =
    payload.type === "image"
      ? IMAGE_CLIP_DEFAULT_DURATION
      : sourceDuration ?? DEFAULT_ASSET_DURATIONS[payload.type] ?? 5;
  const name = payload.name || "Uploaded Asset";
  const options = {
    assetId: payload.id,
    width: payload.width,
    height: payload.height,
    sourceDuration,
  };
  switch (payload.type) {
    case "audio":
      return createAudioClip(payload.url, name, start, duration, { assetId: payload.id, sourceDuration });
    case "image":
      return createImageClip(payload.url, name, start, IMAGE_CLIP_DEFAULT_DURATION, options);
    case "video":
    case "other":
    default:
      return createVideoClip(payload.url, name, start, duration, options);
  }
}

// Template drag utilities

export function hasTemplateDragData(event: React.DragEvent | DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes(TEMPLATE_DRAG_DATA_MIME);
}

export function readDraggedTemplate(event: React.DragEvent | DragEvent): TemplateDragPayload | null {
  const raw = event.dataTransfer?.getData(TEMPLATE_DRAG_DATA_MIME);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as TemplateDragPayload;
    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}

export function createClipFromTemplate(payload: TemplateDragPayload, start: number): TextClip {
  return createTextClipFromTemplate(payload.templateType, start, payload.duration);
}
