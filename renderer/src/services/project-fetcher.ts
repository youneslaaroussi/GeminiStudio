/**
 * Project fetcher — orchestrates all data fetching for a render job.
 *
 * Given a userId, projectId, and branchId, this module:
 * 1. Fetches and decodes the project from Firebase RTDB (Automerge)
 * 2. Resolves all asset clip URLs via the asset service
 * 3. Fetches custom component source files
 * 4. Fetches transcription data from asset pipelines
 * 5. Calculates timeline duration
 *
 * This replaces the duplicate data-gathering logic previously in the app and langgraph server.
 */

import { logger } from '../logger.js';
import type { RendererConfig } from '../config.js';
import type { Project, Layer } from '../types/index.js';
import type { ProjectTranscription } from '../types/transcription.js';
import { fetchBranchProject } from './firebase-client.js';
import {
  resolveClipUrls,
  fetchComponentFiles,
  fetchTranscriptions,
} from './asset-resolver.js';

export interface FetchedRenderData {
  /** The full project with resolved asset URLs and transcriptions. */
  project: Project;
  /** Custom component source files for the scene compiler. */
  componentFiles: Record<string, string>;
  /** Timeline duration computed from layers. */
  timelineDuration: number;
}

/**
 * Compute total timeline duration from layers.
 */
function computeTimelineDuration(layers: Layer[]): number {
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
}

/**
 * Fetch all data needed to render a project.
 *
 * @param config - Renderer configuration
 * @param userId - Project owner user ID (trusted, verified by caller)
 * @param projectId - Project ID
 * @param branchId - Branch ID (e.g. "main")
 * @returns All data needed for rendering
 */
export async function fetchRenderData(
  config: RendererConfig,
  userId: string,
  projectId: string,
  branchId: string,
): Promise<FetchedRenderData> {
  logger.info({ userId, projectId, branchId }, 'Fetching render data');

  // Step 1: Fetch and decode project from Firebase
  const project = await fetchBranchProject(config, userId, projectId, branchId);

  // Step 2 & 3 can run in parallel: resolve URLs + fetch component files
  const [, componentFiles] = await Promise.all([
    resolveClipUrls(config, userId, projectId, project),
    fetchComponentFiles(config, userId, projectId),
  ]);

  // Step 4: Fetch transcriptions (needs resolved project)
  const transcriptions = await fetchTranscriptions(config, userId, projectId, project);

  // Apply transcriptions to project
  project.transcriptions = {
    ...(project.transcriptions ?? {}),
    ...transcriptions,
  };

  // Step 5: Compute timeline duration
  const timelineDuration = computeTimelineDuration(project.layers);

  logger.info(
    {
      userId,
      projectId,
      branchId,
      projectName: project.name,
      layers: project.layers.length,
      timelineDuration,
      componentFiles: Object.keys(componentFiles).length,
      transcriptions: Object.keys(transcriptions).length,
    },
    'Render data fetched successfully',
  );

  return {
    project,
    componentFiles,
    timelineDuration,
  };
}
