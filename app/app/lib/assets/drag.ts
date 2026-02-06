"use client";

import {
  ASSET_DRAG_DATA_MIME,
  type AssetDragPayload,
  type AssetType,
} from "@/app/types/assets";
import {
  TEMPLATE_DRAG_DATA_MIME,
  type TemplateDragPayload,
} from "@/app/types/templates";
import type { ClipType, TextClip } from "@/app/types/timeline";
import { createTextClipFromTemplate } from "@/app/types/timeline";

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
