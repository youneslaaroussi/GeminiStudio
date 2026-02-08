"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Player } from "@motion-canvas/core";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderOpen, MessageSquare, Film, Monitor, Save, Check, Copy, LogOut, Plus, RefreshCw, Settings, CreditCard, Loader2 } from "lucide-react";
import { AssetsPanel } from "./assets";
import { ChatPanel } from "./ChatPanel";
import { PreviewPanel, type PreviewPanelHandle } from "./PreviewPanel";
import { RenderDialog } from "./RenderDialog";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { usePipelineStates } from "@/app/lib/hooks/usePipelineStates";
import { useAutoSave } from "@/app/lib/hooks/useAutoSave";
import { usePlaybackResolvedLayers } from "@/app/lib/hooks/usePlaybackResolvedLayers";
import type { ProjectTranscription } from "@/app/types/transcription";
import { Button } from "@/components/ui/button";
import { useRender } from "@/app/hooks/useRender";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useCredits } from "@/app/lib/hooks/useCredits";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { captureThumbnail } from "@/app/lib/utils/thumbnail";
import { MobileTimelineControls } from "./MobileTimelineControls";

function userInitials(user: { displayName?: string | null; email?: string | null }): string {
  if (user.displayName) {
    const parts = user.displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    if (parts[0]!.length) return parts[0]!.slice(0, 2).toUpperCase();
  }
  const e = (user.email ?? "").trim();
  if (e) return e.slice(0, 2).toUpperCase();
  return "?";
}

