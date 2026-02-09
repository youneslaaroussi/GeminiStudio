import type {
  ClipType,
  Layer,
  Project,
  TimelineClip,
} from "@/app/types/timeline";

/**
 * Timeline auto-correction: detects and fixes invalid timeline state.
 * Designed to be extensible - add new correction rules as needed.
 */

type CorrectionRule = (project: Project) => Project;

function createLayer(type: ClipType, name?: string): Layer {
  return {
    id: crypto.randomUUID(),
    name: name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} Layer`,
    type,
    clips: [],
    hidden: false,
  };
}

/**
 * Rule: clips must be in a layer that matches their type.
 * If an image is in a video layer (or video in image layer, component in text layer, etc.),
 * move it to the correct layer (creating one if needed). Handles all clip types including component.
 */
function correctClipLayerMismatch(project: Project): Project {
  const layers = project.layers ?? [];
  if (layers.length === 0) return project;

  // 1. For each layer, split clips into correct (type matches) and misplaced (type differs)
  const misplacedByType = new Map<ClipType, TimelineClip[]>();
  let hasAnyMisplaced = false;

  const updatedLayers = layers.map((layer) => {
    if (!layer?.clips) return layer;
    const correct: TimelineClip[] = [];
    for (const clip of layer.clips) {
      if (!clip) continue;
      if (clip.type === layer.type) {
        correct.push(clip);
      } else {
        hasAnyMisplaced = true;
        const list = misplacedByType.get(clip.type as ClipType) ?? [];
        list.push(clip);
        misplacedByType.set(clip.type as ClipType, list);
      }
    }
    return { ...layer, clips: correct };
  });

  if (!hasAnyMisplaced) return project;

  // 2. For each clip type with misplaced clips, find or create a layer and add them
  const layerByType = new Map<ClipType, Layer>();
  for (const layer of updatedLayers) {
    if (layer && !layerByType.has(layer.type)) {
      layerByType.set(layer.type, layer);
    }
  }

  for (const [clipType, clips] of misplacedByType) {
    let targetLayer = layerByType.get(clipType);
    if (!targetLayer) {
      targetLayer = createLayer(clipType);
      layerByType.set(clipType, targetLayer);
      updatedLayers.push(targetLayer);
    }
    targetLayer.clips = [...targetLayer.clips, ...clips];
  }

  return { ...project, layers: updatedLayers };
}

const RULES: CorrectionRule[] = [
  correctClipLayerMismatch,
  // Add more rules here as needed, e.g.:
  // removeDuplicateClipIds,
  // fixInvalidTransitions,
];

/**
 * Applies all timeline auto-correction rules to a project.
 * Call this whenever project state is loaded or updated.
 */
export function correctTimeline(project: Project): Project {
  console.log('[AUTO-CORRECT] Running timeline correction');
  let result = project;
  for (const rule of RULES) {
    result = rule(result);
  }
  const changed = result !== project;
  if (changed) {
    console.log('[AUTO-CORRECT] Corrections applied');
  }
  return result;
}
