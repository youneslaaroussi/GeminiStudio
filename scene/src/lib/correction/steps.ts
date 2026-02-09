/**
 * Scene correction steps.
 * Each step receives scene data and returns a corrected copy.
 * Steps are designed to be composable and run in sequence.
 */

/** Color values that break Motion Canvas rendering (e.g. fill, backgroundColor). */
const INVALID_COLOR_VALUES = new Set([
  'transparent',
  'none',
  'inherit',
  'initial',
  'unset',
  'currentcolor',
  'currentColor',
]);

/** Keys that are expected to hold color values (hex, rgba, etc.). */
const COLOR_KEYS = new Set([
  'fill',
  'backgroundColor',
  'background',
  'color',
  'barColor',
  'labelColor',
  'formulaColor',
]);

function isColorKey(key: string): boolean {
  return COLOR_KEYS.has(key) || key.endsWith('Color');
}

function isInvalidColorValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '' || INVALID_COLOR_VALUES.has(normalized);
}

/**
 * Recursively remove or replace invalid color values in an object.
 * Invalid values (e.g. "transparent") are removed so defaults apply.
 */
function sanitizeColorsInObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeColorsInObject);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isColorKey(key) && isInvalidColorValue(value)) {
      // Omit invalid color - caller's default will apply
      continue;
    }
    result[key] = sanitizeColorsInObject(value);
  }
  return result;
}

export type SceneData = {
  layers?: Array<{
    id?: string;
    name?: string;
    type?: string;
    clips?: unknown[];
    [key: string]: unknown;
  }>;
  duration?: number;
  transcriptions?: Record<string, unknown>;
  transitions?: Record<string, unknown>;
  sceneConfig?: {
    resolution?: { width?: number; height?: number };
    renderScale?: number;
    background?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Step: Filter out invalid color values (transparent, none, etc.) that break
 * Motion Canvas rendering. Removes the property so the component's default applies.
 */
export function filterInvalidColors(data: SceneData): SceneData {
  return sanitizeColorsInObject(data) as SceneData;
}