export function MobileEditorLayout() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { credits, refresh, loading: creditsLoading } = useCredits(user?.uid);
  const [player, setPlayer] = useState<Player | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [isPreviewFullscreen, setPreviewFullscreen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const previewRef = useRef<PreviewPanelHandle | null>(null);
  const setAssetTabRef = useRef<((tab: "assets" | "templates" | "video" | "image" | "music" | "tts" | "components" | "jobs" | "branches") => void) | null>(null);

  const handleAssetTabReady = useCallback((setTab: (tab: "assets" | "templates" | "video" | "image" | "music" | "tts" | "components" | "jobs" | "branches") => void) => {
    setAssetTabRef.current = setTab;
  }, []);

  const handleRecenterReady = useCallback((recenter: () => void) => {
    // Store if needed
  }, []);

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

  const { layers: playbackResolvedLayers } = usePlaybackResolvedLayers(visibleLayers, projectId);

  const layersWithProxiedMasks = useMemo(() => playbackResolvedLayers, [playbackResolvedLayers]);
  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const getDuration = useProjectStore((s) => s.getDuration);

  useAutoSave({ intervalMs: 30_000, enabled: !!projectId });

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

  const { isRendering, jobStatus } = useRender();
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const updateListProject = useProjectsListStore((s) => s.updateProject);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    setAvatarImgError(false);
  }, [user?.photoURL]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [currentUrl]);

  const handleHome = useCallback(() => {
    router.push('/app');
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      router.push('/auth/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, [logout, router]);

  const handleAddCredits = useCallback(() => {
    router.push('/settings/billing');
  }, [router]);

  const handleRefreshCredits = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return;

    try {
      // Capture thumbnail if canvas is available
      let thumbnail: string | null = null;
      if (previewCanvas) {
        thumbnail = await captureThumbnail(previewCanvas);
      }

      // Save project (this now manages saveStatus internally)
      useProjectStore.getState().saveProject();

      // Update projects list with thumbnail and name
      if (projectId && user?.uid) {
        await updateListProject(projectId, {
          name: project.name,
          ...(thumbnail && { thumbnail }),
        }, user.uid);
      }

      console.log("Project saved locally");
    } catch (error) {
      console.error("Failed to save project:", error);
    }
  }, [saveStatus, previewCanvas, projectId, project.name, updateListProject, user?.uid]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Banner */}
      <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-xs text-amber-600 dark:text-amber-400 flex-1">
          This app works better on desktop
        </p>
        <Button
          onClick={handleCopyLink}
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs shrink-0"
        >
          {copied ? (
            <>
              <Check className="size-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3 mr-1" />
              Copy link
            </>
          )}
        </Button>
      </div>

      {/* Top Bar */}
      <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur px-3 py-2">
        <div className="flex items-center justify-between">
          {/* Left: Logo & Branding */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleHome}
              className="rounded-md p-1 hover:bg-accent transition-colors shrink-0"
              title="Back to projects"
            >
              <img src="/gemini-logo.png" alt="Gemini Studio" className="size-6" />
            </button>
            <span className="text-sm font-semibold text-foreground">Gemini Studio</span>
          </div>

          {/* Right: Save Button, Credits & Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={handleSave}
              disabled={isBusy || saveStatus === 'saving'}
              size="sm"
              className={cn(
                "h-8 px-3 text-xs font-medium",
                saveStatus === 'saved'
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-primary hover:bg-primary/90"
              )}
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="size-3 mr-1.5 animate-spin" />
              ) : saveStatus === 'saved' ? (
                <Check className="size-3 mr-1.5" />
              ) : (
                <Save className="size-3 mr-1.5" />
              )}
              {saveStatus === 'saved' ? "Saved" : "Save"}
            </Button>
            {/* Credits */}
            <div className="inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-1 text-xs">
              <CreditCard className="size-3 text-muted-foreground mr-1" />
              <span className="font-medium tabular-nums">{credits}</span>
              <span className="text-muted-foreground ml-1 hidden sm:inline">R‑Credits</span>
            </div>

            {/* Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="User menu"
                >
                  <Avatar className="size-7 border border-border">
                    {user?.photoURL && !avatarImgError ? (
                      <AvatarImage
                        src={user.photoURL}
                        alt={user.displayName ?? ""}
                        onError={() => setAvatarImgError(true)}
                      />
                    ) : null}
                    <AvatarFallback className="text-xs">{user ? userInitials(user) : "?"}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium truncate">{user?.email ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">
                      {credits} R‑Credits
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleAddCredits}>
                  <Plus className="size-4 mr-2" />
                  Add credits
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRefreshCredits} disabled={creditsLoading}>
                  <RefreshCw className={cn("size-4 mr-2", creditsLoading && "animate-spin")} />
                  Refresh credits
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
                  <Settings className="size-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} variant="destructive">
                  <LogOut className="size-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Render Progress Bar */}
      {isRendering && (
        <div className="shrink-0 w-full h-1 bg-slate-800">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${jobStatus?.progress ?? 0}%` }}
          />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full shrink-0 rounded-none border-b border-border bg-card h-auto p-1">
          <TabsTrigger value="chat" className="flex-1 text-xs sm:text-sm">
            <MessageSquare className="size-4" />
            <span className="ml-1 sm:ml-2">Chat</span>
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex-1 text-xs sm:text-sm">
            <Monitor className="size-4" />
            <span className="ml-1 sm:ml-2">Preview</span>
          </TabsTrigger>
          <TabsTrigger value="assets" className="flex-1 text-xs sm:text-sm">
            <FolderOpen className="size-4" />
            <span className="ml-1 sm:ml-2">Assets</span>
          </TabsTrigger>
          <TabsTrigger value="render" className="flex-1 text-xs sm:text-sm">
            <Film className="size-4" />
            <span className="ml-1 sm:ml-2">Render</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab content - all stay mounted, visibility controlled by CSS */}
        <div className="flex-1 min-h-0 relative">
          <div className={cn("absolute inset-0", activeTab === "chat" ? "visible" : "invisible pointer-events-none")}>
            <div className="h-full w-full bg-card overflow-hidden">
              <ChatPanel />
            </div>
          </div>
          <div className={cn("absolute inset-0 flex flex-col", activeTab === "preview" ? "visible" : "invisible pointer-events-none")}>
            <div className="flex-1 min-h-0 bg-card overflow-hidden">
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
            <MobileTimelineControls
              hasPlayer={!!player}
              playing={isPlaying}
              onTogglePlay={togglePlay}
              muted={isMuted}
              loop={isLooping}
              speed={playbackSpeed}
              onToggleMute={() => setMuted(!isMuted)}
              onToggleLoop={() => setLooping(!isLooping)}
              onSpeedChange={setPlaybackSpeed}
              currentTime={currentTime}
              duration={getDuration()}
              onSeek={setCurrentTime}
            />
          </div>
          <div className={cn("absolute inset-0", activeTab === "assets" ? "visible" : "invisible pointer-events-none")}>
            <div className="h-full w-full bg-card overflow-hidden">
              <AssetsPanel onSetAssetTabReady={handleAssetTabReady} />
            </div>
          </div>
          <div className={cn("absolute inset-0", activeTab === "render" ? "visible" : "invisible pointer-events-none")}>
            <ScrollArea className="h-full w-full">
              <div className="p-4 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold mb-2">Render Video</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Export your project as a video file.
                  </p>
                </div>

                {isRendering && (
                  <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Rendering in progress</span>
                      <span className="text-sm text-muted-foreground">{jobStatus?.progress ?? 0}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${jobStatus?.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => setRenderDialogOpen(true)}
                  disabled={isRendering}
                  className="w-full"
                  size="lg"
                >
                  <Film className="size-4 mr-2" />
                  {isRendering ? `Rendering... ${jobStatus?.progress ?? 0}%` : "Open Render Dialog"}
                </Button>

                {projectId && (
                  <RenderDialog
                    open={renderDialogOpen}
                    onOpenChange={setRenderDialogOpen}
                    project={project}
                    projectId={projectId}
                  />
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
