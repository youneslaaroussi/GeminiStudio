import { Node } from '@motion-canvas/2d';
import { createRef, waitFor, all, spawn, type ThreadGenerator } from '@motion-canvas/core';
import type { ComponentClip, ComponentEntry } from '../types';
import { applyEnterTransition, applyExitTransition, getTransitionAdjustedTiming } from './transitions';
import { applyClipAnimation } from './animations';

/**
 * Registry of custom component classes.
 * Components are registered at build time by the generated imports in nle_timeline.
 */
const componentRegistry = new Map<string, new (props?: Record<string, unknown>) => Node>();

/** Register a custom component class so it can be instantiated by name. */
export function registerComponent(name: string, cls: new (props?: Record<string, unknown>) => Node) {
  componentRegistry.set(name, cls);
}

interface CreateComponentElementsOptions {
  clips: ComponentClip[];
  view: Node;
}

export function createComponentElements({ clips, view }: CreateComponentElementsOptions): ComponentEntry[] {
  const entries: ComponentEntry[] = [];

  for (const clip of clips) {
    const ComponentClass = componentRegistry.get(clip.componentName);
    if (!ComponentClass) {
      console.warn(`[component] Unknown component "${clip.componentName}" for clip ${clip.id}, skipping`);
      continue;
    }

    try {
      const ref = createRef<Node>();

      // Build props from inputs + standard positioning.
      // Note: don't pass `ref` as a prop -- MC's JSX factory handles refs,
      // but direct construction via `new` does not. We set it manually below.
      const props: Record<string, unknown> = {
        ...clip.inputs,
        key: `component-clip-${clip.id}`,
        x: clip.position.x,
        y: clip.position.y,
        scale: clip.scale,
        opacity: 0,
      };

      const instance = new ComponentClass(props);

      // Manually bind the ref (JSX would do this, but we're constructing directly)
      ref(instance);

      view.add(instance);

      entries.push({ clip, ref });
    } catch (err) {
      console.error(`[component] Failed to create "${clip.componentName}" for clip ${clip.id}:`, err);
    }
  }

  return entries;
}

interface PlayComponentOptions {
  entry: ComponentEntry;
  sceneWidth: number;
  sceneHeight: number;
}

export function* playComponent({ entry, sceneWidth, sceneHeight }: PlayComponentOptions): ThreadGenerator {
  const { clip, ref } = entry;

  const timing = getTransitionAdjustedTiming(
    clip.start,
    clip.duration,
    clip.speed ?? 1,
    clip.enterTransition,
    clip.exitTransition,
  );

  if (timing.startAt > 0) {
    yield* waitFor(timing.startAt);
  }

  const node = ref();
  if (!node) return;

  // Enter transition
  yield* applyEnterTransition(node, clip.enterTransition, 1, sceneWidth, sceneHeight);

  // Main duration: show the component for at least the full clip duration. Run animate(duration) in
  // parallel with a wait for mainDuration — we wait for BOTH so we never end before the clip
  // (padding when animate is shorter) and we don't cut animate short when it runs longer.
  const instance = node as unknown as Record<string, (d?: number) => ThreadGenerator | undefined>;
  const animateMethod = instance.animate;
  const hasAnimate = typeof animateMethod === 'function';
  const durationArg = timing.mainDuration > 0 ? timing.mainDuration : undefined;
  const mainDuration = timing.mainDuration > 0 ? timing.mainDuration : 0;

  if (mainDuration > 0) {
    const waitMain = waitFor(mainDuration);
    const animPart = hasAnimate
      ? (function* () {
          const gen = animateMethod.call(instance, durationArg);
          if (gen) yield* spawn(gen);
        })()
      : waitFor(0);

    if (clip.animation && clip.animation !== 'none') {
      yield* all(
        waitMain,
        animPart,
        applyClipAnimation(node, clip.animation, mainDuration, clip.animationIntensity),
      );
    } else {
      yield* all(waitMain, animPart);
    }
  }

  // Exit transition
  yield* applyExitTransition(node, clip.exitTransition, sceneWidth, sceneHeight);
}
