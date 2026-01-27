import type { Server, Socket } from 'socket.io';
import type { RendererResult } from '@motion-canvas/core';
import { FFmpegExporterServer, FFmpegExporterSettings } from './exporter-server.js';

type MotionCanvasRequest = {
  method: string;
  data: unknown;
};

export class FFmpegBridge {
  public process: FFmpegExporterServer | null = null;

  public constructor(
    private readonly socket: Socket,
    private readonly io: Server,
    private readonly fps: number,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.socket.on('motion-canvas/ffmpeg', this.handleMessage);
  }

  private handleMessage = async ({ method, data }: MotionCanvasRequest) => {
    if (method === 'start') {
      this.process = new FFmpegExporterServer({
        ...((data ?? {}) as FFmpegExporterSettings),
        fps: this.fps,
        width: this.width,
        height: this.height,
      });
      await this.process.start();
      this.respondSuccess(method, {});
      return;
    }

    if (!this.process) {
      this.respondError(method, 'Exporter process not started.');
      return;
    }

    try {
      if (method === 'handleFrame') {
        await this.process.handleFrame(data as { data: ArrayBuffer });
      } else if (method === 'end') {
        await this.process.end(data as RendererResult);
        this.process = null;
      } else {
        this.respondError(method, `Unknown method ${method}`);
        return;
      }
      this.respondSuccess(method, {});
    } catch (err) {
      this.respondError(method, err instanceof Error ? err.message : String(err));
    }
  };

  private respondSuccess(method: string, data: unknown) {
    this.io.emit('motion-canvas/ffmpeg-ack', {
      status: 'success',
      method,
      data,
    });
  }

  private respondError(method: string, message: string) {
    this.io.emit('motion-canvas/ffmpeg-ack', {
      status: 'error',
      method,
      message,
    });
  }
}
