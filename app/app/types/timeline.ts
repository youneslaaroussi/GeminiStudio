import type { AssistantChatSession } from "./chat";
import type { ProjectTranscription } from "./transcription";

// Timeline clip types for NLE editor

export type ClipType = 'video' | 'audio' | 'text' | 'image';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'cross-dissolve'
  | 'zoom'
  | 'blur'
  | 'dip-to-black';

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

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  fontFamily: 'Inter Variable',
  fontWeight: 400,
  fontSize: 18,
  distanceFromBottom: 140,
  style: 'pill',
};

/** Project-level defaults for text clips (font etc.). Reuses same font options as captions. */
export interface TextClipSettings {
  fontFamily: CaptionSettings['fontFamily'];
  fontWeight: CaptionSettings['fontWeight'];
  defaultFontSize: number;
  defaultFill: string;
}

export const DEFAULT_TEXT_CLIP_SETTINGS: TextClipSettings = {
  fontFamily: 'Inter Variable',
  fontWeight: 400,
  defaultFontSize: 48,
  defaultFill: '#ffffff',
};

export interface ClipTransition {
  type: TransitionType;
  duration: number;
}

export type TransitionKey = `${string}->${string}`;

export const DEFAULT_TRANSITION: ClipTransition = {
  type: 'fade',
  duration: 0.5,
};

export const makeTransitionKey = (fromId: string, toId: string): TransitionKey =>
  `${fromId}->${toId}`;

export const parseTransitionKey = (key: string) => {
  const [fromId = '', toId = ''] = key.split('->');
  return { fromId, toId };
};

export interface Vec2 {
  x: number;
  y: number;
}

/** Focus/zoom region: center (0–1) and zoom ratio (1 = full frame, 2 = 2x zoom). */
export interface Focus {
  /** Center X, normalized 0–1 (0.5 = center). */
  x: number;
  /** Center Y, normalized 0–1 (0.5 = center). */
  y: number;
  /** Zoom level: 1 = full frame, >1 = zoom in (e.g. 2 = 2x). */
  zoom: number;
}

export type ObjectFit = 'contain' | 'cover' | 'fill';

/** Color grading settings for video/image clips */
export interface ColorGradingSettings {
  // Basic corrections (-100 to 100 unless noted)
  exposure: number;      // -2 to 2
  contrast: number;      // -100 to 100
  saturation: number;    // -100 to 100
  temperature: number;   // -100 (cool) to 100 (warm)
  tint: number;          // -100 (green) to 100 (magenta)
  highlights: number;    // -100 to 100
  shadows: number;       // -100 to 100
}

export const DEFAULT_COLOR_GRADING: ColorGradingSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
};

/** Chroma key (green screen): key color and tolerance to make that color transparent */
export interface ChromaKeySettings {
  /** Key color as hex, e.g. "#00ff00" for green */
  color: string;
  /** Tolerance 0–1: how much color match to key (higher = more pixels transparent). UI often uses 0–100. */
  threshold: number;
  /** Edge softness 0–1 (optional). UI often uses 0–100. */
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
  name: string;        // Display name
  start: number;       // Timeline position (seconds)
  duration: number;    // Clip length on timeline (seconds)
  offset: number;      // Start offset in source media (seconds)
  speed: number;       // Playback speed (1.0 = normal)
  position: Vec2;      // Scene position in pixels
  scale: Vec2;         // Scale multiplier (1 = 100%)
  /**
   * Optional asset identifier, used for caching waveform data or resolving metadata
   */
  assetId?: string;
  /** Transition when clip enters (starts playing) */
  enterTransition?: ClipTransition;
  /** Transition when clip exits (stops playing) */
  exitTransition?: ClipTransition;
}

export type MaskMode = 'include' | 'exclude';

export interface VideoClip extends BaseClip {
  type: 'video';
  /** Asset ID; playback URL is resolved at preview/render time, never stored. */
  assetId: string;
  width?: number;     // Width in pixels
  height?: number;    // Height in pixels
  sourceDuration?: number;  // Total duration of source media (seconds)
  focus?: Focus;
  objectFit?: ObjectFit;
  // Mask compositing properties
  maskAssetId?: string;   // Reference to mask asset (binary video). maskSrc resolved at render time.
  maskMode?: MaskMode;    // 'include' = show only masked area, 'exclude' = show everything except masked area
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key (green screen): key color and threshold */
  chromaKey?: ChromaKeySettings;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
  /** Audio volume 0–1 (1 = full). Default 1. */
  audioVolume?: number;
}

