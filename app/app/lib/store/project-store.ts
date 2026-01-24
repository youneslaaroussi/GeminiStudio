import { create } from 'zustand';
import type { VideoClip, AudioClip, Project, TimelineClip } from '@/app/types/timeline';
import { getClipEnd } from '@/app/types/timeline';

interface ProjectStore {
  // State
  project: Project;
  currentTime: number;
  selectedClipId: string | null;
  isPlaying: boolean;
  zoom: number; // pixels per second

  // Actions
  addVideoClip: (clip: VideoClip) => void;
  addAudioClip: (clip: AudioClip) => void;
  updateVideoClip: (id: string, updates: Partial<VideoClip>) => void;
  updateAudioClip: (id: string, updates: Partial<AudioClip>) => void;
  deleteClip: (id: string) => void;
  setCurrentTime: (time: number) => void;
  setSelectedClip: (id: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  splitClipAtTime: (id: string, time: number) => void;

  // Computed helpers
  getDuration: () => number;
  getActiveVideoClip: (time: number) => VideoClip | undefined;
  getActiveAudioClips: (time: number) => AudioClip[];
}

const defaultProject: Project = {
  name: 'Untitled Project',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  videoClips: [
    {
      id: 'clip-1',
      type: 'video',
      name: 'Big Buck Bunny',
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      start: 0,
      duration: 10,
      offset: 0,
      speed: 1,
    },
    {
      id: 'clip-2',
      type: 'video',
      name: 'Elephant Dream',
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      start: 10,
      duration: 8,
      offset: 30,
      speed: 1,
    },
    {
      id: 'clip-3',
      type: 'video',
      name: 'Sintel',
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
      start: 18,
      duration: 12,
      offset: 60,
      speed: 1,
    },
  ],
  audioClips: [
    {
      id: 'audio-1',
      type: 'audio',
      name: 'Ambient Background',
      src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      start: 0,
      duration: 15,
      offset: 0,
      speed: 1,
      volume: 0.5,
    },
    {
      id: 'audio-2',
      type: 'audio',
      name: 'Upbeat Music',
      src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      start: 15,
      duration: 15,
      offset: 0,
      speed: 1,
      volume: 0.5,
    },
  ],
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  project: defaultProject,
  currentTime: 0,
  selectedClipId: null,
  isPlaying: false,
  zoom: 50, // 50 pixels per second

  // Actions
  addVideoClip: (clip) =>
    set((state) => ({
      project: {
        ...state.project,
        videoClips: [...state.project.videoClips, clip],
      },
    })),

  addAudioClip: (clip) =>
    set((state) => ({
      project: {
        ...state.project,
        audioClips: [...state.project.audioClips, clip],
      },
    })),

  updateVideoClip: (id, updates) =>
    set((state) => ({
      project: {
        ...state.project,
        videoClips: state.project.videoClips.map((clip) =>
          clip.id === id ? { ...clip, ...updates } : clip
        ),
      },
    })),

  updateAudioClip: (id, updates) =>
    set((state) => ({
      project: {
        ...state.project,
        audioClips: state.project.audioClips.map((clip) =>
          clip.id === id ? { ...clip, ...updates } : clip
        ),
      },
    })),

  deleteClip: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        videoClips: state.project.videoClips.filter((clip) => clip.id !== id),
        audioClips: state.project.audioClips.filter((clip) => clip.id !== id),
      },
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
    })),

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),

  setSelectedClip: (id) => set({ selectedClipId: id }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(200, zoom)) }),

  splitClipAtTime: (id, time) => {
    const state = get();
    const videoClip = state.project.videoClips.find((c) => c.id === id);
    const audioClip = state.project.audioClips.find((c) => c.id === id);

    if (videoClip) {
      const clipEnd = getClipEnd(videoClip);
      if (time <= videoClip.start || time >= clipEnd) return;

      const firstDuration = (time - videoClip.start) * videoClip.speed;
      const secondDuration = videoClip.duration - firstDuration;

      const firstClip: VideoClip = {
        ...videoClip,
        duration: firstDuration,
      };

      const secondClip: VideoClip = {
        ...videoClip,
        id: crypto.randomUUID(),
        start: time,
        offset: videoClip.offset + firstDuration,
        duration: secondDuration,
      };

      set((s) => ({
        project: {
          ...s.project,
          videoClips: [
            ...s.project.videoClips.filter((c) => c.id !== id),
            firstClip,
            secondClip,
          ],
        },
      }));
    }

    if (audioClip) {
      const clipEnd = getClipEnd(audioClip);
      if (time <= audioClip.start || time >= clipEnd) return;

      const firstDuration = (time - audioClip.start) * audioClip.speed;
      const secondDuration = audioClip.duration - firstDuration;

      const firstClip: AudioClip = {
        ...audioClip,
        duration: firstDuration,
      };

      const secondClip: AudioClip = {
        ...audioClip,
        id: crypto.randomUUID(),
        start: time,
        offset: audioClip.offset + firstDuration,
        duration: secondDuration,
      };

      set((s) => ({
        project: {
          ...s.project,
          audioClips: [
            ...s.project.audioClips.filter((c) => c.id !== id),
            firstClip,
            secondClip,
          ],
        },
      }));
    }
  },

  // Computed helpers
  getDuration: () => {
    const { videoClips, audioClips } = get().project;
    const allClips = [...videoClips, ...audioClips];
    if (allClips.length === 0) return 10; // Default 10s timeline
    return Math.max(...allClips.map(getClipEnd));
  },

  getActiveVideoClip: (time) => {
    const { videoClips } = get().project;
    return videoClips.find(
      (clip) => time >= clip.start && time < getClipEnd(clip)
    );
  },

  getActiveAudioClips: (time) => {
    const { audioClips } = get().project;
    return audioClips.filter(
      (clip) => time >= clip.start && time < getClipEnd(clip)
    );
  },
}));
