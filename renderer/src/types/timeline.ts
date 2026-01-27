export type ClipType = 'video' | 'audio' | 'text' | 'image';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down';

export interface CaptionSettings {
  fontFamily: 'Inter Variable' | 'Roboto' | 'Montserrat' | 'Poppins';
  fontWeight: 400 | 500 | 700;
  distanceFromBottom: number;
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

export interface Focus {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
}

export type ObjectFit = 'contain' | 'cover' | 'fill';

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
}

export interface VideoClip extends BaseClip {
  type: 'video';
  src: string;
  width?: number;
  height?: number;
  focus?: Focus;
  objectFit?: ObjectFit;
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
}

export interface ImageClip extends BaseClip {
  type: 'image';
  src: string;
  width?: number;
  height?: number;
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
}
