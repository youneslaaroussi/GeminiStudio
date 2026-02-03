import { createSignal, type SimpleSignal } from '@motion-canvas/core';
import type { VisualEffectType, ColorGradingSettings, ChromaKeySettings } from './types';
import glitchShader from '../shaders/glitch.glsl';
import waveDistortionShader from '../shaders/waveDistortion.glsl';
import vhsEffectShader from '../shaders/vhsEffect.glsl';
import pixelateShader from '../shaders/pixelate.glsl';
import chromaticAberrationShader from '../shaders/chromaticAberration.glsl';
import colorGradingShader from '../shaders/colorGrading.glsl';
import chromaKeyShader from '../shaders/chromaKey.glsl';

export type EffectShaderConfig = {
  fragment: string;
  uniforms: Record<string, SimpleSignal<number>>;
};

export type ColorGradingShaderConfig = {
  fragment: string;
  uniforms: {
    exposure: SimpleSignal<number>;
    contrast: SimpleSignal<number>;
    saturation: SimpleSignal<number>;
    temperature: SimpleSignal<number>;
    tint: SimpleSignal<number>;
    highlights: SimpleSignal<number>;
    shadows: SimpleSignal<number>;
  };
};

/**
 * Returns shader config for color grading, or undefined if settings are all default.
 */
export function getColorGradingShaderConfig(
  settings: ColorGradingSettings | undefined
): ColorGradingShaderConfig | undefined {
  if (!settings) return undefined;

  // Check if all values are at default (0)
  const isDefault =
    settings.exposure === 0 &&
    settings.contrast === 0 &&
    settings.saturation === 0 &&
    settings.temperature === 0 &&
    settings.tint === 0 &&
    settings.highlights === 0 &&
    settings.shadows === 0;

  if (isDefault) return undefined;

  return {
    fragment: colorGradingShader,
    uniforms: {
      // Exposure stays as-is (-2 to 2)
      exposure: createSignal(settings.exposure),
      // Convert -100 to 100 -> -1 to 1
      contrast: createSignal(settings.contrast / 100),
      // Convert -100 to 100 -> 0 to 2 (with 0 = 1)
      saturation: createSignal(1 + settings.saturation / 100),
      // Convert -100 to 100 -> -1 to 1
      temperature: createSignal(settings.temperature / 100),
      tint: createSignal(settings.tint / 100),
      highlights: createSignal(settings.highlights / 100),
      shadows: createSignal(settings.shadows / 100),
    },
  };
}

/**
 * Returns shader config for a visual effect, or undefined if none.
 * Each call creates new signals so every clip gets its own uniforms.
 */
export function getEffectShaderConfig(
  effect: VisualEffectType | undefined
): EffectShaderConfig | undefined {
  if (!effect || effect === 'none') return undefined;

  switch (effect) {
    case 'glitch':
      return {
        fragment: glitchShader,
        uniforms: { intensity: createSignal(0.6) },
      };
    case 'ripple':
      return {
        fragment: waveDistortionShader,
        uniforms: {
          amplitude: createSignal(0.03),
          frequency: createSignal(10),
          speed: createSignal(2),
        },
      };
    case 'vhs':
      return {
        fragment: vhsEffectShader,
        uniforms: { intensity: createSignal(0.6) },
      };
    case 'pixelate':
      return {
        fragment: pixelateShader,
        uniforms: { pixelSize: createSignal(25) },
      };
    case 'chromatic':
      return {
        fragment: chromaticAberrationShader,
        uniforms: {
          amount: createSignal(0.5),
          directionX: createSignal(1),
          directionY: createSignal(0.5),
        },
      };
    default:
      return undefined;
  }
}

/** Parse hex color "#rrggbb" or "#rgb" to 0–1 RGB. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace(/^#/, '');
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16) / 255,
      g: parseInt(s.slice(2, 4), 16) / 255,
      b: parseInt(s.slice(4, 6), 16) / 255,
    };
  }
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16) / 255,
      g: parseInt(s[1] + s[1], 16) / 255,
      b: parseInt(s[2] + s[2], 16) / 255,
    };
  }
  return { r: 0, g: 1, b: 0 }; // default green
}

export type ChromaKeyShaderConfig = {
  fragment: string;
  uniforms: Record<string, SimpleSignal<number>>;
};

/**
 * Returns shader config for chroma key (green screen) when clip has chromaKey settings.
 * Key color is parsed from hex; threshold and smoothness are 0–1.
 */
export function getChromaKeyShaderConfig(
  settings: ChromaKeySettings | undefined
): ChromaKeyShaderConfig | undefined {
  if (!settings?.color) return undefined;
  const { r, g, b } = hexToRgb(settings.color);
  const threshold = Math.max(0, Math.min(1, settings.threshold ?? 0.4));
  const smoothness = Math.max(0, Math.min(1, settings.smoothness ?? 0.1));
  return {
    fragment: chromaKeyShader,
    uniforms: {
      keyR: createSignal(r),
      keyG: createSignal(g),
      keyB: createSignal(b),
      threshold: createSignal(threshold),
      smoothness: createSignal(smoothness),
    },
  };
}
