import { createServer as createHttpServer } from 'http';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { access, mkdir, rename, copyFile, rm } from 'fs/promises';
import getPort from 'get-port';
import express from 'express';
import { Server as IOServer } from 'socket.io';
import { Cluster } from 'puppeteer-cluster';
import type { Job } from 'bullmq';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../logger.js';
import type { RenderJobData } from '../jobs/render-job.js';
import { createTempDir, cleanupTempDir } from '../infra/temp.js';
import { FFmpegBridge } from '../infra/ffmpeg/bridge.js';
import { mergeTimelineAudio } from '../audio/merge-audio.js';
import type { Project, Layer } from '../types/index.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

const MODULE_DIR = dirname(fileURLToPath(new URL('.', import.meta.url)));
const HEADLESS_DIST = resolve(MODULE_DIR, '..', 'headless', 'dist');
const HEADLESS_HTML = join(HEADLESS_DIST, 'index.html');
const HEADLESS_BUNDLE = join(HEADLESS_DIST, 'main.js');

const FORMAT_EXTENSION: Record<string, string> = {
  mp4: '.mp4',
  webm: '.webm',
  gif: '.gif',
};

interface SegmentDefinition {
  index: number;
  start: number;
  end: number;
  outputPath: string;
}

export interface RenderResult {
  outputPath: string;
}

interface HeadlessJobPayload {
  token: string;
  project: Project;
  variables: Record<string, unknown>;
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

const ensureHeadlessBundle = async () => {
  try {
    await access(HEADLESS_BUNDLE);
  } catch (err) {
    throw new Error(
      `Headless bundle not found at ${HEADLESS_BUNDLE}. Run "pnpm --filter @gemini-studio/renderer build:headless" first.`,
      { cause: err },
    );
  }
};

const computeTimelineDuration = (layers: Layer[]): number => {
  let max = 0;
  for (const layer of layers) {
    for (const clip of layer.clips ?? []) {
      const speed = clip.speed ?? 1;
      const duration = clip.duration ?? 0;
      const end = clip.start + duration / Math.max(speed, 0.0001);
      max = Math.max(max, end);
    }
  }
  return max;
};

const normalizeQuality = (quality?: string): string => {
  if (!quality) return 'web';
  const normalized = quality.toLowerCase();
  if (normalized.includes('low')) return 'low';
  if (normalized.includes('social')) return 'social';
  if (normalized.includes('studio')) return 'studio';
  return 'web';
};

const buildVariables = (job: RenderJobData, computedDuration: number) => {
  const layers = job.variables?.layers ?? job.project.layers;
  const duration =
    job.variables?.duration ??
    job.timelineDuration ??
    job.output.range?.[1] ??
    computedDuration;

  return {
    layers,
    duration,
    transcriptions:
      job.variables?.transcriptions ?? job.project.transcriptions ?? {},
    transitions:
      job.variables?.transitions ?? job.project.transitions ?? {},
  };
};

const buildHeadlessPayload = (
  job: RenderJobData,
  token: string,
  variables: ReturnType<typeof buildVariables>,
  range: [number, number],
): HeadlessJobPayload => {
  const { project } = job;

  const quality = normalizeQuality(job.output.quality);
  const includeAudio = job.output.includeAudio ?? true;

  return {
    token,
    project,
    variables,
    output: {
      filePath: job.output.destination,
      fps: job.output.fps,
      size: job.output.size,
      range,
      background: project.background ?? '#000000',
      resolutionScale: project.renderScale ?? 1,
      format: job.output.format,
      quality,
      includeAudio,
      fastStart: true,
    },
    exporter: {
      fastStart: true,
      includeAudio,
      projectID: project.name ?? 'project',
      output: job.output.destination,
      quality,
      format: job.output.format,
    },
  };
};

const createSegmentDefinitions = (
  range: [number, number],
  job: RenderJobData,
  tempDir: string,
): SegmentDefinition[] => {
  const [start, end] = range;
  const totalDuration = Math.max(0, end - start);
  const extension = FORMAT_EXTENSION[job.output.format] ?? '.mp4';

  if (totalDuration === 0 || job.output.format === 'gif') {
    return [
      {
        index: 0,
        start,
        end,
        outputPath: join(tempDir, `segment-0-${randomUUID()}${extension}`),
      },
    ];
  }

  const requestedSegments = job.options?.segments;
  const segmentDurationPref = job.options?.segmentDuration ?? job.options?.maxSegmentDuration;

  let segmentCount: number;
  if (requestedSegments && requestedSegments > 0) {
    segmentCount = Math.min(requestedSegments, Math.max(1, Math.ceil(totalDuration / 0.5)));
  } else if (segmentDurationPref && segmentDurationPref > 0) {
    segmentCount = Math.max(1, Math.ceil(totalDuration / segmentDurationPref));
  } else {
    const defaultMaxSegment = Math.max(10, Math.min(25, totalDuration / 2 || 10));
    segmentCount = Math.max(1, Math.ceil(totalDuration / defaultMaxSegment));
  }

  const safeSegmentCount = Math.max(1, segmentCount);
  const segments: SegmentDefinition[] = [];
  const baseDuration = totalDuration / safeSegmentCount;

  for (let i = 0; i < safeSegmentCount; i++) {
    const segStart = start + i * baseDuration;
    const segEnd = i === safeSegmentCount - 1 ? end : Math.min(end, segStart + baseDuration);
    segments.push({
      index: i,
      start: segStart,
      end: segEnd,
      outputPath: join(tempDir, `segment-${i}-${randomUUID()}${extension}`),
    });
  }

  return segments;
};

const mergeVideoSegments = async (
  segments: SegmentDefinition[],
  destination: string,
  tempDir: string,
  logContext: Record<string, unknown>,
) => {
  const sorted = [...segments].sort((a, b) => a.index - b.index);

  if (sorted.length === 0) {
    throw new Error('No segment outputs available to merge.');
  }

  await rm(destination, { force: true }).catch(() => undefined);

  if (sorted.length === 1) {
    const [segment] = sorted;
    if (segment.outputPath === destination) {
      return;
    }

    try {
      await rename(segment.outputPath, destination);
    } catch (err) {
      await copyFile(segment.outputPath, destination);
      await rm(segment.outputPath, { force: true }).catch(() => undefined);
    }
    logger.info({ ...logContext }, 'Single segment render completed. Copied to destination.');
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg();
    sorted.forEach((segment) => command.input(segment.outputPath));

    command
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .mergeToFile(destination, tempDir);
  });

