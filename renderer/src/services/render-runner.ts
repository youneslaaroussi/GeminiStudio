import { createServer as createHttpServer } from 'http';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { access, mkdir, rename, copyFile, rm, readFile } from 'fs/promises';
import getPort from 'get-port';
import express from 'express';
import { Server as IOServer } from 'socket.io';
import { Cluster } from 'puppeteer-cluster';
import type { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../logger.js';
import type { RenderJobData } from '../jobs/render-job.js';
import { createTempDir, cleanupTempDir } from '../infra/temp.js';
import { FFmpegBridge } from '../infra/ffmpeg/bridge.js';
import { mergeTimelineAudio } from '../audio/merge-audio.js';
import type { Project, Layer } from '../types/index.js';
import { loadConfig } from '../config.js';
import { compileScene } from './scene-compiler-client.js';

const config = loadConfig();

// Resolve headless bundle from package root: headless/dist (dev) or dist/headless (prod)
const packageRoot = process.cwd();
const headlessDistDev = join(packageRoot, 'headless', 'dist');
const headlessDistProd = join(packageRoot, 'dist', 'headless');
const HEADLESS_DIST = existsSync(join(headlessDistDev, 'main.js'))
  ? headlessDistDev
  : headlessDistProd;
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
  gcsPath?: string;
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
  // Pass layers as-is so all clip properties (effect, colorGrading, mask*, focus, etc.) reach the scene
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
    captionSettings:
      job.variables?.captionSettings ?? job.project.captionSettings ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        fontSize: 18,
        distanceFromBottom: 140,
        style: 'pill',
      },
    textClipSettings:
      job.variables?.textClipSettings ?? job.project.textClipSettings ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        defaultFontSize: 48,
        defaultFill: '#ffffff',
      },
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
      resolutionScale: job.options?.resolutionScale ?? 1,
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

/**
 * Upload rendered file to GCS using a pre-signed PUT URL
 */
