"use client";

import {
  ALL_FORMATS,
  Input,
  UrlSource,
  AudioSampleSink,
} from "mediabunny";

export interface VideoMediaInfo {
  duration: number;
  width: number;
  height: number;
  /** Normalized waveform samples (0-1 range), sampled at intervals */
  waveformSamples: number[];
  waveformDuration: number;
}

// Target number of waveform samples - enough for visualization without decoding everything
const WAVEFORM_SAMPLE_COUNT = 200;

export type WaveformProgressCallback = (samples: number[], progress: number) => void;

/** Fast metadata without waveform - for filmstrip that just needs dimensions/duration */
export interface VideoMetadataOnly {
  duration: number;
  width: number;
  height: number;
}

// In-memory cache
const infoCache = new Map<string, VideoMediaInfo>();
const metadataOnlyCache = new Map<string, VideoMetadataOnly>();
// Pending requests to avoid duplicate fetches
const pendingCache = new Map<string, Promise<VideoMediaInfo>>();
const metadataPendingCache = new Map<string, Promise<VideoMetadataOnly>>();

// IndexedDB cache
const DB_NAME = "gemini-studio-media-info";
const STORE_NAME = "media-info";

function openMediaInfoDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedMediaInfo(key: string): Promise<VideoMediaInfo | null> {
  if (infoCache.has(key)) return infoCache.get(key)!;
  try {
    const db = await openMediaInfoDb();
    if (!db) return null;
    return await new Promise<VideoMediaInfo | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value && typeof value.duration === "number") {
          resolve(value as VideoMediaInfo);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function putCachedMediaInfo(key: string, info: VideoMediaInfo): Promise<void> {
  infoCache.set(key, info);
  try {
    const db = await openMediaInfoDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(info, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore storage errors; memory cache is still populated.
  }
}

async function extractMediaInfoFromSource(src: string): Promise<VideoMediaInfo> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src),
  });

  try {
    const [duration, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    const width = videoTrack?.displayWidth ?? 0;
    const height = videoTrack?.displayHeight ?? 0;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

    // Extract waveform by sampling at specific timestamps (FAST - doesn't decode entire audio)
    let waveformSamples: number[] = [];
    const waveformDuration = safeDuration;

    if (audioTrack && safeDuration > 0) {
      try {
        const canDecode = await audioTrack.canDecode();
        if (canDecode) {
          const sink = new AudioSampleSink(audioTrack);

          // Generate timestamps to sample at - evenly distributed across duration
          const timestamps: number[] = [];
          for (let i = 0; i < WAVEFORM_SAMPLE_COUNT; i++) {
            // Sample at center of each segment
            timestamps.push((safeDuration / WAVEFORM_SAMPLE_COUNT) * (i + 0.5));
          }

          // Use samplesAtTimestamps for efficient seeking (only decodes needed frames)
          for await (const sample of sink.samplesAtTimestamps(timestamps)) {
            if (!sample) {
              waveformSamples.push(0);
              continue;
            }

            // Get peak amplitude from this sample
            const buffer = sample.toAudioBuffer();
            const channelData = buffer.getChannelData(0);
            let peak = 0;
            // Sample a subset of frames for speed (every 10th sample)
            const step = Math.max(1, Math.floor(channelData.length / 100));
            for (let i = 0; i < channelData.length; i += step) {
              peak = Math.max(peak, Math.abs(channelData[i]));
            }
            waveformSamples.push(peak);
            sample.close();
          }
        }
      } catch {
        // Audio decoding failed, waveform will be empty
      }
    }

    return {
      duration: safeDuration,
      width,
      height,
      waveformSamples,
      waveformDuration,
    };
  } finally {
    input.dispose();
  }
}

/**
 * Fast metadata extraction - just duration and dimensions, no waveform.
 * Used by filmstrip to start immediately without waiting for audio decode.
 */
async function extractMetadataOnly(src: string): Promise<VideoMetadataOnly> {
  console.log("[getVideoMetadata] Extracting metadata only for:", src.slice(0, 80) + "...");
  const startTime = performance.now();
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src),
  });

  try {
    const [duration, videoTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
    ]);

    const result = {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      width: videoTrack?.displayWidth ?? 0,
      height: videoTrack?.displayHeight ?? 0,
    };
    console.log("[getVideoMetadata] Extracted in", (performance.now() - startTime).toFixed(0), "ms:", result);
    return result;
  } catch (err) {
    console.error("[getVideoMetadata] Error extracting metadata:", err);
    throw err;
  } finally {
    input.dispose();
  }
}

/**
 * Get just video metadata (duration, dimensions) - FAST, no waveform extraction.
 * Use this when you only need dimensions/duration and don't need waveform.
 */
