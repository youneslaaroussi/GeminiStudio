import { randomUUID } from 'crypto';
import { isAbsolute, resolve as pathResolve, join, parse } from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../logger.js';
import type { RenderJobData } from '../jobs/render-job.js';
import type { AudioClip, Layer, VideoClip } from '../types/index.js';

interface MergeAudioParams {
  job: RenderJobData;
  videoPath: string;
  range: [number, number];
  tempDir: string;
  logContext?: Record<string, unknown>;
}

interface ClipAudioEntry {
  source: string;
  start: number;
  end: number;
  delayMs: number;
  speed: number;
  volume: number;
}

// Allowed domains for media sources
const ALLOWED_MEDIA_DOMAINS = [
  'storage.googleapis.com',
  'storage.cloud.google.com',
  'localhost',
  '127.0.0.1',
];

const isAllowedMediaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ALLOWED_MEDIA_DOMAINS.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
};

const resolveMediaSource = (src: string, baseUrl?: string): string | null => {
  if (!src) return null;

  // SECURITY: Block file:// URLs - could access local filesystem
  if (src.startsWith('file://')) {
    logger.warn({ src }, 'Blocked file:// URL for security');
    return null;
  }

  // SECURITY: Block absolute paths - could access sensitive files
  if (isAbsolute(src) && !src.startsWith('/tmp/')) {
    logger.warn({ src }, 'Blocked absolute path outside /tmp for security');
    return null;
  }

  // Allow absolute paths within /tmp (our safe directory)
  if (isAbsolute(src) && src.startsWith('/tmp/')) {
    return src;
  }

  // For HTTP(S) URLs, validate domain
  if (/^https?:\/\//i.test(src)) {
    if (!isAllowedMediaUrl(src)) {
      logger.warn({ src }, 'Blocked URL from non-allowed domain');
      return null;
    }
    return src;
  }

  // For relative paths, must have a validated baseUrl
  if (baseUrl) {
    try {
      const resolved = new URL(src, baseUrl).toString();
      if (!isAllowedMediaUrl(resolved)) {
        logger.warn({ src, baseUrl, resolved }, 'Resolved URL from non-allowed domain');
        return null;
      }
      return resolved;
    } catch (err) {
      logger.warn({ err, src, baseUrl }, 'Failed to resolve media source with baseUrl');
    }
  }

  // Don't resolve relative paths without a safe baseUrl
  logger.warn({ src }, 'Cannot resolve relative path without baseUrl');
  return null;
};

const sourceHasAudioStream = async (source: string): Promise<boolean> =>
  new Promise((resolve) => {
    ffmpeg.ffprobe(source, (err, data) => {
      if (err) {
        logger.warn({ err, source }, 'ffprobe failed');
        resolve(false);
        return;
      }
      const hasAudio = (data.streams ?? []).some((stream) => stream.codec_type === 'audio');
      resolve(hasAudio);
    });
  });

