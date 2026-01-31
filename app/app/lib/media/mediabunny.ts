"use client";

import { Input, ALL_FORMATS, UrlSource, BlobSource } from "mediabunny";

export interface MediaMetadata {
  duration?: number;
  width?: number;
  height?: number;
}

/**
 * Extract metadata (duration, dimensions) from a media file using mediabunny.
 * Works with URLs or Blobs.
 */
export async function extractMediaMetadata(
  source: string | Blob,
  type: "video" | "audio" | "image"
): Promise<MediaMetadata> {
  const inputSource =
    typeof source === "string" ? new UrlSource(source) : new BlobSource(source);

  const input = new Input({
    formats: ALL_FORMATS,
    source: inputSource,
  });

  try {
    const result: MediaMetadata = {};

    // Get duration
    try {
      const duration = await input.computeDuration();
      if (Number.isFinite(duration) && duration > 0) {
        result.duration = duration;
      }
    } catch {
      // Duration not available for some formats (e.g., images)
    }

    // Get dimensions for video/image
    if (type === "video" || type === "image") {
      try {
        const videoTrack = await input.getPrimaryVideoTrack();
        if (videoTrack) {
          // Use display dimensions (accounts for rotation)
          result.width = videoTrack.displayWidth;
          result.height = videoTrack.displayHeight;
        }
      } catch {
        // No video track available
      }
    }

    return result;
  } finally {
    input.dispose();
  }
}

/**
 * Extract metadata from a URL source.
 */
export async function extractMetadataFromUrl(
  url: string,
  type: "video" | "audio" | "image"
): Promise<MediaMetadata> {
  return extractMediaMetadata(url, type);
}

/**
 * Extract metadata from a Blob/File source.
 */
export async function extractMetadataFromBlob(
  blob: Blob,
  type: "video" | "audio" | "image"
): Promise<MediaMetadata> {
  return extractMediaMetadata(blob, type);
}

/**
 * Get video frame rate from a URL or Blob.
 * Returns approximate FPS based on packet statistics.
 */
export async function getVideoFrameRate(source: string | Blob): Promise<number | null> {
  const inputSource =
    typeof source === "string" ? new UrlSource(source) : new BlobSource(source);

  const input = new Input({
    formats: ALL_FORMATS,
    source: inputSource,
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;

    // Use a sample of 100 packets for quick estimation
    const stats = await videoTrack.computePacketStats(100);
    return stats.averagePacketRate;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
