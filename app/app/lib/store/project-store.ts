import { create } from 'zustand';
import * as Automerge from '@automerge/automerge';
import type {
  AudioClip,
  ClipTransition,
  ClipType,
  ImageClip,
  Layer,
  Project,
  TextClip,
  TimelineClip,
  VideoClip,
} from '@/app/types/timeline';
import { getClipEnd, parseTransitionKey } from '@/app/types/timeline';
import type { ProjectTranscription } from '@/app/types/transcription';
import type {
  AssistantChatSession,
  ChatMode,
  TimelineChatMessage,
} from '@/app/types/chat';
import { ProjectSyncManager } from '@/app/lib/automerge/sync-manager';
import { automergeToProject, projectToAutomerge } from '@/app/lib/automerge/adapter';
import type { AutomergeProject } from '@/app/lib/automerge/types';

interface ProjectStore {
  project: Project;
  projectId: string | null;
  currentTime: number;
  selectedClipId: string | null;
  selectedTransitionKey: string | null;
  isPlaying: boolean;
  zoom: number; // pixels per second
  isMuted: boolean;
  isLooping: boolean;
  playbackSpeed: number;

  // Sync manager for Automerge/Firestore integration
  syncManager: ProjectSyncManager | null;
  currentBranch: string;
  isOnline: boolean;

  addLayer: (layer: Layer) => void;
  addClip: (clip: TimelineClip, layerId?: string) => void;
  deleteLayer: (layerId: string) => void;
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
    settings: Partial<Pick<Project, 'renderScale' | 'background' | 'resolution' | 'fps' | 'name' | 'captionSettings'>>
  ) => void;
  setProject: (project: Project, options?: { markSaved?: boolean }) => void;
  upsertProjectTranscription: (transcription: ProjectTranscription) => void;
  mergeProjectTranscription: (assetId: string, updates: Partial<ProjectTranscription>) => void;
  removeProjectTranscription: (assetId: string) => void;

  // Transition actions
  addTransition: (fromId: string, toId: string, transition: ClipTransition) => void;
  removeTransition: (fromId: string, toId: string) => void;

  // Assistant chat actions
  createAssistantChat: (name?: string) => void;
  setActiveAssistantChat: (chatId: string) => void;
  renameAssistantChat: (chatId: string, name: string) => void;
  deleteAssistantChat: (chatId: string) => void;
  setAssistantChatMode: (chatId: string, mode: ChatMode) => void;
  updateAssistantChatMessages: (chatId: string, messages: TimelineChatMessage[]) => void;

  getDuration: () => number;
  getActiveVideoClip: (time: number) => VideoClip | undefined;
  getActiveAudioClips: (time: number) => AudioClip[];
  getActiveTextClips: (time: number) => TextClip[];
  getActiveImageClips: (time: number) => ImageClip[];
  getClipById: (id: string) => TimelineClip | undefined;

  // History - now using Automerge instead of Zundo
  undo: () => void;
  redo: () => void;

  // Persistence
  initializeSync: (userId: string, projectId: string, branchId?: string, onFirebaseSync?: () => void) => Promise<void>;
  loadProject: (id: string) => void;
  saveProject: () => void;
  forceSyncToFirestore: () => Promise<void>;
  exportProject: () => void;
  hasUnsavedChanges: boolean;
  lastSavedSnapshot: string;
  markProjectSaved: () => void;
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

const createAssistantChatSession = (name: string): AssistantChatSession => {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentMode: 'agent',
    messages: [],
  };
};

const normalizeAssistantChats = (
  sessions?: AssistantChatSession[]
): AssistantChatSession[] => {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [createAssistantChatSession('Chat 1')];
  }

  return sessions.map((session, index) => {
    const timestamp = new Date().toISOString();
    return {
      id: session.id ?? crypto.randomUUID(),
      name: session.name?.trim() || `Chat ${index + 1}`,
      createdAt: session.createdAt ?? timestamp,
      updatedAt: session.updatedAt ?? timestamp,
      currentMode: session.currentMode ?? 'agent',
      messages: Array.isArray(session.messages) ? session.messages : [],
    };
  });
};

