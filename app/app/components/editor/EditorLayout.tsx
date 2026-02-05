"use client";

import type { Player } from "@motion-canvas/core";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, GripVertical, Loader2, Wrench, MessageSquare, Mic, X, Sparkles, Video } from "lucide-react";
import { AssetsPanel } from "./assets";
import { PreviewPanel, type PreviewPanelHandle } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import { SettingsPanel } from "./settings";
import { TopBar } from "./TopBar";
import { type EditorLayoutPreset, LAYOUT_PRESETS } from "./LayoutSelector";
import { ChatPanel } from "./ChatPanel";
import { ToolboxPanel } from "./ToolboxPanel";
import { VideoEffectsPanel } from "./VideoEffectsPanel";
import { ImageEffectsPanel } from "./ImageEffectsPanel";
import { motion, AnimatePresence } from "motion/react";
import { VoiceChat } from "@/app/components/VoiceChat";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useAssetHighlightStore } from "@/app/lib/store/asset-highlight-store";
import { usePipelineStates } from "@/app/lib/hooks/usePipelineStates";
import { useShortcuts } from "@/app/hooks/use-shortcuts";
import { usePageReloadBlocker } from "@/app/hooks/use-page-reload-blocker";
import { useAutoSave } from "@/app/lib/hooks/useAutoSave";
import { CommandMenu } from "./CommandMenu";
import type { ProjectTranscription } from "@/app/types/transcription";
import type { VideoClip, ImageClip } from "@/app/types/timeline";
import { getProxiedMediaUrl } from "@/app/components/ui/CoordinatePicker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";

// Wrapper component that gets selected video or image clip for the Effects tab
function EffectsPanelWrapper() {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const layer of layers) {
      const clip = layer.clips.find((c) => c.id === selectedClipId);
      if (clip && (clip.type === "video" || clip.type === "image")) {
        return clip;
      }
    }
    return null;
  }, [selectedClipId, layers]);

  if (!selectedClip) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <Video className="size-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No video or image clip selected</p>
          <p className="text-xs mt-1">Select a video or image clip to use AI effects</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        {selectedClip.type === "video" && (
          <VideoEffectsPanel clip={selectedClip as VideoClip} />
        )}
        {selectedClip.type === "image" && (
          <ImageEffectsPanel clip={selectedClip as ImageClip} />
        )}
      </div>
    </ScrollArea>
  );
}

