import { Img, Node } from '@motion-canvas/2d';
import { createRef, waitFor, type ThreadGenerator } from '@motion-canvas/core';
import type { ImageClip, ImageEntry } from '../types';
import { getEffectShaderConfig, getColorGradingShaderConfig, getChromaKeyShaderConfig } from '../effectShaders';
import { applyEnterTransition, applyExitTransition, getTransitionAdjustedTiming } from './transitions';

interface CreateImageElementsOptions {
  clips: ImageClip[];
  view: Node;
}

export function createImageElements({ clips, view }: CreateImageElementsOptions): ImageEntry[] {
  const entries: ImageEntry[] = [];

  for (const clip of clips) {
    const ref = createRef<Img>();
    const imgWidth = clip.width ?? 1920;
    const imgHeight = clip.height ?? 1080;
    const effectShaders = getChromaKeyShaderConfig(clip.chromaKey) ?? getEffectShaderConfig(clip.effect);
    const colorGradingConfig = getColorGradingShaderConfig(clip.colorGrading);

    entries.push({ clip, ref });

    const imageElement = (
      <Img
        key={`image-clip-${clip.id}`}
        ref={ref}
        src={clip.src}
        width={imgWidth}
        height={imgHeight}
        x={clip.position.x}
        y={clip.position.y}
        scale={clip.scale}
        opacity={0}
        shaders={effectShaders}
      />
    );

    // Wrap in color grading node if needed
    if (colorGradingConfig) {
      view.add(
        <Node
          key={`color-grading-${clip.id}`}
          cache
          shaders={{
            fragment: colorGradingConfig.fragment,
            uniforms: colorGradingConfig.uniforms,
          }}
        >
          {imageElement}
        </Node>
      );
    } else {
      view.add(imageElement);
    }
  }

  return entries;
}

interface PlayImageOptions {
  entry: ImageEntry;
  sceneWidth: number;
  sceneHeight: number;
}

export function* playImage({ entry, sceneWidth, sceneHeight }: PlayImageOptions): ThreadGenerator {
  const { clip, ref } = entry;

  const timing = getTransitionAdjustedTiming(
    clip.start,
    clip.duration,
    clip.speed ?? 1,
    clip.enterTransition,
    clip.exitTransition
  );

  if (timing.startAt > 0) {
    yield* waitFor(timing.startAt);
  }

  const image = ref();
  if (!image) return;

  // Enter transition
  yield* applyEnterTransition(image, clip.enterTransition, 1, sceneWidth, sceneHeight);

  // Main duration
  if (timing.mainDuration > 0) {
    yield* waitFor(timing.mainDuration);
  }

  // Exit transition
  yield* applyExitTransition(image, clip.exitTransition, sceneWidth, sceneHeight);
}
