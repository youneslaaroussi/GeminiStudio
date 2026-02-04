export type ClipType = 'video' | 'audio' | 'text' | 'image';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down';

export type CaptionStyleType =
  | 'pill'
  | 'karaoke-lime'
  | 'karaoke-magenta'
  | 'karaoke-cyan'
  | 'outlined'
  | 'bold-outline'
  | 'minimal'
  | 'word-highlight'
  | 'pink-pill'
  | 'dark-pill-lime'
  | 'cloud-blob';

export interface CaptionSettings {
  fontFamily: 'Inter Variable' | 'Roboto' | 'Montserrat' | 'Poppins';
  fontWeight: 400 | 500 | 700;
  fontSize: number; // base font size (scaled by resolution)
  distanceFromBottom: number; // pixels from bottom
  style?: CaptionStyleType;
}

export interface TextClipSettings {
  fontFamily: CaptionSettings['fontFamily'];
  fontWeight: CaptionSettings['fontWeight'];
  defaultFontSize: number;
  defaultFill: string;
}

export interface ClipTransition {
  type: TransitionType;
  duration: number;
}

export type TransitionKey = `${string}->${string}`;

export interface Vec2 {
  x: number;
  y: number;
}

/** Focus/zoom: center (0–1) and zoom ratio (1 = full frame, >1 = zoom in). */
export interface Focus {
  x: number;
  y: number;
  zoom: number;
}

export type ObjectFit = 'contain' | 'cover' | 'fill';

/** Color grading settings for video/image clips */
export interface ColorGradingSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
}

/** Chroma key (green screen) settings */
export interface ChromaKeySettings {
  color: string;
  threshold: number;
  smoothness?: number;
}

/** Visual effect applied to a clip (glitch, ripple, etc.) */
export type VisualEffectType =
  | 'none'
  | 'glitch'
  | 'ripple'
  | 'vhs'
  | 'pixelate'
  | 'chromatic';

/** Idle animation while a clip is visible (hover-style scale, pulse, float, glow) */
export type ClipAnimationType =
  | 'none'
  | 'hover'
  | 'pulse'
  | 'float'
  | 'glow';

/** Text template styles */
export type TextTemplateType =
  | 'text'           // Basic text (default)
  | 'title-card'     // Full screen with background
  | 'lower-third'    // Bar at bottom of screen
  | 'caption-style'; // Floating pill/card

export interface BaseClip {
  id: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  position: Vec2;
  scale: Vec2;
  assetId?: string;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
}

export type MaskMode = 'include' | 'exclude';

export interface VideoClip extends BaseClip {
  type: 'video';
  src: string;
  width?: number;
  height?: number;
  focus?: Focus;
  objectFit?: ObjectFit;
  // Mask compositing properties
  maskAssetId?: string;   // Reference to mask asset (binary video)
  maskSrc?: string;       // Resolved URL for mask video
  maskMode?: MaskMode;    // 'include' = source-in, 'exclude' = source-out
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key (green screen) */
  chromaKey?: ChromaKeySettings;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export interface AudioClip extends BaseClip {
  type: 'audio';
  src: string;
  volume: number;
}

export interface TextClip extends BaseClip {
  type: 'text';
  text: string;
  fontSize?: number;
  fill?: string;
  opacity?: number;
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Template style for text rendering */
  template?: TextTemplateType;
  /** Subtitle text (for title-card template) */
  subtitle?: string;
  /** Background color (for templates with backgrounds) */
  backgroundColor?: string;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export interface ImageClip extends BaseClip {
  type: 'image';
  src: string;
  width?: number;
  height?: number;
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key for image clips */
  chromaKey?: ChromaKeySettings;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

export interface Layer {
  id: string;
  name: string;
  type: ClipType;
  clips: TimelineClip[];
}

export interface ProjectResolution {
  width: number;
  height: number;
}

import type { ProjectTranscription } from './transcription.js';

export interface Project {
  name: string;
  resolution: ProjectResolution;
  fps: number;
  layers: Layer[];
  renderScale: number;
  background: string;
  transcriptions?: Record<string, ProjectTranscription>;
  transitions?: Record<TransitionKey, ClipTransition>;
  captionSettings?: CaptionSettings;
  textClipSettings?: TextClipSettings;
}