  logger.info({ ...logContext, segments: sorted.length }, 'Merged video segments.');
};

const cleanupSegments = async (segments: SegmentDefinition[]) => {
  await Promise.all(
    segments.map((segment) => rm(segment.outputPath, { force: true }).catch(() => undefined)),
  );
};

export class RenderRunner {
  public async run(job: Job<RenderJobData>): Promise<RenderResult> {
    const data = job.data;

    logger.info(
      {
        jobId: job.id,
        projectName: data.project.name,
        format: data.output.format,
        destination: data.output.destination,
      },
      'Render job started',
    );

    await ensureHeadlessBundle();

    const tempDir = await createTempDir('gemini-render');
    const bridges: FFmpegBridge[] = [];
    let cluster: Cluster<SegmentDefinition> | null = null;

    const httpApp = express();
    const httpServer = createHttpServer(httpApp);
    const io = new IOServer(httpServer, {
      maxHttpBufferSize: 1e8,
    });

    const layers = (data.variables?.layers ?? data.project.layers) as Layer[];
    const computedDuration = computeTimelineDuration(layers);
    const variables = buildVariables(data, computedDuration);

    const originalRange: [number, number] = data.output.range ?? [
      0,
      variables.duration ?? computedDuration,
    ];
    const normalizedRange: [number, number] = [
      Math.max(0, originalRange[0]),
      Math.max(originalRange[0], originalRange[1]),
    ];

    const token = randomUUID();
    const payload = buildHeadlessPayload(data, token, variables, normalizedRange);
    const segments = createSegmentDefinitions(normalizedRange, data, tempDir);

    const dispose = async () => {
      io.removeAllListeners();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      if (cluster) {
        await cluster.idle().catch(() => undefined);
        await cluster.close().catch(() => undefined);
      }
      await cleanupSegments(segments).catch(() => undefined);
      await cleanupTempDir(tempDir);
    };

    try {
      await job.updateProgress(5).catch(() => undefined);
      await mkdir(dirname(data.output.destination), { recursive: true });

      httpApp.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
      });

      httpApp.get('/headless', (_req, res) => {
        res.sendFile(HEADLESS_HTML);
      });
      httpApp.use('/headless', express.static(HEADLESS_DIST));

