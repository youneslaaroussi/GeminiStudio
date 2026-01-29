/**
 * Audio utilities for Gemini Live API
 *
 * Handles microphone capture and audio playback using Web Audio API.
 * - Input: 16-bit PCM, 16kHz, mono
 * - Output: 24kHz PCM from Gemini
 */

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 4096;

export interface AudioDevice {
  deviceId: string;
  label: string;
}

/**
 * Get list of available audio input devices
 */
export async function getAudioInputDevices(): Promise<AudioDevice[]> {
  // Request permission first to get device labels
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
  } catch {
    // Permission denied or no devices
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(device => device.kind === "audioinput")
    .map(device => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
    }));
}

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private onAudioLevel: ((level: number) => void) | null = null;
  private levelCheckInterval: ReturnType<typeof setInterval> | null = null;

  async start(
    onAudioData: (data: ArrayBuffer) => void,
    options?: {
      deviceId?: string;
      onAudioLevel?: (level: number) => void;
    }
  ): Promise<void> {
    this.onAudioData = onAudioData;
    this.onAudioLevel = options?.onAudioLevel || null;

    // Request microphone access with optional device selection
    const audioConstraints: MediaTrackConstraints = {
      sampleRate: INPUT_SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (options?.deviceId) {
      audioConstraints.deviceId = { exact: options.deviceId };
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });

    // Create audio context at input sample rate
    this.audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });

    // Load the audio worklet processor
    await this.audioContext.audioWorklet.addModule(
      this.createWorkletProcessorURL()
    );

    // Create source from microphone
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create analyser node for level monitoring
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.5;

    // Create worklet node for processing
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-processor"
    );

    // Handle audio data from worklet
    this.workletNode.port.onmessage = (event) => {
      if (this.onAudioData && event.data.pcmData) {
        this.onAudioData(event.data.pcmData);
      }
    };

    // Connect: microphone -> analyser -> worklet
    source.connect(this.analyserNode);
    this.analyserNode.connect(this.workletNode);

    // Start level monitoring if callback provided
    if (this.onAudioLevel) {
      this.startLevelMonitoring();
    }
  }

  private startLevelMonitoring(): void {
    if (!this.analyserNode || !this.onAudioLevel) return;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.levelCheckInterval = setInterval(() => {
      if (!this.analyserNode || !this.onAudioLevel) return;

      this.analyserNode.getByteFrequencyData(dataArray);

      // Calculate average level (0-1)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length / 255;

      this.onAudioLevel(average);
    }, 50); // Update ~20 times per second
  }

  stop(): void {
    if (this.levelCheckInterval) {
      clearInterval(this.levelCheckInterval);
      this.levelCheckInterval = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.onAudioData = null;
    this.onAudioLevel = null;
  }

  private createWorkletProcessorURL(): string {
    const processorCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = [];
          this.bufferSize = ${CHUNK_SIZE};
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || !input[0]) return true;

          const samples = input[0];
          
          // Convert float32 to int16
          for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
          }

          // Send chunks when buffer is full
          while (this.buffer.length >= this.bufferSize) {
            const chunk = this.buffer.splice(0, this.bufferSize);
            const int16Array = new Int16Array(chunk);
            this.port.postMessage({ pcmData: int16Array.buffer }, [int16Array.buffer]);
          }

          return true;
        }
      }

      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([processorCode], { type: "application/javascript" });
    return URL.createObjectURL(blob);
  }
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private nextPlayTime = 0;
  private isPlaying = false;
  private onOutputLevel: ((level: number) => void) | null = null;
  private levelCheckInterval: ReturnType<typeof setInterval> | null = null;

  async init(onOutputLevel?: (level: number) => void): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.nextPlayTime = this.audioContext.currentTime;
    this.onOutputLevel = onOutputLevel || null;

    // Create analyser for output level monitoring
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.5;

    // Create gain node for routing
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    // Start level monitoring if callback provided
    if (this.onOutputLevel) {
      this.startLevelMonitoring();
    }
  }

  private startLevelMonitoring(): void {
    if (!this.analyserNode || !this.onOutputLevel) return;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.levelCheckInterval = setInterval(() => {
      if (!this.analyserNode || !this.onOutputLevel) return;

      this.analyserNode.getByteFrequencyData(dataArray);

      // Calculate average level (0-1)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length / 255;

      this.onOutputLevel(average);
    }, 50);
  }

  play(pcmData: ArrayBuffer): void {
    if (!this.audioContext || !this.gainNode) return;

    // Convert base64 PCM to audio buffer
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);

    // Convert int16 to float32
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(
      1,
      float32Array.length,
      OUTPUT_SAMPLE_RATE
    );
    audioBuffer.getChannelData(0).set(float32Array);

    // Create buffer source
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    // Connect through gain node for level monitoring
    source.connect(this.gainNode);

    // Schedule playback
    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextPlayTime);
    source.start(startTime);

    this.nextPlayTime = startTime + audioBuffer.duration;
    this.isPlaying = true;

    source.onended = () => {
      if (this.nextPlayTime <= (this.audioContext?.currentTime ?? 0) + 0.1) {
        this.isPlaying = false;
      }
    };
  }

  stop(): void {
    if (this.levelCheckInterval) {
      clearInterval(this.levelCheckInterval);
      this.levelCheckInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.nextPlayTime = 0;
    this.onOutputLevel = null;
  }

  clear(): void {
    // Reset playback timing to interrupt current audio
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
