/**
 * Asset resolver for the renderer service.
 *
 * Resolves asset clip URLs, fetches component files, and fetches transcriptions
 * from the asset service. Uses the existing HMAC auth pattern for service-to-service calls.
 */

import { createHmac } from 'crypto';
import { logger } from '../logger.js';
import type { RendererConfig } from '../config.js';
import type { Project, Layer, VideoClip } from '../types/index.js';
import type { ProjectTranscription } from '../types/transcription.js';

/**
 * Generate HMAC auth headers for asset service requests.
 */
function getAssetServiceHeaders(config: RendererConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.assetServiceSharedSecret) {
    const timestamp = Date.now();
    const payload = `${timestamp}.`;
    const signature = createHmac('sha256', config.assetServiceSharedSecret)
      .update(payload)
      .digest('hex');
    headers['X-Signature'] = signature;
    headers['X-Timestamp'] = timestamp.toString();
  }
  return headers;
}

/**
 * Fetch a single asset's signed playback URL from the asset service.
 */
async function getAssetSignedUrl(
  config: RendererConfig,
  userId: string,
  projectId: string,
  assetId: string,
): Promise<string | null> {
  if (!config.assetServiceUrl) return null;

  const endpoint = `${config.assetServiceUrl.replace(/\/$/, '')}/api/assets/${userId}/${projectId}/${assetId}`;
  const headers = getAssetServiceHeaders(config);

  try {
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = (await response.json()) as { signedUrl?: string };
      return data.signedUrl ?? null;
    }
    logger.warn(
      { assetId, status: response.status },
      'Failed to get signed URL for asset',
    );
  } catch (err) {
    logger.warn({ assetId, err }, 'Error fetching signed URL for asset');
  }
  return null;
}

/**
 * Resolve all clip asset URLs in a project.
 * Iterates layers -> clips, fetches signed URLs for video/audio/image clips,
 * and sets `src` (and `maskSrc` for video masks).
 *
 * Mutates the project in place and returns it.
 */
export async function resolveClipUrls(
  config: RendererConfig,
  userId: string,
  projectId: string,
  project: Project,
): Promise<void> {
  if (!config.assetServiceUrl) {
    logger.warn('Asset service URL not configured, skipping URL resolution');
    return;
  }

  // Collect all unique assetIds to fetch in parallel
  const assetIdSet = new Set<string>();
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if (
        (clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') &&
        clip.assetId
      ) {
        assetIdSet.add(clip.assetId);
      }
      if (clip.type === 'video') {
        const v = clip as VideoClip;
        if (v.maskAssetId) {
          assetIdSet.add(v.maskAssetId);
        }
      }
    }
  }

  if (assetIdSet.size === 0) return;

  // Fetch all URLs in parallel
  const assetIds = [...assetIdSet];
  const urlResults = await Promise.all(
    assetIds.map((id) => getAssetSignedUrl(config, userId, projectId, id)),
  );

  const urlMap = new Map<string, string>();
  for (let i = 0; i < assetIds.length; i++) {
    const url = urlResults[i];
    if (url) urlMap.set(assetIds[i], url);
  }

  logger.info(
    { total: assetIdSet.size, resolved: urlMap.size },
    'Resolved asset URLs',
  );

  // Apply URLs to clips
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if (clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') {
        if (clip.assetId && urlMap.has(clip.assetId)) {
          (clip as { src: string }).src = urlMap.get(clip.assetId)!;
        }
      }
      if (clip.type === 'video') {
        const v = clip as VideoClip;
        if (v.maskAssetId && urlMap.has(v.maskAssetId)) {
          v.maskSrc = urlMap.get(v.maskAssetId)!;
        }
      }
    }
  }
}

/**
 * Fetch all component files for a project from the asset service.
 * Returns a map of file path -> component source code.
 */
export async function fetchComponentFiles(
  config: RendererConfig,
  userId: string,
  projectId: string,
): Promise<Record<string, string>> {
  if (!config.assetServiceUrl) return {};

  const endpoint = `${config.assetServiceUrl.replace(/\/$/, '')}/api/assets/${userId}/${projectId}`;
  const headers = getAssetServiceHeaders(config);

  try {
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'Failed to list assets for component files',
      );
      return {};
    }

    const assets = (await response.json()) as Array<{
      type?: string;
      componentName?: string;
      code?: string;
    }>;

    const componentFiles: Record<string, string> = {};
    for (const asset of assets) {
      if (asset.type === 'component' && asset.componentName && asset.code) {
        componentFiles[`src/components/custom/${asset.componentName}.tsx`] = asset.code;
      }
    }

    logger.info(
      { count: Object.keys(componentFiles).length },
      'Fetched component files from asset service',
    );

    return componentFiles;
  } catch (err) {
    logger.warn({ err }, 'Error fetching component files from asset service');
    return {};
  }
}

/**
 * Fetch transcription data from asset pipeline metadata.
 * For each assetId, checks the pipeline for a completed transcription step
 * and extracts the segment data.
 */
export async function fetchTranscriptions(
  config: RendererConfig,
  userId: string,
  projectId: string,
  project: Project,
): Promise<Record<string, ProjectTranscription>> {
  if (!config.assetServiceUrl) return {};

  // Collect unique assetIds from all clips
  const assetIds = new Set<string>();
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if (clip.assetId) {
        assetIds.add(clip.assetId);
      }
    }
  }

  if (assetIds.size === 0) return {};

  const transcriptions: Record<string, ProjectTranscription> = {};
  const baseUrl = config.assetServiceUrl.replace(/\/$/, '');

  await Promise.all(
    [...assetIds].map(async (assetId) => {
      try {
        const endpoint = `${baseUrl}/api/pipeline/${userId}/${projectId}/${assetId}`;
        const headers = getAssetServiceHeaders(config);
        const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10000) });

        if (!response.ok) return;

        const pipelineState = (await response.json()) as {
          steps?: Array<{
            id: string;
            status: string;
            metadata?: Record<string, unknown>;
          }>;
        };

        const transcriptionStep = pipelineState.steps?.find(
          (s) => s.id === 'transcription' && s.status === 'succeeded',
        );

        if (!transcriptionStep?.metadata) return;

        const { segments } = transcriptionStep.metadata as {
          segments?: Array<{ start: number; speech: string }>;
        };

        if (!segments || segments.length === 0) return;

        transcriptions[assetId] = {
          assetId,
          assetName: assetId,
          assetUrl: '',
          segments,
          languageCodes: [],
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Asset may not have a pipeline or transcription — that's OK
      }
    }),
  );

  logger.info(
    { total: assetIds.size, found: Object.keys(transcriptions).length },
    'Fetched transcriptions from pipeline',
  );

  return transcriptions;
}
