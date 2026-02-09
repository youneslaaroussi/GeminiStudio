/**
 * Scene correction library.
 * Sanitizes scene data before rendering to fix values that break Motion Canvas.
 */

import type { SceneData } from './steps';
import { filterInvalidColors } from './steps';

export type { SceneData } from './steps';
export { filterInvalidColors } from './steps';

export type CorrectionStep = (data: SceneData) => SceneData;

const STEPS: CorrectionStep[] = [
  filterInvalidColors,
  // Add more correction steps here as needed.
];

/**
 * Applies all correction steps to scene data.
 * Run this before passing layers/variables to the timeline.
 */
export function correctSceneData(data: SceneData): SceneData {
  let result = data;
  for (const step of STEPS) {
    result = step(result);
  }
  return result;
}

/**
 * Corrects only the layers array. Use when you have layers and want to
 * return corrected layers (e.g. for use in nle_timeline).
 */
export function correctLayers<T>(layers: T[]): T[] {
  const corrected = correctSceneData({ layers: layers as SceneData['layers'] });
  return (corrected.layers ?? layers) as T[];
}
