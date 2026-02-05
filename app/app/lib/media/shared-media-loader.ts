"use client";

import {
  ALL_FORMATS,
  Input,
  UrlSource,
  VideoSampleSink,
  AudioSampleSink,
  CanvasSink,
} from "mediabunny";

// ============================================================================
// Constants - Fixed filmstrip dimensions (cached once per source, CSS scales to fit)
// ============================================================================

const FILMSTRIP_WIDTH = 600;
const FILMSTRIP_HEIGHT = 40;
const FILMSTRIP_FRAME_COUNT = 20;

// ============================================================================
// Types
// ============================================================================

export interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
}

export interface FilmstripResult {
  dataUrl: string;
  sourceDuration: number;
  /** Fixed width the filmstrip was rendered at */
  width: number;
  /** Fixed height the filmstrip was rendered at */
  height: number;
}

export interface WaveformResult {
  samples: number[];
  duration: number;
}

export interface ThumbnailResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ExtractionResult {
  metadata: MediaMetadata;
  filmstrip?: FilmstripResult;
  waveform?: WaveformResult;
  thumbnail?: ThumbnailResult;
}

export interface ExtractionOptions {
  needsFilmstrip?: boolean;
  needsWaveform?: boolean;
  signal?: AbortSignal;
}

type ProgressCallback = (partial: Partial<ExtractionResult>) => void;

interface Subscriber {
  callback: ProgressCallback;
  options: ExtractionOptions;
}

interface PendingExtraction {
  src: string;
  options: ExtractionOptions;
  resolve: (result: ExtractionResult) => void;
  reject: (error: Error) => void;
}

// ============================================================================
// IndexedDB Cache (reuses existing DB structure)
// ============================================================================

const FILMSTRIP_DB_NAME = "gemini-studio-filmstrips";
const FILMSTRIP_STORE_NAME = "filmstrips";
const WAVEFORM_DB_NAME = "gemini-studio-waveforms";
const WAVEFORM_STORE_NAME = "waveforms";
const MEDIA_INFO_DB_NAME = "gemini-studio-media-info";
const MEDIA_INFO_STORE_NAME = "media-info";
const THUMBNAIL_DB_NAME = "gemini-studio-thumbnails";
const THUMBNAIL_STORE_NAME = "thumbnails";

