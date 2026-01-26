/**
 * Client-side audio extraction from video files using Mediabunny.
 * This is needed because Google Speech-to-Text doesn't support MP4/AAC directly.
 */

import { Input, UrlSource, AudioSampleSink, ALL_FORMATS } from "mediabunny";

/**
 * Extracts audio from a video file and returns it as a WAV blob.
 * WAV format is chosen for maximum compatibility with Speech-to-Text APIs.
 */
export async function extractAudioFromVideo(
  videoUrl: string,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  // Ensure absolute URL
  const absoluteUrl = /^https?:\/\//i.test(videoUrl)
    ? videoUrl
    : new URL(videoUrl, window.location.origin).toString();

  // Open the video with Mediabunny
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(absoluteUrl),
  });

  try {
    const audioTrack = await input.getPrimaryAudioTrack();

    if (!audioTrack) {
      throw new Error("No audio track found in video");
    }

    // Get audio properties
    const sampleRate = audioTrack.sampleRate;
    const numberOfChannels = audioTrack.numberOfChannels;
    const duration = await audioTrack.computeDuration();

    // Create audio sink and collect samples
    const sink = new AudioSampleSink(audioTrack);
    const allSamples: Float32Array[] = [];
    let processedDuration = 0;

    for await (const sample of sink.samples()) {
      // Get the audio data as float32
      const channelData: Float32Array[] = [];

      for (let channel = 0; channel < numberOfChannels; channel++) {
        const bytes = sample.allocationSize({ format: "f32-planar", planeIndex: channel });
        const floats = new Float32Array(bytes / 4);
        sample.copyTo(floats, { format: "f32-planar", planeIndex: channel });
        channelData.push(floats);
      }

      // Interleave channels for WAV format
      const samplesPerChannel = channelData[0].length;
      const interleaved = new Float32Array(samplesPerChannel * numberOfChannels);
      for (let i = 0; i < samplesPerChannel; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          interleaved[i * numberOfChannels + channel] = channelData[channel][i];
        }
      }
      allSamples.push(interleaved);

      processedDuration = sample.timestamp + sample.duration;
      if (onProgress && duration > 0) {
        onProgress(Math.min(processedDuration / duration, 1));
      }

      sample.close();
    }

    // Concatenate all samples
    const totalLength = allSamples.reduce((sum, arr) => sum + arr.length, 0);
    const audioData = new Float32Array(totalLength);
    let offset = 0;
    for (const samples of allSamples) {
      audioData.set(samples, offset);
      offset += samples.length;
    }

    // Convert to WAV
    const wavBlob = encodeWav(audioData, sampleRate, numberOfChannels);
    return wavBlob;
  } finally {
    input.dispose();
  }
}

/**
 * Encodes float32 audio data to WAV format.
 */
function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  numberOfChannels: number
): Blob {
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write audio data (convert float32 to int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Extracts audio from a video file and returns it as a File object.
 */
export async function extractAudioAsFile(
  videoUrl: string,
  filename: string,
  onProgress?: (progress: number) => void
): Promise<File> {
  const blob = await extractAudioFromVideo(videoUrl, onProgress);
  return new File([blob], filename, { type: "audio/wav" });
}
