import { Input, UrlSource, CanvasSink, ALL_FORMATS } from "mediabunny";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import type { AssetMetadata } from "@/app/lib/store/assets-store";
import type { RemoteAsset } from "@/app/types/assets";

export async function loadAssetsSnapshot(): Promise<RemoteAsset[]> {
  if (typeof window === "undefined") {
    throw new Error("loadAssetsSnapshot cannot be called on server! requires browser context for user authentication");
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
  if (asset.type === "component") {
    const parts = [
      asset.name,
      "COMPONENT",
    ];
    if (asset.componentName) {
      parts.push(`class: ${asset.componentName}`);
    }
    if (asset.inputDefs && asset.inputDefs.length > 0) {
      parts.push(`${asset.inputDefs.length} input${asset.inputDefs.length > 1 ? "s" : ""}`);
    }
    if (asset.description) {
      parts.push(asset.description);
    }
    return parts.join(" • ");
  }

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
  if (asset.description) {
    parts.push(asset.description);
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

/** Returns a loadable URL for an asset (signed or url). Throws if none. */
function getAssetLoadableUrl(asset: RemoteAsset): string {
  const url = asset.signedUrl ?? asset.url;
  if (!url) {
    throw new Error("Asset has no accessible URL.");
  }
  return url.startsWith("http") ? url : toAbsoluteAssetUrl(url);
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
  const absoluteUrl = getAssetLoadableUrl(asset);
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

/**
 * Extract a video frame at a specific timestamp from a URL.
 * Returns a data URL of the frame as JPEG.
 */
export async function extractVideoFrameAtTimestamp(
  url: string,
  timestamp: number
): Promise<string | null> {
  const absoluteUrl = toAbsoluteAssetUrl(url);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(absoluteUrl),
  });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      return null;
    }
    if (!(await videoTrack.canDecode())) {
      return null;
    }
    
    // Get first timestamp to calculate relative time
    const firstTimestamp = await videoTrack.getFirstTimestamp();
    const relativeTime = timestamp + firstTimestamp;
    
    const canvasSink = new CanvasSink(videoTrack, { poolSize: 1 });
    const frame = await canvasSink.getCanvas(relativeTime);
    if (!frame) {
      return null;
    }
    
    // Convert canvas to data URL (handle both HTMLCanvasElement and OffscreenCanvas)
    const canvas = frame.canvas;
    if ("toDataURL" in canvas) {
      return (canvas as HTMLCanvasElement).toDataURL("image/jpeg", 0.85);
    } else if ("convertToBlob" in canvas) {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: "image/jpeg",
        quality: 0.85,
      });
      return await blobToDataUrl(blob);
    }
    return null;
  } catch (err) {
    console.error("[extractVideoFrameAtTimestamp] Error:", err);
    return null;
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
  const absoluteUrl = getAssetLoadableUrl(asset);
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

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FaceBoxOverlay {
  faceIndex: number;
  boundingBox: BoundingBox;
  label?: string;
}

/**
 * Captures a video frame and draws bounding boxes on it.
 * Bounding box coordinates are normalized (0-1) relative to frame dimensions.
 */
export async function captureVideoFrameWithBoxes(
  asset: RemoteAsset,
  timecode: number,
  boxes: FaceBoxOverlay[],
  options: {
    boxColor?: string;
    boxLineWidth?: number;
    labelColor?: string;
    labelFont?: string;
  } = {}
) {
  const {
    boxColor = "#00ff00",
    boxLineWidth = 3,
    labelColor = "#00ff00",
    labelFont = "bold 16px sans-serif",
  } = options;

  const absoluteUrl = getAssetLoadableUrl(asset);
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

    // Create a new canvas to draw the frame with bounding boxes
    const canvas = document.createElement("canvas");
    canvas.width = frame.canvas.width;
    canvas.height = frame.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context.");
    }

    // Draw the original frame
    ctx.drawImage(frame.canvas, 0, 0);

    // Draw bounding boxes
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = boxLineWidth;
    ctx.fillStyle = labelColor;
    ctx.font = labelFont;

    for (const overlay of boxes) {
      const { boundingBox, faceIndex, label } = overlay;
      const x = boundingBox.left * canvas.width;
      const y = boundingBox.top * canvas.height;
      const width = (boundingBox.right - boundingBox.left) * canvas.width;
      const height = (boundingBox.bottom - boundingBox.top) * canvas.height;

      // Draw rectangle
      ctx.strokeRect(x, y, width, height);

      // Draw label background and text
      const labelText = label ?? `Face #${faceIndex + 1}`;
      const textMetrics = ctx.measureText(labelText);
      const labelHeight = 20;
      const labelPadding = 4;

      // Background for label
      ctx.fillStyle = boxColor;
      ctx.fillRect(
        x,
        y - labelHeight - 2,
        textMetrics.width + labelPadding * 2,
        labelHeight
      );

      // Label text
      ctx.fillStyle = "#000000";
      ctx.fillText(labelText, x + labelPadding, y - 6);

      // Reset fill style for next iteration
      ctx.fillStyle = labelColor;
    }

    const url = await canvasToPngDataUrl(canvas);
    return {
      url,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    input.dispose();
  }
}
