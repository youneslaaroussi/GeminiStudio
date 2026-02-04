import { Vector2, waitFor, easeInOutCubic, type ThreadGenerator } from '@motion-canvas/core';
import type { Node } from '@motion-canvas/2d';
import type { ClipAnimationType } from '../types';

const HOVER_CYCLE = 1.8;
const PULSE_CYCLE = 2.2;
const FLOAT_CYCLE = 2.5;
const GLOW_CYCLE = 1.6;

/** Clamp intensity to 0–5 (1 = normal, 5 = 5x) and default to 1. */
function normalizeIntensity(intensity: number | undefined): number {
  if (intensity == null || !Number.isFinite(intensity)) return 1;
  return Math.max(0, Math.min(5, intensity));
}

/**
 * Run one cycle of "hover" animation: subtle scale up and back.
 * @param intensity 0–5x, scales the effect (1 = 3% scale up, 5 = 15%).
 */
function* hoverCycle(node: Node, cycleDuration: number, intensity: number): ThreadGenerator {
  const base = node.scale();
  const up = base.mul(1 + 0.03 * intensity);
  const half = cycleDuration / 2;
  yield* node.scale(up, half, easeInOutCubic);
  yield* node.scale(base, half, easeInOutCubic);
}

/**
 * Run one cycle of "pulse" animation: scale in and out.
 * @param intensity 0–5x, scales the effect (1 = 6% scale up, 5 = 30%).
 */
function* pulseCycle(node: Node, cycleDuration: number, intensity: number): ThreadGenerator {
  const base = node.scale();
  const up = base.mul(1 + 0.06 * intensity);
  const half = cycleDuration / 2;
  yield* node.scale(up, half, easeInOutCubic);
  yield* node.scale(base, half, easeInOutCubic);
}

/**
 * Run one cycle of "float" animation: gentle vertical drift.
 * @param intensity 0–5x, scales drift amount (1 = 12px, 5 = 60px).
 */
function* floatCycle(node: Node, cycleDuration: number, intensity: number): ThreadGenerator {
  const base = node.position();
  const amount = 12 * intensity;
  const half = cycleDuration / 2;
  yield* node.position(base.add(new Vector2(0, -amount)), half, easeInOutCubic);
  yield* node.position(base, half, easeInOutCubic);
}

/**
 * Run one cycle of "glow" animation: opacity breathe.
 * @param intensity 0–5x, scales opacity range (1 = down to 88% of base).
 */
function* glowCycle(node: Node, cycleDuration: number, baseOpacity: number, intensity: number): ThreadGenerator {
  const low = baseOpacity * (1 - 0.12 * intensity);
  const half = cycleDuration / 2;
  yield* node.opacity(low, half, easeInOutCubic);
  yield* node.opacity(baseOpacity, half, easeInOutCubic);
}

/**
 * Apply clip idle animation for the given duration.
 * Runs in parallel with the clip's main visibility window (e.g. with waitFor(mainDuration)).
 * @param intensity 0–5x, scales the effect strength (default 1).
 */
export function* applyClipAnimation(
  node: Node,
  animation: ClipAnimationType | undefined,
  duration: number,
  intensity?: number
): ThreadGenerator {
  if (!node || !animation || animation === 'none' || duration <= 0) return;

  const i = normalizeIntensity(intensity);
  if (i <= 0) {
    yield* waitFor(duration);
    return;
  }

  let elapsed = 0;
  const baseOpacity = node.opacity();

  while (elapsed < duration) {
    const cycleDuration =
      animation === 'hover'
        ? HOVER_CYCLE
        : animation === 'pulse'
          ? PULSE_CYCLE
          : animation === 'float'
            ? FLOAT_CYCLE
            : GLOW_CYCLE;
    const remaining = duration - elapsed;
    const cycle = Math.min(cycleDuration, remaining);

    switch (animation) {
      case 'hover':
        yield* hoverCycle(node, cycle, i);
        break;
      case 'pulse':
        yield* pulseCycle(node, cycle, i);
        break;
      case 'float':
        yield* floatCycle(node, cycle, i);
        break;
      case 'glow':
        yield* glowCycle(node, cycle, baseOpacity, i);
        break;
      default:
        yield* waitFor(cycle);
    }
    elapsed += cycle;
  }

  // Reset to base state so exit transition starts from expected values
  const baseScale = node.scale();
  const basePos = node.position();
  node.scale(baseScale);
  node.position(basePos);
  node.opacity(baseOpacity);
}
