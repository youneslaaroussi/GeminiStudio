"use client";

import type { Player } from "@motion-canvas/core";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, GripVertical, Loader2, Wrench, MessageSquare, Mic, X } from "lucide-react";
import { AssetsPanel } from "./assets";
import { PreviewPanel } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import { SettingsPanel } from "./settings";
import { TopBar } from "./TopBar";
import { ChatPanel } from "./ChatPanel";
import { ToolboxPanel } from "./ToolboxPanel";
import { motion, AnimatePresence } from "motion/react";
import { VoiceChat } from "@/app/components/VoiceChat";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useShortcuts } from "@/app/hooks/use-shortcuts";
import { usePageReloadBlocker } from "@/app/hooks/use-page-reload-blocker";

export function EditorLayout() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [isReloadDialogOpen, setReloadDialogOpen] = useState(false);
  const [pendingReloadAction, setPendingReloadAction] = useState<
    "save" | "discard" | null
  >(null);
  const [rightPanelTab, setRightPanelTab] = useState<"toolbox" | "chat">("chat");

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
  const layers = project.layers;
  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const getDuration = useProjectStore((s) => s.getDuration);
  const hasUnsavedChanges = useProjectStore((s) => s.hasUnsavedChanges);
  const saveProject = useProjectStore((s) => s.saveProject);

  const handleReloadBlocked = useCallback(() => {
    setReloadDialogOpen(true);
  }, []);

  const { allowReload } = usePageReloadBlocker({
    enabled: hasUnsavedChanges,
    onBlock: handleReloadBlocked,
  });

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
    {
      key: 'z',
      ctrlKey: true,
      handler: useProjectStore.getState().undo,
      preventDefault: true,
    },
    {
      key: 'y',
      ctrlKey: true,
      handler: useProjectStore.getState().redo,
      preventDefault: true,
    },
    {
      key: 'Escape',
      handler: () => useProjectStore.getState().setSelectedClip(null),
      preventDefault: true,
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
        <TopBar previewCanvas={previewCanvas} />
        <div className="flex-1 min-h-0">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={78} minSize={60} className="min-w-0">
              <ResizablePanelGroup direction="vertical" className="h-full">
                {/* Top Area: Assets | Preview | Settings */}
                <ResizablePanel defaultSize={60} minSize={30}>
                  <ResizablePanelGroup direction="horizontal" className="h-full">
                    {/* Left: Assets */}
                    <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
                      <div className="h-full bg-card border-r border-border min-w-0">
                        <AssetsPanel />
                      </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Center: Preview */}
                    <ResizablePanel defaultSize={60} minSize={30} className="min-w-0">
                      <div className="h-full bg-card min-w-0">
                        <PreviewPanel
                          onPlayerChange={setPlayer}
                          onCanvasReady={setPreviewCanvas}
                          layers={layers}
                          duration={getDuration()}
                          currentTime={currentTime}
                          onTimeUpdate={handleTimeUpdate}
                          transcriptions={project.transcriptions ?? {}}
                          transitions={project.transitions ?? {}}
                          captionSettings={project.captionSettings}
                          textClipSettings={project.textClipSettings}
                          sceneConfig={{
                            resolution: project.resolution,
                            renderScale: project.renderScale,
                            background: project.background,
                          }}
                        />
                      </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Settings */}
                    <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
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
                <ResizablePanel defaultSize={40} minSize={20} className="min-w-0">
                  <div className="h-full w-full bg-card border-t border-border overflow-hidden">
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
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Persistent Rightmost Toolbox + Chat (tabbed, both stay mounted) */}
            <ResizablePanel defaultSize={22} minSize={15} maxSize={40}>
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
                {/* Tab content - both stay mounted, visibility controlled by CSS */}
                <div className="flex-1 min-h-0 relative">
                  <div className={`absolute inset-0 ${rightPanelTab === "toolbox" ? "visible" : "invisible"}`}>
                    <ToolboxPanel />
                  </div>
                  <div className={`absolute inset-0 ${rightPanelTab === "chat" ? "visible" : "invisible"}`}>
                    <ChatPanel />
                  </div>
                </div>
              </div>
            </ResizablePanel>
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
    </>
  );
}