const collectLayerAudio = (
  layers: Layer[],
  range: [number, number],
  baseUrl?: string,
): ClipAudioEntry[] => {
  const [rangeStart, rangeEnd] = range;
  const entries: ClipAudioEntry[] = [];

  for (const layer of layers) {
    if (layer.type !== 'video' && layer.type !== 'audio') continue;
    for (const clip of layer.clips ?? []) {
      if (clip.type === 'video' && clip.src) {
        const entry = buildClipEntry(clip, rangeStart, rangeEnd, baseUrl);
        if (entry) entries.push(entry);
      } else if (clip.type === 'audio' && clip.src) {
        const entry = buildClipEntry(clip, rangeStart, rangeEnd, baseUrl);
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
};

const buildClipEntry = (
  clip: VideoClip | AudioClip,
  rangeStart: number,
  rangeEnd: number,
  baseUrl?: string,
): ClipAudioEntry | null => {
  const source = resolveMediaSource(clip.src, baseUrl);
  if (!source) return null;

  const safeSpeed = Math.max(clip.speed ?? 1, 0.0001);
  const clipStart = clip.start;
  const clipEnd = clip.start + clip.duration;

  const overlapStart = Math.max(rangeStart, clipStart);
  const overlapEnd = Math.min(rangeEnd, clipEnd);

  if (!(overlapEnd > overlapStart + 1e-3)) {
    return null;
  }

  const offset = clip.offset ?? 0;
  const sourceFrom = offset + (overlapStart - clipStart) * safeSpeed;
  const sourceTo = offset + (overlapEnd - clipStart) * safeSpeed;
  if (!(sourceTo > sourceFrom)) {
    return null;
  }

  const delayMs = Math.max(0, overlapStart - rangeStart) * 1000;
  const volume = clip.type === 'audio'
    ? (clip.volume ?? 1)
    : ((clip as VideoClip).audioVolume ?? 1);

  return {
    source,
    start: sourceFrom,
    end: sourceTo,
    delayMs,
    speed: safeSpeed,
    volume,
  };
};

export const mergeTimelineAudio = async ({
  job,
  videoPath,
  range,
  tempDir,
  logContext,
}: MergeAudioParams): Promise<boolean> => {
  if (job.output.format === 'gif') {
    logger.info({ ...logContext }, 'Skipping audio merge for GIF output');
    return false;
  }

  if (job.output.includeAudio === false) {
    logger.info({ ...logContext }, 'Audio merge disabled by render job settings');
    return false;
  }

  const [rangeStart, rangeEnd] = range;
  if (!(rangeEnd > rangeStart)) {
    logger.info({ ...logContext, range }, 'Skipping audio merge due to zero duration range');
    return false;
  }

  const layers = (job.variables?.layers ?? job.project.layers) as Layer[];
  const entries = collectLayerAudio(layers, range, job.assets?.baseUrl);

  if (entries.length === 0) {
    logger.info({ ...logContext }, 'No audio-capable clips found, skipping audio merge');
    return false;
  }

  const validatedEntries: ClipAudioEntry[] = [];
  for (const entry of entries) {
    const hasAudio = await sourceHasAudioStream(entry.source);
    if (hasAudio) {
      validatedEntries.push(entry);
    }
  }

  if (validatedEntries.length === 0) {
    logger.info({ ...logContext }, 'Audio sources do not contain audio streams, skipping merge');
    return false;
  }

  const mixedAudioPath = join(tempDir, `timeline-audio-${randomUUID()}.m4a`);
  const command = ffmpeg();
  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  let inputIndex = 0;
  for (const entry of validatedEntries) {
    command.input(entry.source);
    const filters: string[] = [
      `[${inputIndex}:a]atrim=start=${entry.start}:end=${entry.end},asetpts=PTS-STARTPTS`,
    ];

    // ffmpeg atempo only supports values 0.5-2; chain if necessary.
    if (Math.abs(entry.speed - 1) > 1e-3) {
      let remainingSpeed = entry.speed;
      const atempoFilters: string[] = [];
      while (remainingSpeed > 2) {
        atempoFilters.push('atempo=2');
        remainingSpeed /= 2;
      }
      while (remainingSpeed < 0.5) {
        atempoFilters.push('atempo=0.5');
        remainingSpeed *= 2;
      }
      atempoFilters.push(`atempo=${remainingSpeed}`);
      filters.push(...atempoFilters);
    }

    if (entry.delayMs > 0) {
      const delay = Math.round(entry.delayMs);
      filters.push(`adelay=${delay}|${delay}`);
    }

    if (Math.abs(entry.volume - 1) > 1e-3) {
      filters.push(`volume=${entry.volume}`);
    }

    const label = `[a${inputIndex}]`;
    filterParts.push(`${filters.join(',')}${label}`);
    mixInputs.push(label);
    inputIndex += 1;
  }

  if (mixInputs.length === 0) {
    logger.info({ ...logContext }, 'Filtered audio inputs empty, skipping merge');
    return false;
  }

  filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`);

  await new Promise<void>((resolve, reject) => {
    command
      .complexFilter(filterParts)
      .outputOptions(['-map [aout]', '-ac 2'])
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(mixedAudioPath);
  });

  const videoPathInfo = parse(videoPath);
  const tempVideoPath = join(
    videoPathInfo.dir,
    `${videoPathInfo.name}-audio-${randomUUID()}${videoPathInfo.ext || '.mp4'}`,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(mixedAudioPath)
        .outputOptions(['-map 0:v', '-map 1:a', '-c:v copy', '-ac 2'])
        .on('error', (err) => reject(err))
        .on('end', () => resolve())
        .save(tempVideoPath);
    });

    await fs.rm(videoPath).catch(() => undefined);
    try {
      await fs.rename(tempVideoPath, videoPath);
    } catch (renameErr) {
      await fs.copyFile(tempVideoPath, videoPath);
    }

    logger.info({ ...logContext, videoPath }, 'Merged timeline audio into rendered video');
    return true;
  } finally {
    await fs.rm(mixedAudioPath, { force: true }).catch(() => undefined);
    await fs.rm(tempVideoPath, { force: true }).catch(() => undefined);
  }
};