const uploadToSignedUrl = async (
  filePath: string,
  uploadUrl: string,
  logContext: Record<string, unknown>,
): Promise<string> => {
  const fileBuffer = await readFile(filePath);

  // Determine content type from file extension
  const ext = filePath.split('.').pop()?.toLowerCase();
  const contentType = ext === 'mp4' ? 'video/mp4'
    : ext === 'webm' ? 'video/webm'
    : ext === 'gif' ? 'image/gif'
    : 'application/octet-stream';

  logger.info({ ...logContext, uploadUrl: uploadUrl.substring(0, 100) + '...', size: fileBuffer.length }, 'Uploading to GCS');

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length.toString(),
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload to GCS: ${response.status} ${errorText}`);
  }

  // Extract GCS path from the signed URL
  const urlObj = new URL(uploadUrl);
  const gcsPath = `gs:/${urlObj.pathname}`;

  logger.info({ ...logContext, gcsPath }, 'Successfully uploaded to GCS');
  return gcsPath;
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

    // Compile scene via the scene-compiler service (dynamic, like the app does)
    logger.info({ jobId: job.id, componentFiles: Object.keys(data.componentFiles ?? {}) }, 'Compiling scene');
    const compileResult = await compileScene(config, {
      files: data.componentFiles,
    });
    const compiledProjectJs = compileResult.js;
    logger.info({ jobId: job.id, compiledSize: Buffer.byteLength(compiledProjectJs) }, 'Scene compiled successfully');

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

      // Serve the dynamically compiled project.js (must be registered before static middleware)
      httpApp.get('/headless/project.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(compiledProjectJs);
      });

      // Serve static files (including index.html) from headless dist
      // Use /headless/ as the mount point so relative paths in HTML resolve correctly
      httpApp.use('/headless/', express.static(HEADLESS_DIST, { index: 'index.html' }));
      // Redirect /headless to /headless/ for convenience
      httpApp.get('/headless', (_req, res) => {
        res.redirect(301, '/headless/');
      });

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

      const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--mute-audio',
        '--disable-audio-output',
        '--disable-web-security',
        '--allow-file-access-from-files',
        '--disable-features=IsolateOrigins,site-per-process',
      ];

      if (process.platform === 'linux') {
        puppeteerArgs.push('--disable-gpu', '--disable-dev-shm-usage');
      }

      if (process.platform === 'darwin') {
        puppeteerArgs.push('--use-mock-keychain');
      }

      const puppeteerOptions: Parameters<typeof Cluster.launch>[0]['puppeteerOptions'] = {
        headless: config.headless,
        args: puppeteerArgs,
      };

      if (config.chromeExecutablePath) {
        puppeteerOptions.executablePath = config.chromeExecutablePath;
      }

      cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: Math.max(1, Math.min(config.headlessConcurrency, segments.length)),
        puppeteerOptions,
        timeout: config.taskTimeoutMs,
      });

      const failedSegments: { segment: SegmentDefinition; error: Error }[] = [];

      cluster.on('taskerror', (err, segment) => {
        const error = err instanceof Error ? err : new Error(String(err));
        failedSegments.push({ segment, error });
        logger.error({ jobId: job.id, segment, err: error }, 'Segment task failed');
      });

      // Shared progress map: segment index -> ratio [0..1]. Used to aggregate progress
      // across parallel segments so the reported value is monotonic, not jumping.
      const segmentProgressMap = new Map<number, number>();
      for (let i = 0; i < segments.length; i++) {
        segmentProgressMap.set(i, 0);
      }

      const segmentProgressWeight = 70; // 5..75 for rendering, rest for merge/upload

      const serverOrigin = `http://127.0.0.1:${port}`;
      const allowedHosts = new Set(config.headlessAllowedRequestHosts);

      const isHostAllowlisted = (hostname: string): boolean => {
        for (const pattern of allowedHosts) {
          if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(1);
            if (hostname === suffix || hostname.endsWith(suffix)) return true;
          } else if (hostname === pattern) {
            return true;
          }
        }
        return false;
      };

      await cluster.task(async ({ page, data: segment }) => {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const requestUrl = request.url();
          let allowed = false;
          try {
            const url = new URL(requestUrl);
            const origin = url.origin;
            if (origin === serverOrigin) {
              allowed = true;
            } else if (isHostAllowlisted(url.hostname)) {
              allowed = true;
            }
          } catch {
            // Invalid URL: block
          }
          if (allowed) {
            request.continue().catch(() => {});
          } else {
            logger.debug({ jobId: job.id, url: requestUrl }, 'Headless request blocked (network isolation)');
            request.abort('blockedbyclient').catch(() => {});
          }
        });

        await page.exposeFunction(
          'nodeHandleRenderProgress',
          async (frame: number, total: number) => {
            if (total <= 0) return;
            const ratio = Math.min(1, Math.max(0, frame / total));
            segmentProgressMap.set(segment.index, ratio);
            let sum = 0;
            for (let i = 0; i < segments.length; i++) {
              sum += segmentProgressMap.get(i) ?? 0;
            }
            const overallRatio = segments.length > 0 ? sum / segments.length : 0;
            const progress = Math.min(80, Math.floor(5 + overallRatio * segmentProgressWeight));
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

        const consoleMessages: string[] = [];
        let lastError: string | null = null;

        page.on('console', async (message) => {
          const msgType = message.type();
          // Serialize JSHandle arguments to get actual values
          let text: string;
          try {
            const args = await Promise.all(
              message.args().map(async (arg) => {
                try {
                  const val = await arg.jsonValue();
                  return typeof val === 'object' ? JSON.stringify(val) : String(val);
                } catch {
                  return arg.toString();
                }
              }),
            );
            text = args.join(' ');
          } catch {
            text = message.text();
          }
          consoleMessages.push(`[${msgType}] ${text}`);
          if (msgType === 'error') {
            lastError = text;
            logger.error({ jobId: job.id, segment: segment.index, text }, 'Headless console error');
          } else {
            logger.debug({ jobId: job.id, segment: segment.index, text }, 'Headless console');
          }
        });

        page.on('pageerror', (error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          lastError = errorMsg;
          consoleMessages.push(`[pageerror] ${errorMsg}`);
          logger.error({ jobId: job.id, segment: segment.index, error: errorMsg }, 'Headless page error');
        });

        page.on('requestfailed', (request) => {
          const failure = request.failure();
          const url = request.url();
          // Ignore favicon failures
          if (url.includes('favicon')) return;
          const errorText = `Request failed: ${url} - ${failure?.errorText ?? 'unknown'}`;
          lastError = errorText;
          consoleMessages.push(`[requestfailed] ${errorText}`);
          logger.error({ jobId: job.id, segment: segment.index, url, error: failure?.errorText }, 'Headless request failed');
        });

        const url = new URL(`http://127.0.0.1:${port}/headless/`);
        url.searchParams.set('token', token);
        url.searchParams.set('segmentIndex', segment.index.toString());
        url.searchParams.set('segmentTotal', segments.length.toString());
        url.searchParams.set('segmentStart', segment.start.toString());
        url.searchParams.set('segmentEnd', segment.end.toString());
        url.searchParams.set('segmentOutput', encodeURIComponent(segment.outputPath));

        await page.goto(url.toString(), { waitUntil: 'networkidle2' });

        const status = await renderPromise;
        if (status !== 'success') {
          const recentLogs = consoleMessages.slice(-10).join('\n');
          throw new Error(
            `Segment ${segment.index} failed with status ${status}. Last error: ${lastError ?? 'unknown'}. Recent console:\n${recentLogs}`,
          );
        }

        // Mark this segment as complete and recompute overall progress
        segmentProgressMap.set(segment.index, 1);
        let sum = 0;
        for (let i = 0; i < segments.length; i++) {
          sum += segmentProgressMap.get(i) ?? 0;
        }
        const overallRatio = segments.length > 0 ? sum / segments.length : 0;
        const progress = Math.min(80, Math.floor(5 + overallRatio * segmentProgressWeight));
        await job.updateProgress(progress).catch(() => undefined);
      });

      for (const segment of segments) {
        await cluster.queue(segment);
      }

      await cluster.idle();

      if (failedSegments.length > 0) {
        const firstError = failedSegments[0];
        throw new Error(
          `${failedSegments.length} segment(s) failed to render. First error (segment ${firstError.segment.index}): ${firstError.error.message}`,
          { cause: firstError.error },
        );
      }

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

      await job.updateProgress(95).catch(() => undefined);

      // Upload to GCS if uploadUrl is provided
      let gcsPath: string | undefined;
      if (data.output.uploadUrl) {
        gcsPath = await uploadToSignedUrl(
          data.output.destination,
          data.output.uploadUrl,
          { jobId: job.id },
        );
        // Clean up local file after successful upload
        await rm(data.output.destination, { force: true }).catch(() => undefined);
      }

      await job.updateProgress(100).catch(() => undefined);

      logger.info({ jobId: job.id, output: data.output.destination, gcsPath }, 'Render job completed');
      return { outputPath: data.output.destination, gcsPath };
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'Render job failed');
      throw err;
    } finally {
      await dispose();
    }
  }
}
