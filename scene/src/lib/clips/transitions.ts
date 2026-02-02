import { Vector2, easeOutCubic, easeInCubic, type ThreadGenerator } from '@motion-canvas/core';
import type { Node } from '@motion-canvas/2d';
import type { ClipTransition } from '../types';

/**
 * Apply enter transition to a node
 */
export function* applyEnterTransition(
  node: Node,
  transition: ClipTransition | undefined,
  targetOpacity: number,
  sceneWidth: number,
  sceneHeight: number
): ThreadGenerator {
  if (!transition || transition.type === 'none') {
    node.opacity(targetOpacity);
    return;
  }

  const initialPos = node.position();
  const initialScale = node.scale();
  const duration = transition.duration;

  switch (transition.type) {
    case 'fade':
    case 'dip-to-black':
      node.opacity(0);
      yield* node.opacity(targetOpacity, duration, easeOutCubic);
      break;

    case 'zoom':
      node.opacity(0);
      node.scale(initialScale.mul(0.3));
      yield* node.opacity(targetOpacity, duration * 0.3);
      yield* node.scale(initialScale, duration, easeOutCubic);
      break;

    case 'slide-left':
      node.opacity(targetOpacity);
      node.position(new Vector2(initialPos.x + sceneWidth, initialPos.y));
      yield* node.position(initialPos, duration, easeOutCubic);
      break;

    case 'slide-right':
      node.opacity(targetOpacity);
      node.position(new Vector2(initialPos.x - sceneWidth, initialPos.y));
      yield* node.position(initialPos, duration, easeOutCubic);
      break;

    case 'slide-up':
      node.opacity(targetOpacity);
      node.position(new Vector2(initialPos.x, initialPos.y + sceneHeight));
      yield* node.position(initialPos, duration, easeOutCubic);
      break;

    case 'slide-down':
      node.opacity(targetOpacity);
      node.position(new Vector2(initialPos.x, initialPos.y - sceneHeight));
      yield* node.position(initialPos, duration, easeOutCubic);
      break;

    default:
      node.opacity(targetOpacity);
  }
}

/**
 * Apply exit transition to a node
 */
export function* applyExitTransition(
  node: Node,
  transition: ClipTransition | undefined,
  sceneWidth: number,
  sceneHeight: number
): ThreadGenerator {
  if (!transition || transition.type === 'none') {
    node.opacity(0);
    return;
  }

  const currentPos = node.position();
  const currentScale = node.scale();
  const duration = transition.duration;

  switch (transition.type) {
    case 'fade':
    case 'dip-to-black':
      yield* node.opacity(0, duration, easeInCubic);
      break;

    case 'zoom':
      yield* node.scale(currentScale.mul(1.8), duration, easeInCubic);
      yield* node.opacity(0, duration * 0.7, easeInCubic);
      break;

    case 'slide-left':
      yield* node.position(new Vector2(currentPos.x - sceneWidth, currentPos.y), duration, easeInCubic);
      node.opacity(0);
      break;

    case 'slide-right':
      yield* node.position(new Vector2(currentPos.x + sceneWidth, currentPos.y), duration, easeInCubic);
      node.opacity(0);
      break;

    case 'slide-up':
      yield* node.position(new Vector2(currentPos.x, currentPos.y - sceneHeight), duration, easeInCubic);
      node.opacity(0);
      break;

    case 'slide-down':
      yield* node.position(new Vector2(currentPos.x, currentPos.y + sceneHeight), duration, easeInCubic);
      node.opacity(0);
      break;

    default:
      node.opacity(0);
  }
}

/**
 * Calculate adjusted timing for clips with transitions
 */
export function getTransitionAdjustedTiming(
  start: number,
  duration: number,
  speed: number,
  enterTransition?: ClipTransition,
  exitTransition?: ClipTransition
) {
  const safeSpeed = Math.max(speed, 0.0001);
  const enterDuration = enterTransition?.duration ?? 0;
  const exitDuration = exitTransition?.duration ?? 0;
  const timelineDuration = duration / safeSpeed;

  return {
    startAt: Math.max(start, 0),
    enterDuration,
    mainDuration: Math.max(0, timelineDuration - enterDuration - exitDuration),
    exitDuration,
    totalDuration: timelineDuration,
  };
}