export interface AudioClip extends BaseClip {
  type: 'audio';
  /** Asset ID; playback URL is resolved at preview/render time, never stored. */
  assetId: string;
  volume: number;     // 0-1
  sourceDuration?: number;  // Total duration of source media (seconds)
}

export interface TextClip extends BaseClip {
  type: 'text';
  text: string;       // Text content
  fontSize?: number;  // Font size in pixels
  fill?: string;      // Text color
  opacity?: number;   // Opacity 0-1
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
  /** Asset ID; playback URL is resolved at preview/render time, never stored. */
  assetId: string;
  width?: number;     // Width in pixels
  height?: number;    // Height in pixels
  /** Optional visual effect (glitch, ripple, vhs, etc.) */
  effect?: VisualEffectType;
  /** Color grading settings */
  colorGrading?: ColorGradingSettings;
  /** Chroma key (green screen) for image clips */
  chromaKey?: ChromaKeySettings;
  /** Idle animation while clip is visible (hover, pulse, float, glow) */
  animation?: ClipAnimationType;
  /** Animation intensity 0–5x (1 = normal, 5 = 5x). Default 1. */
  animationIntensity?: number;
}

export type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

/** Clips with playback URLs resolved (for preview/render only; never persisted). */
export type ResolvedVideoClip = VideoClip & { src: string; maskSrc?: string };
export type ResolvedAudioClip = AudioClip & { src: string };
export type ResolvedImageClip = ImageClip & { src: string };
export type ResolvedTimelineClip = ResolvedVideoClip | ResolvedAudioClip | TextClip | ResolvedImageClip;

export interface Layer {
  id: string;
  name: string;
  type: ClipType;
  clips: TimelineClip[];
  hidden?: boolean;
}

/** Layer with clips that have resolved playback URLs (preview/render only). */
export interface ResolvedLayer extends Omit<Layer, "clips"> {
  clips: ResolvedTimelineClip[];
}

export interface Project {
  name: string;
  resolution: { width: number; height: number };
  fps: number;
  layers: Layer[];
  renderScale: number;
  previewRenderScale?: number;
  background: string;
  transcriptions?: Record<string, ProjectTranscription>;
  transitions?: Record<TransitionKey, ClipTransition>;
  assistantChats?: AssistantChatSession[];
  activeAssistantChatId?: string | null;
  captionSettings?: CaptionSettings;
  textClipSettings?: TextClipSettings;
}

// Test videos for development
export const TEST_VIDEOS = [
  {
    name: 'Big Buck Bunny (short)',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    duration: 10,
  },
  {
    name: 'Big Buck Bunny (full)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 596,
  },
  {
    name: 'Elephant Dream',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    duration: 653,
  },
  {
    name: 'Sintel',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    duration: 888,
  },
];

// Test audio clips for development
export const TEST_AUDIOS = [
  {
    name: 'Ambient Background',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    duration: 30,
  },
  {
    name: 'Upbeat Music',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    duration: 30,
  },
  {
    name: 'Calm Piano',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    duration: 30,
  },
  {
    name: 'Electronic Beat',
    url: 'https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav',
    duration: 60,
  },
];

// Test images for development
export const TEST_IMAGES = [
  {
    name: 'Placeholder 1',
    url: 'https://placehold.co/600x400/png',
    duration: 5,
  },
  {
    name: 'Placeholder 2',
    url: 'https://placehold.co/600x400/orange/white/png',
    duration: 5,
  },
];

// Helper to create a new video clip (playback URL resolved at preview/render time)
export function createVideoClip(
  assetId: string,
  name: string,
  start: number,
  duration: number,
  options?: { width?: number; height?: number; sourceDuration?: number; audioVolume?: number }
): VideoClip {
  return {
    id: crypto.randomUUID(),
    type: 'video',
    name,
    assetId,
    start,
    duration,
    offset: 0,
    speed: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    width: options?.width,
    height: options?.height,
    sourceDuration: options?.sourceDuration,
    audioVolume: options?.audioVolume,
    objectFit: 'contain',
  };
}