export async function getVideoMetadata(src: string): Promise<VideoMetadataOnly> {
  // Check if we have full info cached (includes metadata)
  if (infoCache.has(src)) {
    const info = infoCache.get(src)!;
    console.log("[getVideoMetadata] Found in full info cache");
    return { duration: info.duration, width: info.width, height: info.height };
  }

  // Check metadata-only cache
  if (metadataOnlyCache.has(src)) {
    console.log("[getVideoMetadata] Found in metadata cache");
    return metadataOnlyCache.get(src)!;
  }

  // Check if already loading metadata
  if (metadataPendingCache.has(src)) {
    console.log("[getVideoMetadata] Already loading, waiting...");
    return metadataPendingCache.get(src)!;
  }

  // Check if full info is loading (we can wait for that instead)
  if (pendingCache.has(src)) {
    console.log("[getVideoMetadata] Full info loading, waiting...");
    const info = await pendingCache.get(src)!;
    return { duration: info.duration, width: info.width, height: info.height };
  }

  // Extract metadata only (fast)
  console.log("[getVideoMetadata] Not cached, extracting...");
  const promise = extractMetadataOnly(src);
  metadataPendingCache.set(src, promise);

  try {
    const metadata = await promise;
    metadataOnlyCache.set(src, metadata);
    return metadata;
  } finally {
    metadataPendingCache.delete(src);
  }
}

/**
 * Get video media info (duration, dimensions, waveform) with caching.
 * Opens the media file only once, extracting all needed data.
 * Cached by src URL in memory and IndexedDB.
 */
export async function getVideoMediaInfo(src: string): Promise<VideoMediaInfo> {
  // Check memory cache
  if (infoCache.has(src)) {
    return infoCache.get(src)!;
  }

  // Check if already loading
  if (pendingCache.has(src)) {
    return pendingCache.get(src)!;
  }

  // Check IndexedDB cache
  const cached = await getCachedMediaInfo(src);
  if (cached) {
    infoCache.set(src, cached);
    // Also populate metadata-only cache
    metadataOnlyCache.set(src, {
      duration: cached.duration,
      width: cached.width,
      height: cached.height,
    });
    return cached;
  }

  // Extract and cache
  const promise = extractMediaInfoFromSource(src);
  pendingCache.set(src, promise);

  try {
    const info = await promise;
    await putCachedMediaInfo(src, info);
    // Also populate metadata-only cache
    metadataOnlyCache.set(src, {
      duration: info.duration,
      width: info.width,
      height: info.height,
    });
    return info;
  } finally {
    pendingCache.delete(src);
  }
}

/**
 * Clear cached media info for a specific source.
 */
export function clearVideoMediaInfoCache(src: string): void {
  infoCache.delete(src);
  metadataOnlyCache.delete(src);
  pendingCache.delete(src);
  metadataPendingCache.delete(src);
}

/**
 * Extract waveform progressively with callback for real-time updates.
 * Calls onProgress as samples are extracted.
 */
export async function extractWaveformProgressive(
  src: string,
  onProgress: WaveformProgressCallback,
  signal?: AbortSignal
): Promise<{ samples: number[]; duration: number }> {
  console.log("[extractWaveformProgressive] Starting for:", src.slice(0, 60) + "...");
  
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src),
  });

  try {
    const [duration, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryAudioTrack(),
    ]);

    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const samples: number[] = [];

    if (!audioTrack || safeDuration <= 0) {
      console.log("[extractWaveformProgressive] No audio track or invalid duration");
      return { samples: [], duration: safeDuration };
    }

    const canDecode = await audioTrack.canDecode();
    if (!canDecode) {
      console.log("[extractWaveformProgressive] Cannot decode audio track");
      return { samples: [], duration: safeDuration };
    }

    const sink = new AudioSampleSink(audioTrack);

    // Generate timestamps to sample at
    const timestamps: number[] = [];
    for (let i = 0; i < WAVEFORM_SAMPLE_COUNT; i++) {
      timestamps.push((safeDuration / WAVEFORM_SAMPLE_COUNT) * (i + 0.5));
    }

    let lastUpdateTime = 0;
    const UPDATE_INTERVAL_MS = 100; // Update every 100ms

    const iterator = sink.samplesAtTimestamps(timestamps);
    try {
      for await (const sample of iterator) {
        if (signal?.aborted) {
          if (sample) sample.close();
          break;
        }

        if (!sample) {
          samples.push(0);
        } else {
          const buffer = sample.toAudioBuffer();
          const channelData = buffer.getChannelData(0);
          let peak = 0;
          const step = Math.max(1, Math.floor(channelData.length / 100));
          for (let i = 0; i < channelData.length; i += step) {
            peak = Math.max(peak, Math.abs(channelData[i]));
          }
          samples.push(peak);
          sample.close();
        }

        // Progressive update
        const now = performance.now();
        if (now - lastUpdateTime > UPDATE_INTERVAL_MS || samples.length === timestamps.length) {
          lastUpdateTime = now;
          onProgress([...samples], samples.length / timestamps.length);
        }
      }
    } finally {
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }

    console.log("[extractWaveformProgressive] Done, extracted", samples.length, "samples");
    return { samples, duration: safeDuration };
  } finally {
    input.dispose();
  }
}
