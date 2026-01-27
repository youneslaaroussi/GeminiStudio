import { Renderer, RendererResult, Vector2, type Project as MotionCanvasProject } from '@motion-canvas/core';
import { initSocket, getSocket } from './socket.js';
import { FFmpegExporterClient } from './ffmpeg-exporter-client.js';
import type { Project, ProjectTranscription } from '@gemini-studio/types';
import projectFactory from '../../../scene/dist/src/project.js';

interface HeadlessJobPayload {
  token: string;
  project: Project;
  variables: {
    layers: unknown;
    duration: number;
    transitions: Record<string, unknown>;
    transcriptions: Record<string, ProjectTranscription>;
  };
  output: {
    filePath: string;
    fps: number;
    size: { width: number; height: number };
    range: [number, number];
    background: string;
    resolutionScale: number;
    format: 'mp4' | 'webm' | 'gif';
    quality: string;
    includeAudio: boolean;
    fastStart: boolean;
  };
  exporter: {
    fastStart: boolean;
    includeAudio: boolean;
    projectID: string;
    output: string;
    quality: string;
    format: 'mp4' | 'webm' | 'gif';
  };
}

declare global {
  interface Window {
    nodeHandleRenderProgress?: (frame: number, total: number) => void;
    nodeHandleRenderEnd?: (status: string) => void;
    nodeHandleRenderError?: (message: string) => void;
  }
}

const fetchJobPayload = async (token: string): Promise<HeadlessJobPayload> => {
  const res = await fetch(`/jobs/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch job payload: HTTP ${res.status}`);
  }
  return await res.json();
};

const attachRendererHooks = (renderer: Renderer, totalFrames: number) => {
  renderer.onFrameChanged.subscribe((frame) => {
    window.nodeHandleRenderProgress?.(frame, totalFrames);
  });

  renderer.onFinished.subscribe((result: RendererResult) => {
    let status: string;
    switch (result) {
      case RendererResult.Success:
        status = 'success';
        break;
      case RendererResult.Aborted:
        status = 'aborted';
        break;
      default:
        status = 'error';
        break;
    }
    window.nodeHandleRenderEnd?.(status);
  });
};

const run = async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    throw new Error('Missing job token');
  }

  const payload = await fetchJobPayload(token);
  const segmentIndex = Number(params.get('segmentIndex') ?? '0');
  const segmentTotal = Number(params.get('segmentTotal') ?? '1');
  const segmentStartParam = params.get('segmentStart');
  const segmentEndParam = params.get('segmentEnd');
  const segmentOutputParam = params.get('segmentOutput');

  const segmentStart = segmentStartParam !== null ? Number(segmentStartParam) : payload.output.range[0];
  const segmentEnd =
    segmentEndParam !== null ? Number(segmentEndParam) : payload.output.range[1];

  if (Number.isFinite(segmentStart) && Number.isFinite(segmentEnd)) {
    payload.output.range = [segmentStart, segmentEnd];
  }

  if (segmentOutputParam) {
    const decoded = decodeURIComponent(segmentOutputParam);
    payload.output.filePath = decoded;
    payload.exporter.output = decoded;
  }

  console.debug('[headless] Segment info', {
    segmentIndex,
    segmentTotal,
    range: payload.output.range,
    output: payload.output.filePath,
  });

  const socket = initSocket(token);

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
  });

  const project = projectFactory as MotionCanvasProject;

  // Inject variables used by the Motion Canvas scene.
  project.variables = {
    ...project.variables,
    ...payload.variables,
  };

  project.logger.onLogged.subscribe((entry) => {
    console.debug('[motion-canvas]', entry);
  });

  // Register exporter with Motion Canvas.
  const exporters = project.meta.rendering.exporter.exporters as unknown as Array<typeof FFmpegExporterClient>;
  exporters.splice(0, exporters.length, FFmpegExporterClient);

  const renderer = new Renderer(project);
  const totalFrames = Math.round(
    Math.max(0, payload.output.range[1] - payload.output.range[0]) * payload.output.fps,
  );
  attachRendererHooks(renderer, totalFrames);

  try {
    window.nodeHandleRenderProgress?.(0, totalFrames);

    await renderer.render({
      exporter: {
        name: FFmpegExporterClient.id,
        options: {
          ...payload.exporter,
        },
      },
      name: 'project',
      colorSpace: 'srgb',
      fps: payload.output.fps,
      resolutionScale: payload.output.resolutionScale,
      size: new Vector2(payload.output.size.width, payload.output.size.height),
      background: payload.output.background,
      range: payload.output.range,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.nodeHandleRenderError?.(message);
    throw err;
  } finally {
    getSocket().close();
  }
};

run().catch((error) => {
  console.error('[headless] Fatal error', error);
  window.nodeHandleRenderError?.(error instanceof Error ? error.message : String(error));
});
