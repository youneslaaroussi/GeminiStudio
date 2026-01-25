import { create } from 'zustand';
import type {
  AudioClip,
  ClipType,
  ImageClip,
  Layer,
  Project,
  TextClip,
  TimelineClip,
  VideoClip,
} from '@/app/types/timeline';
import { getClipEnd } from '@/app/types/timeline';
import type { ProjectTranscription } from '@/app/types/transcription';

interface ProjectStore {
  project: Project;
  currentTime: number;
  selectedClipId: string | null;
  selectedTransitionKey: string | null;
  isPlaying: boolean;
  zoom: number; // pixels per second
  isMuted: boolean;
  isLooping: boolean;
  playbackSpeed: number;

  addLayer: (layer: Layer) => void;
  addClip: (clip: TimelineClip, layerId?: string) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  deleteClip: (id: string) => void;
  moveClipToLayer: (clipId: string, targetLayerId: string) => void;
  setCurrentTime: (time: number) => void;
  setSelectedClip: (id: string | null) => void;
  setSelectedTransition: (key: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setMuted: (muted: boolean) => void;
  setLooping: (looping: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  splitClipAtTime: (id: string, time: number) => void;
  updateProjectSettings: (
    settings: Partial<Pick<Project, 'renderScale' | 'background' | 'resolution' | 'fps' | 'name'>>
  ) => void;
  setProject: (project: Project) => void;
  upsertProjectTranscription: (transcription: ProjectTranscription) => void;
  mergeProjectTranscription: (assetId: string, updates: Partial<ProjectTranscription>) => void;
  removeProjectTranscription: (assetId: string) => void;
  
  // Transition actions
  addTransition: (fromId: string, toId: string, transition: ClipTransition) => void;
  removeTransition: (fromId: string, toId: string) => void;

  getDuration: () => number;
  getActiveVideoClip: (time: number) => VideoClip | undefined;
  getActiveAudioClips: (time: number) => AudioClip[];
  getActiveTextClips: (time: number) => TextClip[];
  getActiveImageClips: (time: number) => ImageClip[];
  getClipById: (id: string) => TimelineClip | undefined;
}

export const createLayerTemplate = (type: ClipType, name?: string): Layer => ({
  id: crypto.randomUUID(),
  name: name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} Layer`,
  type,
  clips: [],
});

const findClipLocation = (project: Project, clipId: string) => {
  for (let layerIndex = 0; layerIndex < project.layers.length; layerIndex++) {
    const layer = project.layers[layerIndex];
    const clipIndex = layer.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex !== -1) {
      return {
        layerIndex,
        clipIndex,
        layer,
        clip: layer.clips[clipIndex],
      };
    }
  }

  return null;
};

const defaultProject: Project = {
  name: 'Untitled Project',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  renderScale: 1,
  background: '#141417',
  layers: [],
  transcriptions: {},
  transitions: {},
};

const clampZoom = (zoom: number) => Math.max(10, Math.min(200, zoom));

const removeClipFromLayer = (layer: Layer, clipIndex: number): Layer => ({
  ...layer,
  clips: layer.clips.filter((_, index) => index !== clipIndex),
});

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  project: defaultProject,
  currentTime: 0,
  selectedClipId: null,
  selectedTransitionKey: null,
  isPlaying: false,
  zoom: 50,
  isMuted: false,
  isLooping: true,
  playbackSpeed: 1,

  addLayer: (layer) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: [...state.project.layers, layer],
      },
    })),

  addClip: (clip, layerId) =>
    set((state) => {
      // Check if project is currently empty (has no clips) to potentially set resolution
      const hasExistingClips = state.project.layers.some((l) => l.clips.length > 0);
      let resolutionUpdate = {};

      if (!hasExistingClips && (clip.type === "video" || clip.type === "image")) {
        const visualClip = clip as VideoClip | ImageClip;
        if (visualClip.width && visualClip.height) {
          resolutionUpdate = {
            resolution: { width: visualClip.width, height: visualClip.height },
          };
        }
      }

      const layers = [...state.project.layers];
      const targetIndex = typeof layerId === 'string'
        ? layers.findIndex((layer) => layer.id === layerId)
        : layers.findIndex((layer) => layer.type === clip.type);

      if (targetIndex === -1) {
        const newLayer: Layer = {
          ...createLayerTemplate(clip.type),
          clips: [clip],
        };
        return {
          project: {
            ...state.project,
            ...resolutionUpdate,
            layers: [...layers, newLayer],
          },
        };
      }

      const targetLayer = layers[targetIndex];
      layers[targetIndex] = {
        ...targetLayer,
        clips: [...targetLayer.clips, clip],
      };

      return {
        project: {
          ...state.project,
          ...resolutionUpdate,
          layers,
        },
      };
    }),

  updateClip: (id, updates) =>
    set((state) => {
      const location = findClipLocation(state.project, id);
      if (!location) return state;

      const { layerIndex, clipIndex, layer, clip } = location;
      const layers = state.project.layers.map((existingLayer, index) => {
        if (index !== layerIndex) return existingLayer;
        return {
          ...layer,
          clips: layer.clips.map((existingClip, cIndex) =>
            cIndex === clipIndex
              ? ({ ...clip, ...updates } as TimelineClip)
              : existingClip
          ),
        };
      });

      return {
        project: {
          ...state.project,
          layers,
        },
      };
    }),

  deleteClip: (id) =>
    set((state) => {
      const location = findClipLocation(state.project, id);
      if (!location) return state;

      const { layerIndex, clipIndex } = location;
      const layers = state.project.layers.map((layer, index) =>
        index === layerIndex ? removeClipFromLayer(layer, clipIndex) : layer
      );

      return {
        project: {
          ...state.project,
          layers,
        },
        selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
      };
    }),

  moveClipToLayer: (clipId, targetLayerId) =>
    set((state) => {
      const location = findClipLocation(state.project, clipId);
      if (!location) return state;

      const targetIndex = state.project.layers.findIndex(
        (layer) => layer.id === targetLayerId
      );
      if (targetIndex === -1) return state;

      const { layerIndex, clipIndex, clip } = location;
      if (layerIndex === targetIndex) return state;

      const layers = state.project.layers.map((layer, index) => {
        if (index === layerIndex) {
          return removeClipFromLayer(layer, clipIndex);
        }
        if (index === targetIndex) {
          return {
            ...layer,
            clips: [...layer.clips, clip],
          };
        }
        return layer;
      });

      return {
        project: {
          ...state.project,
          layers,
        },
      };
    }),

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),

  setSelectedClip: (id) => set({ selectedClipId: id, selectedTransitionKey: null }),
  setSelectedTransition: (key) => set({ selectedTransitionKey: key, selectedClipId: null }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  setMuted: (muted) => set({ isMuted: muted }),

  setLooping: (looping) => set({ isLooping: looping }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  updateProjectSettings: (settings) =>
    set((state) => ({
      project: {
        ...state.project,
        renderScale:
          settings.renderScale !== undefined
            ? Math.max(0.25, Math.min(4, settings.renderScale))
            : state.project.renderScale,
        background:
          settings.background !== undefined
            ? settings.background
            : state.project.background,
        name:
          settings.name !== undefined
            ? settings.name || "Untitled Project"
            : state.project.name,
        resolution: settings.resolution
          ? {
              width: Math.max(320, settings.resolution.width),
              height: Math.max(240, settings.resolution.height),
            }
          : state.project.resolution,
        fps:
          settings.fps !== undefined
            ? Math.max(1, Math.min(240, settings.fps))
            : state.project.fps,
      },
    })),

  setProject: (project) =>
    set(() => ({
      project: {
        ...project,
        transcriptions: project.transcriptions ?? {},
      },
      currentTime: 0,
      selectedClipId: null,
    })),

  upsertProjectTranscription: (transcription) =>
    set((state) => {
      const existing = state.project.transcriptions ?? {};
      const current = existing[transcription.assetId];
      const createdAt = current?.createdAt ?? transcription.createdAt ?? new Date().toISOString();
      const updatedAt = transcription.updatedAt ?? new Date().toISOString();
      return {
        project: {
          ...state.project,
          transcriptions: {
            ...existing,
            [transcription.assetId]: {
              ...current,
              ...transcription,
              createdAt,
              updatedAt,
            },
          },
        },
      };
    }),

  mergeProjectTranscription: (assetId, updates) =>
    set((state) => {
      const existing = state.project.transcriptions ?? {};
      const current = existing[assetId];
      if (!current) return state;
      return {
        project: {
          ...state.project,
          transcriptions: {
            ...existing,
            [assetId]: {
              ...current,
              ...updates,
              updatedAt: updates.updatedAt ?? new Date().toISOString(),
            },
          },
        },
      };
    }),

  removeProjectTranscription: (assetId) =>
    set((state) => {
      const existing = state.project.transcriptions ?? {};
      if (!(assetId in existing)) return state;
      const rest = { ...existing };
      delete rest[assetId];
      return {
        project: {
          ...state.project,
          transcriptions: rest,
        },
      };
    }),

  addTransition: (fromId, toId, transition) =>
    set((state) => {
      const key = `${fromId}->${toId}` as const;
      return {
        project: {
          ...state.project,
          transitions: {
            ...state.project.transitions,
            [key]: transition,
          },
        },
      };
    }),

  removeTransition: (fromId, toId) =>
    set((state) => {
      const key = `${fromId}->${toId}` as const;
      const transitions = { ...state.project.transitions };
      delete transitions[key];
      return {
        project: {
          ...state.project,
          transitions,
        },
      };
    }),

  splitClipAtTime: (id, time) => {
    const state = get();
    const location = findClipLocation(state.project, id);
    if (!location) return;

    const { layerIndex, clipIndex, clip, layer } = location;
    const clipEnd = getClipEnd(clip);
    if (time <= clip.start || time >= clipEnd) return;

    const firstDuration = (time - clip.start) * clip.speed;
    const secondDuration = clip.duration - firstDuration;

    const firstClip: TimelineClip = {
      ...clip,
      duration: firstDuration,
    };

    const secondClip: TimelineClip = {
      ...clip,
      id: crypto.randomUUID(),
      start: time,
      offset: clip.offset + firstDuration,
      duration: secondDuration,
    };

    set((s) => ({
      project: {
        ...s.project,
        layers: s.project.layers.map((existingLayer, idx) => {
          if (idx !== layerIndex) return existingLayer;
          const newClips = [...layer.clips];
          newClips.splice(clipIndex, 1, firstClip, secondClip);
          return {
            ...layer,
            clips: newClips,
          };
        }),
      },
    }));
  },

  getDuration: () => {
    const { layers } = get().project;
    const allClips = layers.flatMap((layer) => layer.clips);
    if (allClips.length === 0) return 0;
    return Math.max(...allClips.map(getClipEnd));
  },

  getActiveVideoClip: (time) => {
    const { layers } = get().project;
    return layers
      .filter((layer) => layer.type === 'video')
      .flatMap((layer) => layer.clips as VideoClip[])
      .find((clip) => time >= clip.start && time < getClipEnd(clip));
  },

  getActiveAudioClips: (time) => {
    const { layers } = get().project;
    return layers
      .filter((layer) => layer.type === 'audio')
      .flatMap((layer) => layer.clips as AudioClip[])
      .filter((clip) => time >= clip.start && time < getClipEnd(clip));
  },

  getActiveTextClips: (time) => {
    const { layers } = get().project;
    return layers
      .filter((layer) => layer.type === 'text')
      .flatMap((layer) => layer.clips as TextClip[])
      .filter((clip) => time >= clip.start && time < getClipEnd(clip));
  },

  getActiveImageClips: (time) => {
    const { layers } = get().project;
    return layers
      .filter((layer) => layer.type === 'image')
      .flatMap((layer) => layer.clips as ImageClip[])
      .filter((clip) => time >= clip.start && time < getClipEnd(clip));
  },

  getClipById: (id) => {
    const location = findClipLocation(get().project, id);
    return location?.clip;
  },
}));