const ensureAssistantChatState = (project: Project): Project => {
  const assistantChats = normalizeAssistantChats(project.assistantChats);
  const activeAssistantChatId =
    assistantChats.find((chat) => chat.id === project.activeAssistantChatId)?.id ??
    assistantChats[0]?.id ??
    null;

  return {
    ...project,
    assistantChats,
    activeAssistantChatId,
  };
};

const defaultProject: Project = ensureAssistantChatState({
  name: 'Untitled Project',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  renderScale: 1,
  background: '#141417',
  layers: [],
  transcriptions: {},
  transitions: {},
  assistantChats: [],
  activeAssistantChatId: null,
});

const clampZoom = (zoom: number) => Math.max(10, Math.min(200, zoom));

const removeClipFromLayer = (layer: Layer, clipIndex: number): Layer => ({
  ...layer,
  clips: layer.clips.filter((_, index) => index !== clipIndex),
});

const createProjectUpdateHelper = (
  set: typeof useProjectStore.setState
) => {
  return (
    updater: (state: ProjectStore) =>
      | {
          project: Project;
          [key: string]: unknown;
        }
      | null
      | undefined,
    options?: { markSaved?: boolean }
  ) => {
    set((state) => {
      const next = updater(state);
      if (!next) {
        return state;
      }
      const { project, ...rest } = next;
      const payload: Partial<ProjectStore> = {
        ...rest,
        project,
      };
      if (options?.markSaved) {
        payload.hasUnsavedChanges = false;
        payload.lastSavedSnapshot = JSON.stringify(project);
      } else {
        payload.hasUnsavedChanges = true;
      }
      return payload;
    });
  };
};

let onFirebaseSyncCallback: (() => void) | null = null;

export const setOnFirebaseSync = (callback: (() => void) | null) => {
  onFirebaseSyncCallback = callback;
  // If sync manager already exists, update it
  const store = useProjectStore.getState();
  if (store.syncManager) {
    // Re-initialize with new callback
    const state = store.syncManager.getDocument();
    if (state) {
      console.log('[FIREBASE-SYNC] Updated Firebase sync callback');
    }
  }
};

