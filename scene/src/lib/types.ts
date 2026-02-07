import type { Reference } from '@motion-canvas/core';
import type { Video, Node, Txt, Img, Rect } from '@motion-canvas/2d';

export interface Transform {
  x: number;
  y: number;
}

/** Focus/zoom region: center (0–1) and zoom ratio (1 = full frame, 2 = 2x zoom). */
export interface Focus {
  x: number;  // center X, 0–1
  y: number;  // center Y, 0–1
  zoom: number;  // 1 = full frame, >1 = zoom in
}

export type MaskMode = 'include' | 'exclude';

/** Visual effect applied to a clip (glitch, ripple, etc.) */
export type VisualEffectType =
  | 'none'
  | 'glitch'
  | 'ripple'
  | 'vhs'
  | 'pixelate'
  | 'chromatic';

/** Idle animation applied while a clip is visible (hover-style scale, pulse, float, glow, zoom) */
export type ClipAnimationType =
  | 'none'
  | 'hover'    // Subtle scale up and back
  | 'pulse'    // Scale in/out
  | 'float'    // Gentle vertical drift
  | 'glow'     // Opacity breathe
  | 'zoom-in'  // Start at 1, zoom in over duration (speed by intensity)
  | 'zoom-out'; // Start at scaled up, zoom out to 1 over duration (speed by intensity)

/** Text template styles */
export type TextTemplateType =
  | 'text'           // Basic text (default)
  | 'title-card'     // Full screen with background
  | 'lower-third'    // Bar at bottom of screen
  | 'caption-style'; // Floating pill/card

/** Color grading settings for video/image clips */
export interface ColorGradingSettings {
  exposure: number;      // -2 to 2
  contrast: number;      // -100 to 100
  saturation: number;    // -100 to 100
  temperature: number;   // -100 to 100
  tint: number;          // -100 to 100
  highlights: number;    // -100 to 100
  shadows: number;       // -100 to 100
}

/** Chroma key (green screen) settings: key color and tolerance */
export interface ChromaKeySettings {
  /** Key color as hex, e.g. "#00ff00" for green */
  color: string;
  /** Tolerance 0–1: how much color match to key (higher = more pixels transparent) */
  threshold: number;
  /** Edge softness 0–1 (optional, default 0.1) */
  smoothness?: number;
}

export interface VideoClip {
  id: string;
  type: 'video';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  /** Source video width in pixels (from asset metadata) */
  width?: number;
  /** Source video height in pixels (from asset metadata) */
  height?: number;
  position: Transform;
  scale: Transform;
  focus?: Focus;
  objectFit?: 'contain' | 'cover' | 'fill';
  assetId?: string;
  maskAssetId?: string;
  maskSrc?: string;
  maskMode?: MaskMode;
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key (green screen): key color and threshold to make that color transparent */
  chromaKey?: ChromaKeySettings;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
  /** Audio volume 0–1 (1 = full). Default 1. */
  audioVolume?: number;
}

export interface AudioClip {
  id: string;
  type: 'audio';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  volume: number;
  position: Transform;
  scale: Transform;
  assetId?: string;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
}

export interface TextClip {
  id: string;
  type: 'text';
  text: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  fontSize?: number;
  fill?: string;
  opacity?: number;
  position: Transform;
  scale: Transform;
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Template style for text rendering */
  template?: TextTemplateType;
  /** Subtitle text (for title-card template) */
  subtitle?: string;
  /** Background color (for templates with backgrounds) */
  backgroundColor?: string;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export interface ImageClip {
  id: string;
  type: 'image';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  width?: number;
  height?: number;
  position: Transform;
  scale: Transform;
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key (green screen) for image clips */
  chromaKey?: ChromaKeySettings;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export interface ClipTransition {
  type: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'cross-dissolve' | 'zoom' | 'blur' | 'dip-to-black';
  duration: number;
}

export type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

export interface Layer {
  id: string;
  name: string;
  type: TimelineClip['type'];
  clips: TimelineClip[];
}

export interface RawSegment {
  start?: number;
  speech?: string;
  text?: string;
  startTime?: string;
}

export interface SceneTranscription {
  assetId: string;
  assetUrl: string;
  segments?: RawSegment[];
}

/** Caption visual style (pill, karaoke highlights, TikTok-style outlined, etc.) */
export type CaptionStyleType =
  | 'pill'           // Dark pill, white/dim karaoke (default)
  | 'karaoke-lime'   // White text, lime green highlight, black outline
  | 'karaoke-magenta'// Magenta/pink highlight, outline
  | 'karaoke-cyan'   // Cyan highlight, outline
  | 'outlined'       // No pill, white text, thick black outline (TikTok)
  | 'bold-outline'   // Thick outline, bright fill
  | 'minimal'        // Light shadow, no box
  | 'word-highlight' // Background pill under current spoken word only
  | 'pink-pill'      // Bright pink rectangular background under current word
  | 'dark-pill-lime' // Dark grey rounded pill with lime green current word
  | 'cloud-blob';    // Cloud-like blob background under current word

export interface CaptionSettings {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  distanceFromBottom: number;
  style?: CaptionStyleType;
}

export interface TextClipSettings {
  fontFamily: string;
  fontWeight: number;
  defaultFontSize: number;
  defaultFill: string;
}

// Refs for each clip type
export interface VideoEntry {
  clip: VideoClip;
  ref: Reference<Video>;
  maskRef?: Reference<Video>;
  containerRef?: Reference<Node>;
  /** Clipping container for focus/zoom (video scales inside, container clips at scene bounds) */
  focusContainerRef?: Reference<Rect>;
}

export interface TextEntry {
  clip: TextClip;
  ref: Reference<Txt>;
  containerRef?: Reference<Node> | Reference<Rect>;
}

export interface ImageEntry {
  clip: ImageClip;
  ref: Reference<Img>;
}

export interface AudioEntry {
  clip: AudioClip;
  ref: Reference<Video>;
}