export function EditorLayout() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [isReloadDialogOpen, setReloadDialogOpen] = useState(false);
  const [pendingReloadAction, setPendingReloadAction] = useState<
    "save" | "discard" | null
  >(null);
  const [rightPanelTab, setRightPanelTab] = useState<"toolbox" | "effects" | "chat">("chat");
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [isPreviewFullscreen, setPreviewFullscreen] = useState(false);
  const [currentLayout, setCurrentLayout] = useState<EditorLayoutPreset>("agentic");
  const layoutConfig = LAYOUT_PRESETS[currentLayout];

  const handleLayoutChange = useCallback((layout: EditorLayoutPreset) => {
    setCurrentLayout(layout);
    const config = LAYOUT_PRESETS[layout];
    if (config.defaultRightTab) {
      setRightPanelTab(config.defaultRightTab);
    }
  }, []);
  const recenterRef = useRef<(() => void) | null>(null);
  const previewRef = useRef<PreviewPanelHandle | null>(null);
  const loadRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<(() => void) | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const setAssetTabRef = useRef<((tab: "assets" | "templates" | "video" | "image" | "music" | "tts" | "jobs" | "branches") => void) | null>(null);

  const handleRecenterReady = useCallback((recenter: () => void) => {
    recenterRef.current = recenter;
  }, []);

  const handleLoadReady = useCallback((load: () => void) => {
    loadRef.current = load;
  }, []);

  const handleExportReady = useCallback((export_: () => void) => {
    exportRef.current = export_;
  }, []);

  const handleRefreshReady = useCallback((refresh: () => void) => {
    refreshRef.current = refresh;
  }, []);

  const handleAssetTabReady = useCallback((setTab: (tab: "assets" | "templates" | "video" | "image" | "music" | "tts" | "jobs" | "branches") => void) => {
    setAssetTabRef.current = setTab;
  }, []);

  // Switch to assets tab when an asset highlight is requested (e.g. from chat mention click)
  const highlightRequest = useAssetHighlightStore((s) => s.request);
  useEffect(() => {
    if (highlightRequest?.target.type === "asset") {
      setAssetTabRef.current?.("assets");
    }
  }, [highlightRequest]);

  // Connect to Zustand store
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);
  const isMuted = useProjectStore((s) => s.isMuted);
  const setMuted = useProjectStore((s) => s.setMuted);
  const isLooping = useProjectStore((s) => s.isLooping);
  const setLooping = useProjectStore((s) => s.setLooping);
  const playbackSpeed = useProjectStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useProjectStore((s) => s.setPlaybackSpeed);
  const project = useProjectStore((s) => s.project);
  const projectId = useProjectStore((s) => s.projectId);
  const layers = project.layers;
  const visibleLayers = useMemo(() => layers.filter((l) => !l.hidden), [layers]);

  // Proxy maskSrc URLs to avoid CORS issues with WebGL shaders in preview
  const layersWithProxiedMasks = useMemo(() => {
    return visibleLayers.map(layer => {
      if (layer.type !== 'video') return layer;
      return {
        ...layer,
        clips: layer.clips.map(clip => {
          const videoClip = clip as VideoClip;
          if (!videoClip.maskSrc) return clip;
          return {
            ...clip,
            maskSrc: getProxiedMediaUrl(videoClip.maskSrc),
          };
        }),
      };
    });
  }, [visibleLayers]);
  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const getDuration = useProjectStore((s) => s.getDuration);
  const hasUnsavedChanges = useProjectStore((s) => s.hasUnsavedChanges);
  const saveProject = useProjectStore((s) => s.saveProject);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const splitClipAtTime = useProjectStore((s) => s.splitClipAtTime);

  // Get assets and pipeline states to build transcriptions at runtime
  const assets = useAssetsStore((s) => s.assets);
  const { states: pipelineStates } = usePipelineStates(projectId);

  // Build transcriptions from pipeline metadata at runtime (not stored in project)
  const transcriptions = useMemo(() => {
    const result: Record<string, ProjectTranscription> = {};
    
    for (const asset of assets) {
      const steps = pipelineStates[asset.id];
      if (!steps) continue;
      
      const transcriptionStep = steps.find(s => s.id === "transcription" && s.status === "succeeded");
      if (!transcriptionStep?.metadata) continue;
      
      const { transcript, segments } = transcriptionStep.metadata as {
        transcript?: string;
        segments?: Array<{ start: number; speech: string }>;
      };
      
      if (!transcript && (!segments || segments.length === 0)) continue;
      
      result[asset.id] = {
        assetId: asset.id,
        assetName: asset.name,
        assetUrl: asset.url,
        transcript: transcript ?? "",
        segments: segments ?? [],
        status: "completed",
        languageCodes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    
    return result;
  }, [assets, pipelineStates]);

  const handleReloadBlocked = useCallback(() => {
    setReloadDialogOpen(true);
  }, []);

  const { allowReload } = usePageReloadBlocker({
    enabled: hasUnsavedChanges,
    onBlock: handleReloadBlocked,
  });

  useAutoSave({ intervalMs: 30_000, enabled: !!projectId });

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setReloadDialogOpen(false);
      setPendingReloadAction(null);
    }
  }, [hasUnsavedChanges]);

  const togglePlay = useCallback(() => {
    if (!player) return;
    player.togglePlayback();
  }, [player]);

  const handleTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time);
    },
    [setCurrentTime]
  );

  const handleToggleMute = useCallback(() => {
    if (!player) return;
    player.toggleAudio();
  }, [player]);

  const handleToggleLoop = useCallback(() => {
    if (!player) return;
    player.toggleLoop();
  }, [player]);

  const handleSpeedChange = useCallback(
    (value: number) => {
      if (!player) return;
      player.setSpeed(value);
    },
    [player]
  );

  const handleCancelReload = useCallback(() => {
    if (pendingReloadAction) return;
    setReloadDialogOpen(false);
  }, [pendingReloadAction]);

  const handleDiscardAndReload = useCallback(() => {
    if (pendingReloadAction) return;
    setPendingReloadAction("discard");
    allowReload();
    window.location.reload();
  }, [allowReload, pendingReloadAction]);

  const handleSaveAndReload = useCallback(async () => {
    if (pendingReloadAction) return;
    setPendingReloadAction("save");
    try {
      await Promise.resolve(saveProject());
      allowReload();
      window.location.reload();
    } catch (error) {
      console.error("Failed to save project before reload", error);
      setPendingReloadAction(null);
      setReloadDialogOpen(false);
    }
  }, [allowReload, pendingReloadAction, saveProject]);

  const isProcessingReload = pendingReloadAction !== null;

  useShortcuts([
    {
      key: " ",
      handler: togglePlay,
      preventDefault: true,
    },
    // Undo: Ctrl+Z (Windows/Linux) and Cmd+Z (Mac)
    {
      key: 'z',
      ctrlKey: true,
      handler: useProjectStore.getState().undo,
      preventDefault: true,
    },
    {
      key: 'z',
      metaKey: true,
      handler: useProjectStore.getState().undo,
      preventDefault: true,
    },
    // Redo: Ctrl+Shift+Z / Cmd+Shift+Z
    {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      handler: useProjectStore.getState().redo,
      preventDefault: true,
    },
    {
      key: 'z',
      metaKey: true,
      shiftKey: true,
      handler: useProjectStore.getState().redo,
      preventDefault: true,
    },
    // Redo: Ctrl+Y (Windows/Linux)
    {
      key: 'y',
      ctrlKey: true,
      handler: useProjectStore.getState().redo,
      preventDefault: true,
    },
    // Open/Load: Ctrl+O (Windows/Linux) and Cmd+O (Mac)
    {
      key: 'o',
      ctrlKey: true,
      handler: () => loadRef.current?.(),
      preventDefault: true,
    },
    {
      key: 'o',
      metaKey: true,
      handler: () => loadRef.current?.(),
      preventDefault: true,
    },
    // Export: Ctrl+E (Windows/Linux) and Cmd+E (Mac)
    {
      key: 'e',
      ctrlKey: true,
      handler: () => exportRef.current?.(),
      preventDefault: true,
    },
    {
      key: 'e',
      metaKey: true,
      handler: () => exportRef.current?.(),
      preventDefault: true,
    },
    // Save: Ctrl+S (Windows/Linux) and Cmd+S (Mac)
    {
      key: 's',
      ctrlKey: true,
      handler: () => {
        useProjectStore.getState().saveProject();
      },
      preventDefault: true,
    },
    {
      key: 's',
      metaKey: true,
      handler: () => {
        useProjectStore.getState().saveProject();
      },
      preventDefault: true,
    },
    // Recenter: 0 (works in normal and fullscreen view)
    {
      key: '0',
      handler: () => {
        previewRef.current?.recenter();
      },
      preventDefault: true,
    },
    // Fullscreen preview: F toggles (enter when not fullscreen, exit when fullscreen)
    {
      key: 'f',
      handler: () => {
        if (isPreviewFullscreen) {
          previewRef.current?.exitFullscreen();
        } else {
          previewRef.current?.enterFullscreen();
        }
      },
      preventDefault: true,
    },
    // Escape: exit fullscreen when in fullscreen, else deselect clip
    {
      key: 'Escape',
      handler: () => {
        if (isPreviewFullscreen) {
          previewRef.current?.exitFullscreen();
        } else {
          useProjectStore.getState().setSelectedClip(null);
        }
      },
      preventDefault: true,
    },
    // Render: Ctrl+Shift+R / Cmd+Shift+R
    {
      key: 'r',
      ctrlKey: true,
      shiftKey: true,
      handler: () => setRenderDialogOpen(true),
      preventDefault: true,
    },
    {
      key: 'r',
      metaKey: true,
      shiftKey: true,
      handler: () => setRenderDialogOpen(true),
      preventDefault: true,
    },
    // Shortcuts modal: Ctrl+/ or Cmd+/
    {
      key: '/',
      ctrlKey: true,
      handler: () => setShortcutsModalOpen((prev) => !prev),
      preventDefault: true,
    },
    {
      key: '/',
      metaKey: true,
      handler: () => setShortcutsModalOpen((prev) => !prev),
      preventDefault: true,
    },
    // Refresh project from Firebase: Alt+Shift+R / Option+Shift+R
    {
      key: 'r',
      altKey: true,
      shiftKey: true,
      handler: () => refreshRef.current?.(),
      preventDefault: true,
    },
    // Command menu: Ctrl+K / Cmd+K
    {
      key: 'k',
      ctrlKey: true,
      handler: () => setCommandMenuOpen((prev) => !prev),
      preventDefault: true,
    },
    {
      key: 'k',
      metaKey: true,
      handler: () => setCommandMenuOpen((prev) => !prev),
      preventDefault: true,
    },
    // Asset panel tabs: 1–8 (no modifiers; Cmd+1 etc. left to browser)
    {
      key: '1',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('assets');
          e.preventDefault();
        }
      },
    },
    {
      key: '2',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('templates');
          e.preventDefault();
        }
      },
    },
    {
      key: '3',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('video');
          e.preventDefault();
        }
      },
    },
    {
      key: '4',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('image');
          e.preventDefault();
        }
      },
    },
    {
      key: '5',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('music');
          e.preventDefault();
        }
      },
    },
    {
      key: '6',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('tts');
          e.preventDefault();
        }
      },
    },
    {
      key: '7',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('jobs');
          e.preventDefault();
        }
      },
    },
    {
      key: '8',
      handler: (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          setAssetTabRef.current?.('branches');
          e.preventDefault();
        }
      },
    },
    // Timeline: C = split clip at playhead
    {
      key: 'c',
      handler: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (selectedClipId) {
          splitClipAtTime(selectedClipId, currentTime);
          e.preventDefault();
        }
      },
    },
    // Timeline: V = Selection tool (Premiere-style)
    {
      key: 'v',
      handler: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setTimelineTool('selection');
        e.preventDefault();
      },
    },
    // Timeline: H = Hand tool (Premiere-style)
    {
      key: 'h',
      handler: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setTimelineTool('hand');
        e.preventDefault();
      },
    },
    // M = open / toggle voice chat
    {
      key: 'm',
      handler: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setShowVoiceChat((prev) => !prev);
        e.preventDefault();
      },
    },
  ]);

  useEffect(() => {
    if (!player) return;
    const unsubscribe = player.onStateChanged.subscribe((state) => {
      setIsPlaying(!state.paused);
      setMuted(state.muted);
      setLooping(state.loop);
      setPlaybackSpeed(state.speed);
    });
    return () => {
      unsubscribe?.();
    };
  }, [player, setIsPlaying, setLooping, setMuted, setPlaybackSpeed]);

  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [timelineTool, setTimelineTool] = useState<"selection" | "hand">("selection");
  // Position stores left (x) and bottom (distance from viewport bottom)
  const [voiceChatPosition, setVoiceChatPosition] = useState<{ left: number; bottom: number } | null>(null);
  const voiceChatPanelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    startLeft: number;
    startBottom: number;
    fromButton?: boolean;
  } | null>(null);
  const movedRef = useRef(false);

  const handleVoiceChatDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = voiceChatPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    // Calculate bottom position (distance from viewport bottom to element bottom)
    const bottom = viewportHeight - rect.bottom;
    const left = rect.left + rect.width / 2; // Center X
    setVoiceChatPosition({ left, bottom });
    movedRef.current = false;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startLeft: left,
      startBottom: bottom,
    };
  }, []);

  const handleVoiceButtonMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = voiceChatPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const bottom = viewportHeight - rect.bottom;
    const left = rect.left + rect.width / 2;
    setVoiceChatPosition({ left, bottom });
    movedRef.current = false;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startLeft: left,
      startBottom: bottom,
      fromButton: true,
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      movedRef.current = true;
      // Moving mouse down = bottom decreases, moving mouse right = left increases
      setVoiceChatPosition({
        left: start.startLeft + (e.clientX - start.mouseX),
        bottom: start.startBottom - (e.clientY - start.mouseY),
      });
    };
    const onUp = () => {
      const wasButton = dragStartRef.current?.fromButton;
      const wasClick = !movedRef.current;
      dragStartRef.current = null;
      if (wasButton && wasClick) {
        setShowVoiceChat(true);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <TopBar
          previewCanvas={previewCanvas}
          renderDialogOpen={renderDialogOpen}
          onRenderDialogOpenChange={setRenderDialogOpen}
          shortcutsModalOpen={shortcutsModalOpen}
          onShortcutsModalOpenChange={setShortcutsModalOpen}
          onOpenCommandMenu={() => setCommandMenuOpen(true)}
          onLoadReady={handleLoadReady}
          onExportReady={handleExportReady}
          onRefreshReady={handleRefreshReady}
          currentLayout={currentLayout}
          onLayoutChange={handleLayoutChange}
        />
        <div className="flex-1 min-h-0">
          <ResizablePanelGroup key={`layout-h-${currentLayout}`} direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={layoutConfig.mainPanelSize} minSize={60} className="min-w-0">
              <ResizablePanelGroup key={`layout-v-${currentLayout}`} direction="vertical" className="h-full">
                {/* Top Area: Assets | Preview | Settings */}
                <ResizablePanel defaultSize={layoutConfig.topAreaSize} minSize={30}>
                  <ResizablePanelGroup key={`layout-top-${currentLayout}`} direction="horizontal" className="h-full">
                    {/* Left: Assets */}
                    <ResizablePanel defaultSize={layoutConfig.assetsPanelSize} minSize={30} maxSize={50}>
                      <div className="h-full bg-card border-r border-border min-w-0">
                        <AssetsPanel onSetAssetTabReady={handleAssetTabReady} />
                      </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Center: Preview */}
                    <ResizablePanel defaultSize={layoutConfig.previewPanelSize} minSize={30} className="min-w-0">
                      <div className="h-full bg-card min-w-0">
                        <PreviewPanel
                          ref={previewRef}
                          onPlayerChange={setPlayer}
                          onCanvasReady={setPreviewCanvas}
                          onRecenterReady={handleRecenterReady}
                          onFullscreenChange={setPreviewFullscreen}
                          isPlaying={isPlaying}
                          onTogglePlay={togglePlay}
                          onSeek={setCurrentTime}
                          layers={layersWithProxiedMasks}
                          duration={getDuration()}
                          currentTime={currentTime}
                          onTimeUpdate={handleTimeUpdate}
                          transcriptions={transcriptions}
                          transitions={project.transitions ?? {}}
                          captionSettings={project.captionSettings}
                          textClipSettings={project.textClipSettings}
                          sceneConfig={{
                            resolution: project.resolution,
                            renderScale: project.previewRenderScale ?? 0.5,
                            background: project.background,
                          }}
                        />
                      </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Settings */}
                    <ResizablePanel defaultSize={layoutConfig.settingsPanelSize} minSize={15} maxSize={30}>
                      <div className="h-full bg-card border-l border-border min-w-[260px]">
                        <SettingsPanel />
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  handleClassName="h-3 w-4"
                  handleIconClassName="-rotate-90"
                />

                {/* Bottom: Timeline */}
                <ResizablePanel defaultSize={layoutConfig.timelineSize} minSize={20} className="min-w-0">
                  <div className="h-full w-full bg-card border-t border-border overflow-hidden">
                    <TooltipProvider delayDuration={300}>
                      <TimelinePanel
                        hasPlayer={!!player}
                        playing={isPlaying}
                        onTogglePlay={togglePlay}
                        muted={isMuted}
                        loop={isLooping}
                        speed={playbackSpeed}
                        onToggleMute={handleToggleMute}
                        onToggleLoop={handleToggleLoop}
                        onSpeedChange={handleSpeedChange}
                        timelineTool={timelineTool}
                        onTimelineToolChange={setTimelineTool}
                      />
                    </TooltipProvider>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>

            {layoutConfig.showRightPanel && (
              <>
                <ResizableHandle withHandle />

                {/* Persistent Rightmost Toolbox + Chat (tabbed, both stay mounted) */}
                <ResizablePanel defaultSize={layoutConfig.rightPanelSize} minSize={15} maxSize={40}>
                  <div className="h-full bg-card border-l border-border min-w-[260px] flex flex-col">
                    {/* Tab buttons */}
                    <div className="flex border-b border-border shrink-0">
                      <button
                        onClick={() => setRightPanelTab("toolbox")}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                          rightPanelTab === "toolbox"
                            ? "text-foreground border-b-2 border-primary bg-muted/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        }`}
                      >
                        <Wrench className="size-4" />
                        Toolbox
                      </button>
                      <button
                        onClick={() => setRightPanelTab("effects")}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                          rightPanelTab === "effects"
                            ? "text-foreground border-b-2 border-primary bg-muted/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        }`}
                      >
                        <Sparkles className="size-4" />
                        Effects
                      </button>
                      <button
                        onClick={() => setRightPanelTab("chat")}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                          rightPanelTab === "chat"
                            ? "text-foreground border-b-2 border-primary bg-muted/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        }`}
                      >
                        <MessageSquare className="size-4" />
                        Chat
                      </button>
                    </div>
                    {/* Tab content - all stay mounted, visibility controlled by CSS */}
                    <div className="flex-1 min-h-0 relative">
                      <div className={`absolute inset-0 ${rightPanelTab === "toolbox" ? "visible" : "invisible"}`}>
                        <ToolboxPanel />
                      </div>
                      <div className={`absolute inset-0 ${rightPanelTab === "effects" ? "visible" : "invisible"}`}>
                        <EffectsPanelWrapper />
                      </div>
                      <div className={`absolute inset-0 ${rightPanelTab === "chat" ? "visible" : "invisible"}`}>
                        <ChatPanel />
                      </div>
                    </div>
                  </div>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        {/* Floating Voice Chat - button expands into panel from bottom center */}
        <div
          ref={voiceChatPanelRef}
          className="fixed z-50 flex flex-col items-center"
          style={
            voiceChatPosition
              ? { left: voiceChatPosition.left, bottom: voiceChatPosition.bottom, transform: "translateX(-50%)" }
              : { bottom: "2rem", left: "50%", transform: "translateX(-50%)" }
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {showVoiceChat ? (
              <motion.div
                key="panel"
                layoutId="voice-chat-container"
                initial={{ opacity: 0, scaleX: 0.3, scaleY: 0.1 }}
                animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleX: 0.3, scaleY: 0.1 }}
                transition={{
                  type: "spring",
                  damping: 30,
                  stiffness: 400,
                  mass: 0.8,
                }}
                style={{ originX: 0.5, originY: 1 }}
                className="relative bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-zinc-700/50 shadow-2xl w-[320px] min-w-[280px] overflow-hidden"
              >
                {/* Drag handle - top bar */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  onMouseDown={handleVoiceChatDragStart}
                  className="flex items-center justify-center gap-1 py-2 px-4 cursor-grab active:cursor-grabbing border-b border-zinc-700/50 text-zinc-400 hover:text-zinc-300 select-none"
                >
                  <GripVertical className="size-4" />
                  <span className="text-xs font-medium">Voice Assistant</span>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="p-6 pt-4"
                >
                  <button
                    onClick={() => setShowVoiceChat(false)}
                    className="absolute top-[6px] right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <X className="size-5" />
                  </button>
                  <VoiceChat />
                </motion.div>
                <div className="flex items-center justify-center gap-1.5 py-2 px-4 border-t border-zinc-700/50 bg-zinc-900/50">
                  <img src="/gemini-logo.png" alt="" className="size-3.5 opacity-70" aria-hidden />
                  <span className="text-[10px] text-zinc-500">Powered by Gemini Live Audio</span>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="button"
                layoutId="voice-chat-container"
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  type: "spring",
                  damping: 25,
                  stiffness: 350,
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onMouseDown={handleVoiceButtonMouseDown}
                className="flex items-center justify-center gap-2 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600/50 shadow-lg text-zinc-300 hover:text-white px-4 py-3 cursor-grab active:cursor-grabbing"
                title="Voice"
              >
                <Mic className="size-5" />
                <span className="text-sm font-medium">Voice</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Dialog
        open={isReloadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelReload();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Unsaved changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved edits. Save your project before reloading, or reload anyway to
              discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelReload}
              disabled={isProcessingReload}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleDiscardAndReload}
              disabled={isProcessingReload}
            >
              {pendingReloadAction === "discard" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Reload anyway
            </Button>
            <Button onClick={handleSaveAndReload} disabled={isProcessingReload}>
              {pendingReloadAction === "save" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Save & reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
        onSave={() => useProjectStore.getState().saveProject()}
        onLoad={() => loadRef.current?.()}
        onExport={() => exportRef.current?.()}
        onRefresh={() => refreshRef.current?.()}
        onRender={() => setRenderDialogOpen(true)}
        onTogglePlay={togglePlay}
        onToggleMute={handleToggleMute}
        onToggleLoop={handleToggleLoop}
        onRecenter={() => previewRef.current?.recenter()}
        onEnterFullscreen={() => previewRef.current?.enterFullscreen()}
        onExitFullscreen={() => previewRef.current?.exitFullscreen()}
        onShowShortcuts={() => setShortcutsModalOpen(true)}
        onOpenToolbox={() => setRightPanelTab("toolbox")}
        onOpenChat={() => setRightPanelTab("chat")}
        onToggleVoice={() => setShowVoiceChat((prev) => !prev)}
        isPlaying={isPlaying}
        isMuted={isMuted}
        isLooping={isLooping}
        isFullscreen={isPreviewFullscreen}
      />
    </>
  );
}