export const useProjectStore = create<ProjectStore>()((set, get): ProjectStore => {
  let syncManager: ProjectSyncManager | null = null;

  const updateProjectState = createProjectUpdateHelper(set);

  // Helper to apply changes through sync manager
  const applySyncedChange = async (
    changeFn: (state: ProjectStore) => { project: Project; [key: string]: unknown } | null | undefined
  ) => {
    // 1. Apply change to store immediately
    const result = changeFn(get());
    if (result) {
      const { project, ...rest } = result;
      set({ project, ...rest });

      // 2. Sync to Automerge async
      const currentSyncManager = get().syncManager;
      if (currentSyncManager) {
        try {
          console.log('[SYNC] Syncing to Automerge');
          await currentSyncManager.applyChange((automergeDoc) => {
            automergeDoc.projectJSON = JSON.stringify(project);
          });
        } catch (error) {
          console.error('[SYNC] Failed to sync to Automerge:', error);
        }
      }
    }
  };

  return {
    // Initial state
    project: defaultProject,
    projectId: null,
    currentTime: 0,
    selectedClipId: null,
    selectedTransitionKey: null,
    isPlaying: false,
    zoom: 50,
    isMuted: false,
    isLooping: true,
    playbackSpeed: 1,
    syncManager: null,
    currentBranch: 'main',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hasUnsavedChanges: false,
    lastSavedSnapshot: JSON.stringify(defaultProject),

    // Initialize sync manager (must be called when loading a project)
    initializeSync: async (userId: string, projectId: string, branchId: string = 'main', onFirebaseSync?: () => void) => {
      console.log('[SYNC] initializeSync called', { userId, projectId, branchId });
      if (syncManager) {
        syncManager.destroy();
      }

      syncManager = new ProjectSyncManager(
        userId,
        projectId,
        branchId,
        (doc: any) => {
          console.log('[SYNC] Sync manager onUpdate callback triggered');
          // When sync manager updates, update the store
          let project: Project;
          if (doc.projectJSON) {
            try {
              project = JSON.parse(doc.projectJSON);
            } catch (e) {
              console.error('Failed to parse projectJSON:', e);
              return;
            }
          } else {
            project = automergeToProject(doc);
          }
          set({ project, currentBranch: branchId, isOnline: syncManager?.getIsOnline() ?? true });
        },
        () => {
          onFirebaseSync?.();
          onFirebaseSyncCallback?.();
        }
      );

      console.log('[SYNC] Initializing sync manager');
      await syncManager.initialize();

      // Load project state from Firebase (source of truth)
      const doc = syncManager.getDocument();
      console.log('[SYNC] Firebase document:', doc ? Object.keys(doc) : 'null');
      if (doc && doc.projectJSON) {
        console.log('[SYNC] Loading project from Firebase', doc.projectJSON.length, 'chars');
        try {
          const project = JSON.parse(doc.projectJSON);
          console.log('[SYNC] Loaded project from Firebase:', project.name, 'with', project.layers.length, 'layers');
          set({ project, syncManager, currentBranch: branchId, projectId });
        } catch (e) {
          console.error('Failed to parse project from Firebase:', e);
          set({ syncManager, currentBranch: branchId, projectId });
        }
      } else if (doc && Object.keys(doc).length === 0) {
        // Empty document - initialize with current store project
        const currentProject = get().project;
        console.log('[SYNC] Initializing empty document with current project:', currentProject.name);
        await syncManager.applyChange((automergeDoc) => {
          automergeDoc.projectJSON = JSON.stringify(currentProject);
        });
        set({ syncManager, currentBranch: branchId, projectId });
      } else {
        console.log('[SYNC] No project data in Firebase or Automerge doc is null');
        set({ syncManager, currentBranch: branchId, projectId });
      }
    },

    // History using Automerge
    undo: async () => {
      try {
        const currentSyncManager = get().syncManager;
        if (currentSyncManager) {
          await currentSyncManager.undo();
        }
      } catch (error) {
        console.error('Undo failed:', error);
      }
    },

    redo: async () => {
      try {
        const currentSyncManager = get().syncManager;
        if (currentSyncManager) {
          await currentSyncManager.redo();
        }
      } catch (error) {
        console.error('Redo failed:', error);
      }
    },

      addLayer: (layer) => {
        applySyncedChange((state) => ({
          project: {
            ...state.project,
            layers: [...state.project.layers, layer],
          },
        }));
      },

      deleteLayer: (layerId: string) => {
        applySyncedChange((state) => {
          const { layers, transitions = {} } = state.project;
          const layerIndex = layers.findIndex((layer) => layer.id === layerId);
          if (layerIndex === -1) return null;

          const layer = layers[layerIndex];
          const clipIds = new Set(layer.clips.map((clip) => clip.id));

          const filteredTransitionsEntries = Object.entries(transitions).filter(
            ([key]) => {
              const { fromId, toId } = parseTransitionKey(key);
              return !clipIds.has(fromId) && !clipIds.has(toId);
            }
          );

          const nextTransitions =
            filteredTransitionsEntries.length === Object.keys(transitions).length
              ? transitions
              : Object.fromEntries(filteredTransitionsEntries);

          const nextLayers = layers.filter((existingLayer) => existingLayer.id !== layerId);

          const nextSelectedClipId =
            state.selectedClipId && clipIds.has(state.selectedClipId)
              ? null
              : state.selectedClipId;

          const nextSelectedTransitionKey =
            state.selectedTransitionKey &&
            !filteredTransitionsEntries.some(
              ([key]) => key === state.selectedTransitionKey
            )
              ? null
              : state.selectedTransitionKey;

          return {
            project: {
              ...state.project,
              layers: nextLayers,
              transitions: nextTransitions,
            },
            selectedClipId: nextSelectedClipId,
            selectedTransitionKey: nextSelectedTransitionKey,
          };
        });
      },

      addClip: (clip: TimelineClip, layerId?: string) => {
        applySyncedChange((state) => {
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
        });
      },

      updateClip: (id: string, updates: Partial<TimelineClip>) => {
        applySyncedChange((state) => {
          const location = findClipLocation(state.project, id);
          if (!location) return null;

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
        });
      },

      deleteClip: (id: string) => {
        applySyncedChange((state) => {
          const location = findClipLocation(state.project, id);
          if (!location) return null;

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
        });
      },

      moveClipToLayer: (clipId: string, targetLayerId: string) => {
        applySyncedChange((state) => {
          const location = findClipLocation(state.project, clipId);
          if (!location) return null;

          const targetIndex = state.project.layers.findIndex(
            (layer) => layer.id === targetLayerId
          );
          if (targetIndex === -1) return null;

          const { layerIndex, clipIndex, clip } = location;
          if (layerIndex === targetIndex) return null;

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
        });
      },

      setCurrentTime: (time: number) => set({ currentTime: Math.max(0, time) }),

      setSelectedClip: (id: string | null) => set({ selectedClipId: id, selectedTransitionKey: null }),
      setSelectedTransition: (key: string | null) => set({ selectedTransitionKey: key, selectedClipId: null }),

      setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

      setZoom: (zoom: number) => set({ zoom: clampZoom(zoom) }),

      setMuted: (muted: boolean) => set({ isMuted: muted }),

      setLooping: (looping) => set({ isLooping: looping }),

      setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

      updateProjectSettings: (settings) => {
        applySyncedChange((state) => ({
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
            captionSettings:
              settings.captionSettings !== undefined
                ? settings.captionSettings
                : state.project.captionSettings,
          },
        }));
      },

      setProject: (project, options) =>
        set(() => {
          const normalized = ensureAssistantChatState({
            ...project,
            transcriptions: project.transcriptions ?? {},
            transitions: project.transitions ?? {},
          });
          const snapshot = JSON.stringify(normalized);
          return {
            project: normalized,
            currentTime: 0,
            selectedClipId: null,
            ...(options?.markSaved
              ? { hasUnsavedChanges: false, lastSavedSnapshot: snapshot }
              : { hasUnsavedChanges: true }),
          };
        }),

      upsertProjectTranscription: (transcription) => {
        applySyncedChange((state) => {
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
        });
      },

      mergeProjectTranscription: (assetId, updates) => {
        applySyncedChange((state) => {
          const existing = state.project.transcriptions ?? {};
          const current = existing[assetId];
          if (!current) return null;
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
        });
      },

      removeProjectTranscription: (assetId) => {
        applySyncedChange((state) => {
          const existing = state.project.transcriptions ?? {};
          if (!(assetId in existing)) return null;
          const rest = { ...existing };
          delete rest[assetId];
          return {
            project: {
              ...state.project,
              transcriptions: rest,
            },
          };
        });
      },

      addTransition: (fromId, toId, transition) => {
        applySyncedChange((state) => {
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
        });
      },

      removeTransition: (fromId, toId) => {
        applySyncedChange((state) => {
          const key = `${fromId}->${toId}` as const;
          const transitions = { ...state.project.transitions };
          delete transitions[key];
          return {
            project: {
              ...state.project,
              transitions,
            },
          };
        });
      },

      createAssistantChat: (name) => {
        applySyncedChange((state) => {
          const chats = state.project.assistantChats ?? [];
          const label = name?.trim() || `Chat ${chats.length + 1}`;
          const newChat = createAssistantChatSession(label);
          return {
            project: {
              ...state.project,
              assistantChats: [...chats, newChat],
              activeAssistantChatId: newChat.id,
            },
          };
        });
      },

      setActiveAssistantChat: (chatId) => {
        applySyncedChange((state) => {
          const chats = state.project.assistantChats ?? [];
          if (!chats.some((chat) => chat.id === chatId)) return null;
          return {
            project: {
              ...state.project,
              activeAssistantChatId: chatId,
            },
          };
        });
      },

      renameAssistantChat: (chatId, name) => {
        applySyncedChange((state) => {
          const trimmed = name?.trim();
          if (!trimmed) return null;
          const chats = state.project.assistantChats ?? [];
          const updated = chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, name: trimmed, updatedAt: new Date().toISOString() }
              : chat
          );
          return {
            project: {
              ...state.project,
              assistantChats: updated,
            },
          };
        });
      },

      deleteAssistantChat: (chatId) => {
        applySyncedChange((state) => {
          const chats = state.project.assistantChats ?? [];
          if (chats.length <= 1) return null;
          const filtered = chats.filter((chat) => chat.id !== chatId);
          if (filtered.length === chats.length) return null;
          const nextActive =
            state.project.activeAssistantChatId === chatId
              ? filtered[0]?.id ?? null
              : state.project.activeAssistantChatId;
          return {
            project: {
              ...state.project,
              assistantChats: filtered,
              activeAssistantChatId: nextActive,
            },
          };
        });
      },

      setAssistantChatMode: (chatId, mode) => {
        applySyncedChange((state) => {
          const chats = state.project.assistantChats ?? [];
          const updated = chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, currentMode: mode, updatedAt: new Date().toISOString() }
              : chat
          );
          return {
            project: {
              ...state.project,
              assistantChats: updated,
            },
          };
        });
      },

      updateAssistantChatMessages: (chatId, messages) => {
        applySyncedChange((state) => {
          const chats = state.project.assistantChats ?? [];
          const updated = chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, messages, updatedAt: new Date().toISOString() }
              : chat
          );
          return {
            project: {
              ...state.project,
              assistantChats: updated,
            },
          };
        });
      },

      splitClipAtTime: (id, time) => {
        applySyncedChange((state) => {
          const location = findClipLocation(state.project, id);
          if (!location) return null;

          const { layerIndex, clipIndex, clip, layer } = location;
          const clipEnd = getClipEnd(clip);
          if (time <= clip.start || time >= clipEnd) return null;

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

          return {
            project: {
              ...state.project,
              layers: state.project.layers.map((existingLayer, idx) => {
                if (idx !== layerIndex) return existingLayer;
                const newClips = [...layer.clips];
                newClips.splice(clipIndex, 1, firstClip, secondClip);
                return {
                  ...layer,
                  clips: newClips,
                };
              }),
            },
          };
        });
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

      loadProject: (id) => {
        if (typeof window === 'undefined') return;
        const data = localStorage.getItem(`gemini-project-${id}`);
        if (data) {
          try {
            const saved = JSON.parse(data);
            const normalized = ensureAssistantChatState({
              ...defaultProject,
              ...saved,
              transcriptions: saved.transcriptions ?? {},
              transitions: saved.transitions ?? {},
            });
            set({ 
              projectId: id,
              project: normalized,
              currentTime: 0,
              selectedClipId: null,
              selectedTransitionKey: null,
              isPlaying: false,
              hasUnsavedChanges: false,
              lastSavedSnapshot: JSON.stringify(normalized),
            });
          } catch (e) {
            console.error("Failed to load project", e);
          }
        } else {
            const freshProject = ensureAssistantChatState({
              ...defaultProject,
              name: "New Project",
            });
            set({ 
                projectId: id,
                project: freshProject, 
                currentTime: 0,
                hasUnsavedChanges: false,
                lastSavedSnapshot: JSON.stringify(freshProject),
            });
        }
      },

      saveProject: () => {
        if (typeof window === 'undefined') return;
        const { project, projectId } = get();
        if (!projectId) return;
        const snapshot = JSON.stringify(project);
        localStorage.setItem(`gemini-project-${projectId}`, snapshot);
        set({ hasUnsavedChanges: false, lastSavedSnapshot: snapshot });
      },

      exportProject: () => {
        const { project } = get();
        const data = JSON.stringify(project, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.gemini.json`;
        a.click();
        URL.revokeObjectURL(url);
      },

      markProjectSaved: () =>
        set((state) => ({
          hasUnsavedChanges: false,
          lastSavedSnapshot: JSON.stringify(state.project),
        })),

      forceSyncToFirestore: async () => {
        if (!syncManager) {
          throw new Error('Sync not initialized');
        }
        try {
          await syncManager.forceSyncToFirestore();
        } catch (error) {
          console.error('Failed to force sync to Firestore:', error);
          throw error;
        }
      },
    };
  }
);

useProjectStore.subscribe((state, previousState) => {
  if (state.project === previousState.project) {
    return;
  }

  const snapshot = JSON.stringify(state.project);
  const { lastSavedSnapshot, hasUnsavedChanges } = useProjectStore.getState();
  const isDirty = snapshot !== lastSavedSnapshot;

  if (hasUnsavedChanges !== isDirty) {
    console.debug("[project-store] hasUnsavedChanges ->", isDirty);
    useProjectStore.setState({ hasUnsavedChanges: isDirty });
  }
});
