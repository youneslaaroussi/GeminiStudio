import ffmpeg from 'fluent-ffmpeg';
import { join } from 'path';
import type { RendererResult, RendererSettings } from '@motion-canvas/core';
import { ImageStream } from './image-stream.js';

export interface FFmpegExporterSettings extends RendererSettings {
  index: number;
  fastStart: boolean;
  includeAudio: boolean;
  projectID: string;
  output: string;
  fps: number;
  width: number;
  height: number;
  quality: 'web' | 'low' | 'social' | 'studio';
  format: 'mp4' | 'webm' | 'gif';
}

const qualityToCrf: Record<string, number> = {
  low: 30,
  web: 23,
  social: 20,
  studio: 14,
};

export class FFmpegExporterServer {
  private readonly stream = new ImageStream();
  private readonly command: ffmpeg.FfmpegCommand;
  public readonly promise: Promise<void>;

  public constructor(private readonly settings: FFmpegExporterSettings) {
    this.command = ffmpeg();

    this.command.input(this.stream).inputFormat('image2pipe').inputFps(settings.fps);

    const size = {
      x: Math.round(settings.size.x * settings.resolutionScale),
      y: Math.round(settings.size.y * settings.resolutionScale),
    };

    this.command.output(join(this.settings.output)).outputFps(settings.fps).size(`${size.x}x${size.y}`);

    switch (settings.format) {
      case 'mp4':
        this.command.outputOptions(['-pix_fmt yuv420p', '-shortest']);
        if (settings.fastStart) {
          this.command.outputOptions(['-movflags +faststart']);
        }
        break;
      case 'webm':
        this.command.outputOptions(['-c:v libvpx-vp9', '-b:v 2M', '-an']);
        break;
      case 'gif':
        this.command.outputOptions([
          '-vf',
          `fps=${this.settings.fps},scale=${this.settings.width}:${this.settings.height}:flags=lanczos`,
          '-gifflags',
          '+transdiff',
          '-y',
        ]);
        break;
    }

    const crf = qualityToCrf[settings.quality] ?? qualityToCrf.web;
    this.command.outputOptions([`-crf ${crf}`]);

    this.promise = new Promise<void>((resolve, reject) => {
      this.command
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });
  }

  public async start() {
    this.command.run();
  }

  public async handleFrame({ data }: { data: ArrayBuffer }) {
    const buffer = Buffer.from(data);
    this.stream.pushImage(buffer);
  }

  public async end(result: RendererResult) {
    this.stream.pushImage(null);
    if (result === 1) {
      try {
        this.command.kill('SIGKILL');
        await this.promise;
      } catch {
        // noop
      }
    } else {
      await this.promise;
    }
  }
}
