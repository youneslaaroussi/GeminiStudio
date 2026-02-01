import type { Reference } from '@motion-canvas/core';
import type { Video, Node, Txt, Img } from '@motion-canvas/2d';

export interface Transform {
  x: number;
  y: number;
}

export interface Focus {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
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

export interface VideoClip {
  id: string;
  type: 'video';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
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

export interface CaptionSettings {
  fontFamily: string;
  fontWeight: number;
  distanceFromBottom: number;
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
}

export interface TextEntry {
  clip: TextClip;
  ref: Reference<Txt>;
}

export interface ImageEntry {
  clip: ImageClip;
  ref: Reference<Img>;
}

export interface AudioEntry {
  clip: AudioClip;
  ref: Reference<Video>;
}
