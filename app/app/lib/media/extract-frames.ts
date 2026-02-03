"use client";

import {
  ALL_FORMATS,
  Input,
  InputDisposedError,
  UrlSource,
  VideoSample,
  VideoSampleSink,
} from "mediabunny";

export type ExtractFramesOptions = {
  track: { width: number; height: number };
  container: string;
  durationInSeconds: number | null;
};

export type ExtractFramesTimestampsFn = (
  options: ExtractFramesOptions
) => Promise<number[]> | number[];

export type ExtractFramesProps = {
  src: string;
  timestampsInSeconds: number[] | ExtractFramesTimestampsFn;
  onVideoSample: (sample: VideoSample) => void;
  signal?: AbortSignal;
};

/**
 * Extract video frames at given timestamps using Mediabunny.
 * Each VideoSample must be closed by the caller when done (e.g. after drawing to canvas).
 */
export async function extractFrames({
  src,
  timestampsInSeconds,
  onVideoSample,
  signal,
}: ExtractFramesProps): Promise<void> {
  console.log("[extractFrames] Starting, src:", src.slice(0, 80) + "...");
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src),
  });

  try {
    console.log("[extractFrames] Getting track info...");
    const startTrack = performance.now();
    const [durationInSeconds, format, videoTrack] = await Promise.all([
      input.computeDuration(),
      input.getFormat(),
      input.getPrimaryVideoTrack(),
    ]);
    console.log("[extractFrames] Track info in", (performance.now() - startTrack).toFixed(0), "ms", {
      duration: durationInSeconds,
      format: format?.name,
      hasVideoTrack: !!videoTrack,
      dimensions: videoTrack ? `${videoTrack.displayWidth}x${videoTrack.displayHeight}` : null,
    });

    if (!videoTrack) {
      throw new Error("No video track found in the input");
    }
    if (signal?.aborted) {
      console.log("[extractFrames] Aborted before extraction");
      throw new Error("Aborted");
    }

    const timestamps =
      typeof timestampsInSeconds === "function"
        ? await timestampsInSeconds({
            track: {
              width: videoTrack.displayWidth,
              height: videoTrack.displayHeight,
            },
            container: format.name,
            durationInSeconds,
          })
        : timestampsInSeconds;

    if (timestamps.length === 0) {
      console.log("[extractFrames] No timestamps to extract");
      return;
    }

    if (signal?.aborted) {
      console.log("[extractFrames] Aborted after timestamp computation");
      throw new Error("Aborted");
    }

    console.log("[extractFrames] Creating sink, extracting", timestamps.length, "frames...");
    const sink = new VideoSampleSink(videoTrack);

    let frameCount = 0;
    let nullCount = 0;
    const startExtract = performance.now();
    
    const iterator = sink.samplesAtTimestamps(timestamps);
    try {
      for await (const videoSample of iterator) {
        if (signal?.aborted) {
          console.log("[extractFrames] Aborted during extraction at frame", frameCount);
          // Close this sample before breaking
          if (videoSample) {
            videoSample.close();
          }
          break;
        }

        if (!videoSample) {
          nullCount++;
          continue;
        }

        try {
          onVideoSample(videoSample);
          frameCount++;
        } finally {
          videoSample.close();
        }
      }
    } finally {
      // Ensure iterator is closed to prevent memory leaks
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }
    
    console.log("[extractFrames] Done in", (performance.now() - startExtract).toFixed(0), "ms", {
      framesExtracted: frameCount,
      nullSamples: nullCount,
      total: timestamps.length,
    });
  } catch (err) {
    if (err instanceof InputDisposedError) {
      console.log("[extractFrames] InputDisposedError (aborted)");
      throw new Error("Aborted");
    }
    // Don't log abort errors at error level
    if (signal?.aborted || (err instanceof Error && err.message === "Aborted")) {
      console.log("[extractFrames] Aborted");
      throw err;
    }
    console.error("[extractFrames] Error:", err);
    throw err;
  } finally {
    input.dispose();
  }
}
