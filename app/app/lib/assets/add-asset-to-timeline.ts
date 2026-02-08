"use client";

import type { AssetType, ComponentInputDef } from "@/app/types/assets";
import { DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";
import type { TimelineClip } from "@/app/types/timeline";
import {
  createAudioClip,
  createImageClip,
  createVideoClip,
  createComponentClip,
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
  // Component-specific fields (resolved from asset fetch if missing)
  componentName?: string;
  inputDefs?: ComponentInputDef[];
}

/**
 * Resolve component name and inputDefs for a component asset.
 * Uses provided params; if missing, fetches full asset from API (e.g. when adding from Assets tab).
 */
async function resolveComponentAssetParams(
  assetId: string,
  projectId: string,
  provided: { componentName?: string; inputDefs?: ComponentInputDef[]; name?: string; width?: number; height?: number }
): Promise<{ componentName: string; inputDefs: ComponentInputDef[]; name: string; width?: number; height?: number } | null> {
  const { componentName, inputDefs, name, width, height } = provided;
  // Use provided data when we have componentName (inputDefs can be empty or omitted)
  if (componentName) {
    return {
      componentName,
      inputDefs: inputDefs ?? [],
      name: name || "Component",
      width,
      height,
    };
  }
  const res = await fetch(
    `/api/assets/${assetId}?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { asset?: { componentName?: string; inputDefs?: ComponentInputDef[]; name?: string; width?: number; height?: number } };
  const asset = data?.asset;
  if (!asset) return null;
  return {
    componentName: asset.componentName ?? "MyComponent",
    inputDefs: asset.inputDefs ?? [],
    name: asset.name ?? name ?? "Component",
    width: asset.width ?? width,
    height: asset.height ?? height,
  };
}

/**
 * Single code path for adding an asset to the timeline.
 * Used by the Add button in the assets panel, the Components panel (drag), and timeline drop.
 * For components, resolves componentName/inputDefs from params or by fetching the asset when missing.
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
    componentName,
    inputDefs,
  } = params;

  if (!projectId) {
    return false;
  }

  // Component assets: single path — resolve componentName/inputDefs (fetch if missing), then add clip
  if (type === "component") {
    const resolved = await resolveComponentAssetParams(assetId, projectId, {
      componentName,
      inputDefs,
      name,
      width,
      height,
    });
    if (!resolved) return false;
    const clipName = resolved.name;
    const resolvedDuration = duration || DEFAULT_ASSET_DURATIONS.component;
    const defaultInputs: Record<string, string | number | boolean> = {};
    for (const def of resolved.inputDefs) {
      defaultInputs[def.name] = def.default;
    }
    addClip(
      createComponentClip(assetId, resolved.componentName, clipName, start, resolvedDuration, {
        inputDefs: resolved.inputDefs,
        inputs: defaultInputs,
        width: resolved.width,
        height: resolved.height,
      }),
      layerId
    );
    return true;
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