// Helper to create a new audio clip (playback URL resolved at preview/render time)
export function createAudioClip(
  assetId: string,
  name: string,
  start: number,
  duration: number,
  options?: { sourceDuration?: number }
): AudioClip {
  return {
    id: crypto.randomUUID(),
    type: 'audio',
    name,
    assetId,
    start,
    duration,
    offset: 0,
    speed: 1,
    volume: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    sourceDuration: options?.sourceDuration,
  };
}

// Helper to create a new text clip
export function createTextClip(
  text: string,
  name: string,
  start: number,
  duration: number
): TextClip {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    name,
    text,
    start,
    duration,
    offset: 0,
    speed: 1,
    fontSize: 48,
    fill: '#ffffff',
    position: { x: 0, y: -200 },
    scale: { x: 1, y: 1 },
    opacity: 1,
    template: 'text',
  };
}

/** Template preset configurations */
export interface TextTemplatePreset {
  id: TextTemplateType;
  name: string;
  description: string;
  defaultText: string;
  defaultSubtitle?: string;
  defaults: Partial<TextClip>;
}

export const TEXT_TEMPLATE_PRESETS: TextTemplatePreset[] = [
  {
    id: 'text',
    name: 'Text',
    description: 'Simple text overlay',
    defaultText: 'Your text here',
    defaults: {
      fontSize: 48,
      fill: '#ffffff',
      position: { x: 0, y: 0 },
      template: 'text',
    },
  },
  {
    id: 'title-card',
    name: 'Title Card',
    description: 'Full screen title with background',
    defaultText: 'Title',
    defaultSubtitle: 'Subtitle',
    defaults: {
      fontSize: 72,
      fill: '#ffffff',
      position: { x: 0, y: 0 },
      template: 'title-card',
      backgroundColor: '#1a1a2e',
    },
  },
  {
    id: 'lower-third',
    name: 'Lower Third',
    description: 'Name/title bar at bottom',
    defaultText: 'Name',
    defaultSubtitle: 'Title',
    defaults: {
      fontSize: 36,
      fill: '#ffffff',
      position: { x: 0, y: 350 },
      template: 'lower-third',
      backgroundColor: 'rgba(0,0,0,0.8)',
    },
  },
  {
    id: 'caption-style',
    name: 'Caption Style',
    description: 'Floating pill overlay',
    defaultText: 'Caption text',
    defaults: {
      fontSize: 32,
      fill: '#ffffff',
      position: { x: 0, y: 300 },
      template: 'caption-style',
      backgroundColor: 'rgba(0,0,0,0.9)',
    },
  },
];

// Helper to create a text clip from template
export function createTextClipFromTemplate(
  template: TextTemplateType,
  start: number,
  duration: number = 5
): TextClip {
  const preset = TEXT_TEMPLATE_PRESETS.find((p) => p.id === template) ?? TEXT_TEMPLATE_PRESETS[0];
  return {
    id: crypto.randomUUID(),
    type: 'text',
    name: preset.name,
    text: preset.defaultText,
    subtitle: preset.defaultSubtitle,
    start,
    duration,
    offset: 0,
    speed: 1,
    scale: { x: 1, y: 1 },
    opacity: 1,
    ...preset.defaults,
    position: preset.defaults.position ?? { x: 0, y: 0 },
  };
}

// Helper to create a new image clip (playback URL resolved at preview/render time)
export function createImageClip(
  assetId: string,
  name: string,
  start: number,
  duration: number,
  options?: { width?: number; height?: number }
): ImageClip {
  return {
    id: crypto.randomUUID(),
    type: 'image',
    name,
    assetId,
    start,
    duration,
    offset: 0,
    speed: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    width: options?.width,
    height: options?.height,
  };
}

// Get the end time of a clip (accounting for speed)
export function getClipEnd(clip: BaseClip): number {
  return clip.start + clip.duration / clip.speed;
}

// Check if a clip is active at a given time
export function isClipActiveAtTime(clip: BaseClip, time: number): boolean {
  return time >= clip.start && time < getClipEnd(clip);
}

// Get the source time for a given timeline time
export function getSourceTime(clip: BaseClip, timelineTime: number): number {
  const clipLocalTime = timelineTime - clip.start;
  return clip.offset + clipLocalTime * clip.speed;
}
