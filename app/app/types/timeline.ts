// Timeline clip types for NLE editor

export type ClipType = 'video' | 'audio' | 'text' | 'image';

export interface Vec2 {
  x: number;
  y: number;
}

export interface BaseClip {
  id: string;
  name: string;        // Display name
  start: number;       // Timeline position (seconds)
  duration: number;    // Clip length on timeline (seconds)
  offset: number;      // Start offset in source media (seconds)
  speed: number;       // Playback speed (1.0 = normal)
  position: Vec2;      // Scene position in pixels
  scale: Vec2;         // Scale multiplier (1 = 100%)
}

export interface VideoClip extends BaseClip {
  type: 'video';
  src: string;        // External URL
}

export interface AudioClip extends BaseClip {
  type: 'audio';
  src: string;        // External URL
  volume: number;     // 0-1
}

export interface TextClip extends BaseClip {
  type: 'text';
  text: string;       // Text content
  fontSize?: number;  // Font size in pixels
  fill?: string;      // Text color
  opacity?: number;   // Opacity 0-1
}

export interface ImageClip extends BaseClip {
  type: 'image';
  src: string;        // External URL
  width?: number;     // Width in pixels
  height?: number;    // Height in pixels
}

export type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

export interface Layer {
  id: string;
  name: string;
  type: ClipType;
  clips: TimelineClip[];
}

export interface Project {
  name: string;
  resolution: { width: number; height: number };
  fps: number;
  layers: Layer[];
  renderScale: number;
  background: string;
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

// Helper to create a new video clip
export function createVideoClip(
  src: string,
  name: string,
  start: number,
  duration: number
): VideoClip {
  return {
    id: crypto.randomUUID(),
    type: 'video',
    name,
    src,
    start,
    duration,
    offset: 0,
    speed: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
  };
}

// Helper to create a new audio clip
export function createAudioClip(
  src: string,
  name: string,
  start: number,
  duration: number
): AudioClip {
  return {
    id: crypto.randomUUID(),
    type: 'audio',
    name,
    src,
    start,
    duration,
    offset: 0,
    speed: 1,
    volume: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
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
  };
}

// Helper to create a new image clip
export function createImageClip(
  src: string,
  name: string,
  start: number,
  duration: number
): ImageClip {
  return {
    id: crypto.randomUUID(),
    type: 'image',
    name,
    src,
    start,
    duration,
    offset: 0,
    speed: 1,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
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
