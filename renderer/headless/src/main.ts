import { Renderer, RendererResult, Vector2, type Project as MotionCanvasProject } from '@motion-canvas/core';
import { initSocket, getSocket } from './socket.js';
import { FFmpegExporterClient } from './ffmpeg-exporter-client.js';
import { FONT_FAMILIES } from '../font-config.js';
import type { Project, ProjectTranscription } from '../../src/types/index.js';

interface HeadlessJobPayload {
  token: string;
  project: Project;
  variables: {
    layers: unknown;
    duration: number;
    transitions: Record<string, unknown>;
    transcriptions: Record<string, ProjectTranscription>;
    captionSettings?: unknown;
    textClipSettings?: unknown;
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
    __SCENE_PROJECT__?: MotionCanvasProject;
  }
}

const fetchJobPayload = async (token: string): Promise<HeadlessJobPayload> => {
  const res = await fetch(`/jobs/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch job payload: HTTP ${res.status}`);
  }
  return await res.json();
};

/**
 * Wait for fonts.css to load then load all font families so canvas text matches app preview.
 */
const waitForFonts = async (): Promise<void> => {
  const link = document.querySelector<HTMLLinkElement>('link[href*="fonts.css"]');
  if (link) {
    await new Promise<void>((resolve, reject) => {
      if (link.sheet) {
        resolve();
        return;
      }
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => reject(new Error('fonts.css failed to load')));
      setTimeout(() => resolve(), 8000);
    });
  }
  if (!document.fonts) return;
  await Promise.all(FONT_FAMILIES.map((family) => document.fonts.load(`400 1em "${family}"`)));
  await document.fonts.ready;
};

/**
 * Dynamically load the compiled project.js served by the RenderRunner.
 *
 * The scene-compiler service injects `globalThis.__SCENE_PROJECT__ = project;`
 * into the compiled output. We load it as a <script type="module"> and read
 * the global once the script has executed.
 */
const loadCompiledProject = async (): Promise<MotionCanvasProject> => {
  // Fetch the compiled JS from the server
  const res = await fetch('/headless/project.js');
  if (!res.ok) {
    throw new Error(`Failed to fetch compiled project.js: HTTP ${res.status}`);
  }
  const js = await res.text();

  // Load via blob URL + script tag (same approach as ScenePlayer in the app)
  const blob = new Blob([js], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  // Clear any previous project
  delete window.__SCENE_PROJECT__;

  try {
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.type = 'module';
      el.src = blobUrl;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Compiled project script failed to load'));
      document.head.appendChild(el);
    });

    // Module scripts execute asynchronously after load event.
    // Poll briefly for __SCENE_PROJECT__ to be set.
    const maxWait = 10_000; // 10 seconds
    const interval = 50;
    let elapsed = 0;
    while (!window.__SCENE_PROJECT__ && elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }

    const project = window.__SCENE_PROJECT__;
    if (!project || typeof project !== 'object') {
      throw new Error(
        'Compiled project did not set globalThis.__SCENE_PROJECT__ within timeout',
      );
    }

    return project;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
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

  // Load the dynamically compiled project from the server
  console.debug('[headless] Loading compiled project...');
  const project = await loadCompiledProject();
  console.debug('[headless] Project loaded successfully');

  const socket = initSocket(token);

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
  });

  // Inject variables used by the Motion Canvas scene.
  project.variables = {
    ...project.variables,
    ...payload.variables,
  };

  project.logger.onLogged.subscribe((entry) => {
    console.debug('[motion-canvas]', entry);
  });

  // Wait for fonts (fonts.css + all font files) so canvas text uses correct font like app preview.
  console.debug('[headless] Waiting for fonts...');
  await waitForFonts();
  console.debug('[headless] Fonts ready');

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
