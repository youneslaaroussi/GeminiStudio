import type { Project, RendererResult, RendererSettings } from '@motion-canvas/core';
import { getSocket } from './socket.js';

interface MotionCanvasResponse {
  status: 'success' | 'error';
  method: string;
  data?: unknown;
  message?: string;
}

class MetaField<T> {
  public constructor(public readonly name: string, public readonly initial: T) {}
}

interface Exporter {
  start?(): Promise<void>;
  handleFrame(canvas: HTMLCanvasElement): Promise<void>;
  stop?(result: RendererResult): Promise<void>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class FFmpegExporterClient implements Exporter {
  public static readonly id = '@motion-canvas/ffmpeg-custom';
  public static readonly displayName = 'FFmpeg (Gemini Studio)';

  public static meta(): MetaField<unknown> {
    return new MetaField('ffmpeg', null);
  }

  public static async create(project: Project, settings: RendererSettings) {
    return new FFmpegExporterClient(project, settings);
  }

  private readonly pending = new Map<string, PendingRequest[]>();
  private readonly socket = getSocket();
  private frameIndex = 0;

  public constructor(
    private readonly project: Project,
    private readonly settings: RendererSettings,
  ) {
    this.socket.on('motion-canvas/ffmpeg-ack', this.handleAck);
  }

  private handleAck = (response: MotionCanvasResponse) => {
    const queue = this.pending.get(response.method);
    if (!queue || queue.length === 0) {
      return;
    }

    const { resolve, reject } = queue.shift()!;
    if (queue.length === 0) {
      this.pending.delete(response.method);
    }

    if (response.status === 'success') {
      resolve(response.data);
    } else {
      reject(new Error(response.message ?? 'FFmpeg exporter error'));
    }
  };

  private invoke<T = unknown>(method: string, data: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = this.pending.get(method) ?? [];
      queue.push({ resolve, reject });
      this.pending.set(method, queue);
      this.socket.emit('motion-canvas/ffmpeg', { method, data });
    });
  }

  public async start(): Promise<void> {
    this.frameIndex = 0;
    const options = this.settings.exporter.options as Record<string, unknown>;
    const audioOffset =
      (this.project.meta?.shared?.audioOffset?.get?.() as number | undefined) ?? 0;
    await this.invoke('start', {
      ...this.settings,
      ...options,
      audio: this.project.audio,
      audioOffset: audioOffset - this.settings.range[0],
    });
  }

  public async handleFrame(canvas: HTMLCanvasElement): Promise<void> {
    const totalFrames = Math.round(
      Math.max(0, this.settings.range[1] - this.settings.range[0]) * this.settings.fps,
    );
    // Drop last frame (Motion Canvas often renders a black frame at the end).
    if (this.frameIndex >= totalFrames - 1) {
      this.frameIndex++;
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/png'),
    );
    if (!blob) {
      this.frameIndex++;
      return;
    }

    const buffer = await blob.arrayBuffer();
    await this.invoke('handleFrame', { data: buffer });
    this.frameIndex++;
  }

  public async stop(result: RendererResult): Promise<void> {
    try {
      await this.invoke('end', result);
    } finally {
      this.socket.off('motion-canvas/ffmpeg-ack', this.handleAck);
      this.pending.clear();
    }
  }
}
