import { Input, UrlSource, CanvasSink, ALL_FORMATS } from "mediabunny";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import type { AssetMetadata } from "@/app/lib/store/assets-store";
import type { RemoteAsset } from "@/app/types/assets";

export async function loadAssetsSnapshot(): Promise<RemoteAsset[]> {
  if (typeof window === "undefined") {
    const { ensureAssetStorage, readManifest, storedAssetToRemote } = await import(
      "@/app/lib/server/asset-storage"
    );
    await ensureAssetStorage();
    const manifest = await readManifest();
    return manifest.map((asset) => storedAssetToRemote(asset));
  }
  const assetsStore = useAssetsStore.getState();
  if (assetsStore.assets.length > 0) {
    return assetsStore.assets;
  }
  try {
    const response = await fetch("/api/assets");
    if (!response.ok) throw new Error("Failed to fetch assets");
    const data = (await response.json()) as { assets: RemoteAsset[] };
    assetsStore.setAssets(data.assets ?? []);
    return useAssetsStore.getState().assets;
  } catch (error) {
    console.error("Failed to load assets", error);
    return [];
  }
}

export function formatAssetSummary(
  asset: RemoteAsset,
  metadata?: AssetMetadata | null
) {
  const mb = asset.size / 1024 / 1024;
  const parts = [
    asset.name,
    asset.type.toUpperCase(),
    `${mb.toFixed(mb > 1 ? 2 : 1)} MB`,
  ];
  if (metadata?.duration && metadata.duration > 0) {
    parts.push(`${metadata.duration.toFixed(2)}s`);
  }
  if (
    metadata?.width &&
    metadata.width > 0 &&
    metadata?.height &&
    metadata.height > 0
  ) {
    parts.push(`${metadata.width}x${metadata.height}`);
  }
  return parts.join(" • ");
}

export function toAbsoluteAssetUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (typeof window === "undefined" || !window.location) {
    throw new Error("Cannot resolve asset URL outside the browser runtime.");
  }
  return new URL(url, window.location.origin).toString();
}

export async function canvasToPngDataUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas
) {
  if ("toDataURL" in canvas) {
    return (canvas as HTMLCanvasElement).toDataURL("image/png");
  }
  if ("convertToBlob" in canvas) {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({
      type: "image/png",
    });
    return blobToDataUrl(blob);
  }
  throw new Error("Unsupported canvas implementation for capture output.");
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read captured frame data."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read captured frame data."));
    reader.readAsDataURL(blob);
  });
}

export async function captureVideoFrame(asset: RemoteAsset, timecode: number) {
  const absoluteUrl = toAbsoluteAssetUrl(asset.url);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(absoluteUrl),
  });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in this asset.");
    }
    if (!(await videoTrack.canDecode())) {
      throw new Error("This browser cannot decode the selected video asset.");
    }
    const canvasSink = new CanvasSink(videoTrack, { poolSize: 1 });
    const frame = await canvasSink.getCanvas(timecode);
    if (!frame) {
      throw new Error("No frame exists at the requested timestamp.");
    }
    const url = await canvasToPngDataUrl(frame.canvas);
    return {
      url,
      width: frame.canvas.width,
      height: frame.canvas.height,
    };
  } finally {
    input.dispose();
  }
}

export async function loadImageDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image asset for capture."));
    image.src = url;
  });
}

export async function buildImagePreview(asset: RemoteAsset) {
  const absoluteUrl = toAbsoluteAssetUrl(asset.url);
  const metadata = useAssetsStore.getState().metadata[asset.id] ?? null;
  if (
    metadata?.width &&
    metadata.width > 0 &&
    metadata?.height &&
    metadata.height > 0
  ) {
    return {
      url: absoluteUrl,
      width: metadata.width,
      height: metadata.height,
    };
  }
  const dimensions = await loadImageDimensions(absoluteUrl);
  return {
    url: absoluteUrl,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export async function buildAssetPreview(asset: RemoteAsset, timecode: number) {
  if (asset.type === "image") {
    return buildImagePreview(asset);
  }
  return captureVideoFrame(asset, timecode);
}