      httpApp.get('/jobs/:token', (req, res) => {
        if (req.params.token !== token) {
          res.status(404).json({ error: 'Unknown job token' });
          return;
        }
        res.json(payload);
      });

      io.use((socket, next) => {
        const authToken = socket.handshake.auth?.token ?? socket.handshake.query?.token;
        if (authToken !== token) {
          return next(new Error('Unauthorized'));
        }
        return next();
      });

      io.on('connection', (socket) => {
        logger.debug({ jobId: job.id }, 'Socket connected');
        bridges.push(
          new FFmpegBridge(
            socket,
            io,
            data.output.fps,
            data.output.size.width,
            data.output.size.height,
          ),
        );
      });

      const port = await getPort();
      await new Promise<void>((resolve) => httpServer.listen(port, resolve));

      cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: Math.max(1, Math.min(config.headlessConcurrency, segments.length)),
        puppeteerOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--mute-audio',
            '--disable-audio-output',
          ],
        },
      });

      cluster.on('taskerror', (err, segment) => {
        logger.error({ jobId: job.id, segment }, 'Segment task failed');
      });

      const segmentProgressWeight = segments.length > 0 ? 70 / segments.length : 70;

      await cluster.task(async ({ page, data: segment }) => {
        const segmentBaseProgress = 5 + segment.index * segmentProgressWeight;

        await page.exposeFunction(
          'nodeHandleRenderProgress',
          async (frame: number, total: number) => {
            if (total <= 0) return;
            const ratio = Math.min(1, Math.max(0, frame / total));
            const progress = Math.min(80, Math.floor(segmentBaseProgress + ratio * segmentProgressWeight));
            await job.updateProgress(progress).catch(() => undefined);
          },
        );

        const renderPromise = new Promise<string>((resolveRender, rejectRender) => {
          page
            .exposeFunction('nodeHandleRenderEnd', (status: string) => resolveRender(status))
            .catch((err) => rejectRender(err));
          page
            .exposeFunction('nodeHandleRenderError', (message: string) =>
              rejectRender(new Error(message)),
            )
            .catch((err) => rejectRender(err));
        });

        page.on('console', (message) => {
          const text = message.text();
          if (message.type() === 'error') {
            logger.error({ jobId: job.id, segment: segment.index, text }, 'Headless console error');
          } else {
            logger.debug({ jobId: job.id, segment: segment.index, text }, 'Headless console');
          }
        });

        page.on('pageerror', (error) => {
          logger.error({ jobId: job.id, segment: segment.index, error }, 'Headless page error');
        });

        const url = new URL(`http://127.0.0.1:${port}/headless`);
        url.searchParams.set('token', token);
        url.searchParams.set('segmentIndex', segment.index.toString());
        url.searchParams.set('segmentTotal', segments.length.toString());
        url.searchParams.set('segmentStart', segment.start.toString());
        url.searchParams.set('segmentEnd', segment.end.toString());
        url.searchParams.set('segmentOutput', encodeURIComponent(segment.outputPath));

        await page.goto(url.toString(), { waitUntil: 'networkidle2' });

        const status = await renderPromise;
        if (status !== 'success') {
          throw new Error(`Segment ${segment.index} failed with status ${status}`);
        }

        await job
          .updateProgress(Math.min(80, Math.floor(segmentBaseProgress + segmentProgressWeight)))
          .catch(() => undefined);
      });

      for (const segment of segments) {
        await cluster.queue(segment);
      }

      await cluster.idle();

      await Promise.all(
        bridges
          .map((bridge) => bridge.process?.promise)
          .filter((promise): promise is Promise<void> => Boolean(promise)),
      );

      await job.updateProgress(85).catch(() => undefined);

      await mergeVideoSegments(segments, data.output.destination, tempDir, { jobId: job.id });

      await job.updateProgress(90).catch(() => undefined);

      await mergeTimelineAudio({
        job: data,
        videoPath: data.output.destination,
        range: normalizedRange,
        tempDir,
        logContext: { jobId: job.id },
      });

      await job.updateProgress(100).catch(() => undefined);

      logger.info({ jobId: job.id, output: data.output.destination }, 'Render job completed');
      return { outputPath: data.output.destination };
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'Render job failed');
      throw err;
    } finally {
      await dispose();
    }
  }
}