function openDb(dbName: string, storeName: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getFromDb<T>(dbName: string, storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDb(dbName, storeName);
    if (!db) return null;
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function putToDb<T>(dbName: string, storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDb(dbName, storeName);
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// Memory Cache
// ============================================================================

const metadataCache = new Map<string, MediaMetadata>();
const filmstripCache = new Map<string, FilmstripResult>();
const waveformCache = new Map<string, WaveformResult>();
const thumbnailCache = new Map<string, ThumbnailResult>();

// ============================================================================
// Shared Media Loader
// ============================================================================

class SharedMediaLoaderImpl {
  private queue: PendingExtraction[] = [];
  private activeExtraction: PendingExtraction | null = null;
  private subscribers = new Map<string, Set<Subscriber>>();
  private inputCache = new Map<string, { input: Input; refCount: number }>();

  /**
   * Set whether video playback is active.
   * Currently a no-op - extractions continue during playback.
   * The single-queue approach (max 1 concurrent) should be gentle enough.
   */
  setPlaybackActive(_active: boolean): void {
    // No-op: let extractions run during playback
  }

  /**
   * Subscribe to extraction progress for a URL.
   * Returns unsubscribe function.
   */
  subscribe(src: string, options: ExtractionOptions, callback: ProgressCallback): () => void {
    if (!this.subscribers.has(src)) {
      this.subscribers.set(src, new Set());
    }
    const subscriber: Subscriber = { callback, options };
    this.subscribers.get(src)!.add(subscriber);

    // Immediately notify with cached data
    const cached = this.getCachedResult(src);
    if (cached) {
      callback(cached);
    }

    return () => {
      const subs = this.subscribers.get(src);
      if (subs) {
        subs.delete(subscriber);
        if (subs.size === 0) {
          this.subscribers.delete(src);
        }
      }
    };
  }

  /**
   * Request extraction for a URL (queued, deduplicated).
   * Filmstrips are always extracted at fixed dimensions for consistent caching.
   */
  async requestExtraction(src: string, options: ExtractionOptions = {}): Promise<ExtractionResult> {
    // Check cache first
    const cached = this.getCachedResult(src);
    
    // Filmstrip is cached by src only (fixed dimensions)
    const cachedFilmstrip = options.needsFilmstrip ? filmstripCache.get(src) : undefined;
    
    const needsFilmstrip = options.needsFilmstrip && !cachedFilmstrip;
    const needsWaveform = options.needsWaveform && !cached?.waveform;
    const needsMetadata = !cached?.metadata;

    // If everything is cached, return immediately
    if (!needsMetadata && !needsFilmstrip && !needsWaveform && cached?.metadata) {
      return {
        metadata: cached.metadata,
        filmstrip: cachedFilmstrip,
        waveform: cached.waveform,
      };
    }

    // Check if already queued for this src
    const existing = this.queue.find((p) => p.src === src);
    if (existing) {
      // Merge options
      if (options.needsFilmstrip) existing.options.needsFilmstrip = true;
      if (options.needsWaveform) existing.options.needsWaveform = true;
      
      // Return a promise that resolves when the existing extraction completes
      return new Promise((resolve, reject) => {
        const originalResolve = existing.resolve;
        const originalReject = existing.reject;
        existing.resolve = (result) => {
          originalResolve(result);
          resolve(result);
        };
        existing.reject = (err) => {
          originalReject(err);
          reject(err);
        };
      });
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({
        src,
        options: { ...options, needsFilmstrip, needsWaveform },
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  /**
   * Get cached results for a URL (metadata, waveform, filmstrip, and thumbnail).
   */
  getCachedResult(src: string): Partial<ExtractionResult> | null {
    const metadata = metadataCache.get(src);
    const waveform = waveformCache.get(src);
    const filmstrip = filmstripCache.get(src);
    const thumbnail = thumbnailCache.get(src);

    if (!metadata && !waveform && !filmstrip && !thumbnail) {
      return null;
    }

    return { metadata, waveform, filmstrip, thumbnail };
  }

  /**
   * Request thumbnail extraction for a video URL (first frame at timestamp 0).
   * Returns cached thumbnail if available, otherwise extracts and caches it.
   */
  async requestThumbnail(src: string, signal?: AbortSignal): Promise<ThumbnailResult | null> {
    // Check cache first
    const cached = thumbnailCache.get(src);
    if (cached) {
      return cached;
    }

    // Check IndexedDB
    const dbCached = await getFromDb<ThumbnailResult>(THUMBNAIL_DB_NAME, THUMBNAIL_STORE_NAME, src);
    if (dbCached && dbCached.dataUrl) {
      thumbnailCache.set(src, dbCached);
      return dbCached;
    }

    // Extract thumbnail
    try {
      const thumbnail = await this.extractThumbnail(src, signal);
      if (thumbnail) {
        thumbnailCache.set(src, thumbnail);
        await putToDb(THUMBNAIL_DB_NAME, THUMBNAIL_STORE_NAME, src, thumbnail);
      }
      return thumbnail;
    } catch (err) {
      console.error("[SharedMediaLoader] Failed to extract thumbnail:", err);
      return null;
    }
  }

  /**
   * Extract a single thumbnail frame from video at timestamp 0.
   */
  private async extractThumbnail(
    src: string,
    signal?: AbortSignal
  ): Promise<ThumbnailResult | null> {
    console.log("[SharedMediaLoader] Extracting thumbnail for:", src.slice(0, 60) + "...");
    
    const input = this.getInput(src);
    
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) return null;

      if (signal?.aborted) return null;

      // Use CanvasSink for efficient single-frame extraction
      // Extract at timestamp 0 (first frame)
      const canvasSink = new CanvasSink(videoTrack, {
        width: 160, // Reasonable thumbnail size
        height: 90,
        fit: "contain", // Preserve aspect ratio
      });

      const firstTimestamp = await videoTrack.getFirstTimestamp();
      const frame = await canvasSink.getCanvas(firstTimestamp);
      
      if (!frame || signal?.aborted) {
        return null;
      }

      // Convert canvas to data URL (JPEG for smaller size)
      // Handle both HTMLCanvasElement and OffscreenCanvas
      let dataUrl: string;
      const canvas = frame.canvas;
      if ("toDataURL" in canvas) {
        // HTMLCanvasElement
        dataUrl = (canvas as HTMLCanvasElement).toDataURL("image/jpeg", 0.85);
      } else if ("convertToBlob" in canvas) {
        // OffscreenCanvas - convert to blob then to data URL
        const blob = await (canvas as OffscreenCanvas).convertToBlob({
          type: "image/jpeg",
          quality: 0.85,
        });
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
            } else {
              reject(new Error("Failed to read thumbnail data"));
            }
          };
          reader.onerror = () => reject(new Error("Failed to read thumbnail data"));
          reader.readAsDataURL(blob);
        });
      } else {
        throw new Error("Unsupported canvas type for thumbnail extraction");
      }
      
      console.log("[SharedMediaLoader] Thumbnail extracted");

      return {
        dataUrl,
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      console.error("[SharedMediaLoader] Thumbnail extraction error:", err);
      return null;
    } finally {
      this.releaseInput(src);
    }
  }

  /**
   * Get or create a shared mediabunny Input for a URL.
   */
  private getInput(src: string): Input {
    let cached = this.inputCache.get(src);
    if (!cached) {
      const input = new Input({
        formats: ALL_FORMATS,
        source: new UrlSource(src),
      });
      cached = { input, refCount: 0 };
      this.inputCache.set(src, cached);
    }
    cached.refCount++;
    return cached.input;
  }

  /**
   * Release a shared mediabunny Input.
   */
  private releaseInput(src: string): void {
    const cached = this.inputCache.get(src);
    if (cached) {
      cached.refCount--;
      if (cached.refCount <= 0) {
        cached.input.dispose();
        this.inputCache.delete(src);
      }
    }
  }

  /**
   * Process the extraction queue.
   */
  private async processQueue(): Promise<void> {
    // Only one active extraction at a time
    if (this.activeExtraction) return;

    const next = this.queue.shift();
    if (!next) return;

    this.activeExtraction = next;

    try {
      const result = await this.runExtraction(next.src, next.options);
      next.resolve(result);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.activeExtraction = null;
      // Process next item
      this.processQueue();
    }
  }

  /**
   * Run extraction for a single URL.
   */
  private async runExtraction(src: string, options: ExtractionOptions): Promise<ExtractionResult> {
    const signal = options.signal;
    const input = this.getInput(src);

    try {
      // 1. Extract metadata first
      let metadata = metadataCache.get(src);
      if (!metadata) {
        console.log("[SharedMediaLoader] Extracting metadata for:", src.slice(0, 60) + "...");
        const [duration, videoTrack] = await Promise.all([
          input.computeDuration(),
          input.getPrimaryVideoTrack(),
        ]);

        metadata = {
          duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
          width: videoTrack?.displayWidth ?? 0,
          height: videoTrack?.displayHeight ?? 0,
        };

        metadataCache.set(src, metadata);
        await putToDb(MEDIA_INFO_DB_NAME, MEDIA_INFO_STORE_NAME, src, metadata);
        this.notifySubscribers(src, { metadata });
      }

      if (signal?.aborted) throw new Error("Aborted");

      // 2. Extract filmstrip if needed (always at fixed dimensions)
      let filmstrip = filmstripCache.get(src);
      if (options.needsFilmstrip && !filmstrip && metadata.duration > 0) {
        console.log("[SharedMediaLoader] Extracting filmstrip for:", src.slice(0, 60) + "...");
        filmstrip = await this.extractFilmstrip(src, input, metadata, signal);
        if (filmstrip) {
          filmstripCache.set(src, filmstrip);
          await putToDb(FILMSTRIP_DB_NAME, FILMSTRIP_STORE_NAME, src, filmstrip);
          this.notifySubscribers(src, { filmstrip });
        }
      }

      if (signal?.aborted) throw new Error("Aborted");

      // 3. Extract waveform if needed
      let waveform = waveformCache.get(src);
      if (options.needsWaveform && !waveform && metadata.duration > 0) {
        waveform = await this.extractWaveform(src, input, metadata.duration, signal);
        if (waveform) {
          waveformCache.set(src, waveform);
          await putToDb(WAVEFORM_DB_NAME, WAVEFORM_STORE_NAME, src, waveform);
          this.notifySubscribers(src, { waveform });
        }
      }

      return { metadata, filmstrip, waveform };
    } finally {
      this.releaseInput(src);
    }
  }

  /**
   * Extract filmstrip frames from video at fixed dimensions.
   * Uses FILMSTRIP_WIDTH, FILMSTRIP_HEIGHT, and FILMSTRIP_FRAME_COUNT constants.
   */
  private async extractFilmstrip(
    src: string,
    input: Input,
    metadata: MediaMetadata,
    signal?: AbortSignal
  ): Promise<FilmstripResult | undefined> {
    console.log("[SharedMediaLoader] Extracting filmstrip for:", src.slice(0, 60) + "...");
    
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return undefined;

    // Use fixed frame count for consistent caching
    const frameCount = FILMSTRIP_FRAME_COUNT;

    const timestamps: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      timestamps.push((metadata.duration / frameCount) * (i + 0.5));
    }

    const canvas = document.createElement("canvas");
    canvas.width = FILMSTRIP_WIDTH;
    canvas.height = FILMSTRIP_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const sink = new VideoSampleSink(videoTrack);
    let slotIndex = 0;
    const slotWidth = FILMSTRIP_WIDTH / frameCount;

    const iterator = sink.samplesAtTimestamps(timestamps);
    try {
      for await (const sample of iterator) {
        if (signal?.aborted) {
          if (sample) sample.close();
          break;
        }

        if (!sample) continue;

        try {
          const dx = slotIndex * slotWidth;
          const sampleAspect = sample.displayWidth / sample.displayHeight;
          const slotAspect = slotWidth / FILMSTRIP_HEIGHT;
          let drawWidth: number;
          let drawHeight: number;
          if (sampleAspect > slotAspect) {
            drawHeight = FILMSTRIP_HEIGHT;
            drawWidth = FILMSTRIP_HEIGHT * sampleAspect;
          } else {
            drawWidth = slotWidth;
            drawHeight = slotWidth / sampleAspect;
          }
          const drawX = dx + (slotWidth - drawWidth) / 2;
          const drawY = (FILMSTRIP_HEIGHT - drawHeight) / 2;
          sample.draw(ctx, drawX, drawY, drawWidth, drawHeight);
          slotIndex++;
        } finally {
          sample.close();
        }
      }
    } finally {
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }

    if (signal?.aborted) return undefined;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    console.log("[SharedMediaLoader] Filmstrip done, frames:", slotIndex);

    return {
      dataUrl,
      sourceDuration: metadata.duration,
      width: FILMSTRIP_WIDTH,
      height: FILMSTRIP_HEIGHT,
    };
  }

  /**
   * Extract waveform samples from audio track.
   */
  private async extractWaveform(
    src: string,
    input: Input,
    duration: number,
    signal?: AbortSignal
  ): Promise<WaveformResult | undefined> {
    console.log("[SharedMediaLoader] Extracting waveform for:", src.slice(0, 60) + "...");
    
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return undefined;

    const canDecode = await audioTrack.canDecode();
    if (!canDecode) return undefined;

    const SAMPLE_COUNT = 200;
    const timestamps: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      timestamps.push((duration / SAMPLE_COUNT) * (i + 0.5));
    }

    const samples: number[] = [];
    const sink = new AudioSampleSink(audioTrack);

    const iterator = sink.samplesAtTimestamps(timestamps);
    try {
      for await (const sample of iterator) {
        if (signal?.aborted) {
          if (sample) sample.close();
          break;
        }

        if (!sample) {
          samples.push(0);
          continue;
        }

        try {
          const buffer = sample.toAudioBuffer();
          const channelData = buffer.getChannelData(0);
          let peak = 0;
          const step = Math.max(1, Math.floor(channelData.length / 100));
          for (let i = 0; i < channelData.length; i += step) {
            peak = Math.max(peak, Math.abs(channelData[i]));
          }
          samples.push(peak);
        } finally {
          sample.close();
        }
      }
    } finally {
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }

    if (signal?.aborted) return undefined;

    console.log("[SharedMediaLoader] Waveform done, samples:", samples.length);

    return { samples, duration };
  }

  /**
   * Notify subscribers of partial results.
   */
  private notifySubscribers(src: string, partial: Partial<ExtractionResult>): void {
    const subs = this.subscribers.get(src);
    if (!subs) return;
    for (const sub of subs) {
      try {
        sub.callback(partial);
      } catch (err) {
        console.error("[SharedMediaLoader] Subscriber error:", err);
      }
    }
  }

  /**
   * Load cached data from IndexedDB on startup.
   */
  async loadFromCache(src: string): Promise<Partial<ExtractionResult>> {
    const result: Partial<ExtractionResult> = {};

    // Try to load metadata
    if (!metadataCache.has(src)) {
      const cached = await getFromDb<MediaMetadata>(MEDIA_INFO_DB_NAME, MEDIA_INFO_STORE_NAME, src);
      if (cached && typeof cached.duration === "number") {
        metadataCache.set(src, cached);
        result.metadata = cached;
      }
    } else {
      result.metadata = metadataCache.get(src);
    }

    // Try to load filmstrip (keyed by src only, fixed dimensions)
    if (!filmstripCache.has(src)) {
      const cached = await getFromDb<FilmstripResult>(FILMSTRIP_DB_NAME, FILMSTRIP_STORE_NAME, src);
      if (cached && cached.dataUrl) {
        filmstripCache.set(src, cached);
        result.filmstrip = cached;
      }
    } else {
      result.filmstrip = filmstripCache.get(src);
    }

    // Try to load waveform
    if (!waveformCache.has(src)) {
      const cached = await getFromDb<WaveformResult>(WAVEFORM_DB_NAME, WAVEFORM_STORE_NAME, src);
      if (cached && Array.isArray(cached.samples)) {
        waveformCache.set(src, cached);
        result.waveform = cached;
      }
    } else {
      result.waveform = waveformCache.get(src);
    }

    return result;
  }

  /**
   * Load filmstrip from cache (fixed dimensions, keyed by src only).
   */
  async loadFilmstripFromCache(src: string): Promise<FilmstripResult | null> {
    // Check memory first
    if (filmstripCache.has(src)) {
      return filmstripCache.get(src)!;
    }

    // Try IndexedDB
    const cached = await getFromDb<FilmstripResult>(FILMSTRIP_DB_NAME, FILMSTRIP_STORE_NAME, src);
    if (cached && cached.dataUrl) {
      filmstripCache.set(src, cached);
      return cached;
    }

    return null;
  }

  /**
   * Load thumbnail from cache.
   */
  async loadThumbnailFromCache(src: string): Promise<ThumbnailResult | null> {
    // Check memory first
    if (thumbnailCache.has(src)) {
      return thumbnailCache.get(src)!;
    }

    // Try IndexedDB
    const cached = await getFromDb<ThumbnailResult>(THUMBNAIL_DB_NAME, THUMBNAIL_STORE_NAME, src);
    if (cached && cached.dataUrl) {
      thumbnailCache.set(src, cached);
      return cached;
    }

    return null;
  }

  /**
   * Clear all caches (for debugging/testing).
   */
  clearCaches(): void {
    metadataCache.clear();
    filmstripCache.clear();
    waveformCache.clear();
    thumbnailCache.clear();
  }
}

// Singleton instance
export const SharedMediaLoader = new SharedMediaLoaderImpl();
