"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  RefreshCw,
  FolderOpen,
  Video,
  ImageIcon,
  Music,
  Volume2,
  ListTodo,
  GitBranch,
  Circle,
  Search,
  X,
  LayoutTemplate,
} from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { createVideoClip, createAudioClip, createImageClip } from "@/app/types/timeline";
import type { RemoteAsset } from "@/app/types/assets";
import type { VeoJob } from "@/app/types/veo";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { useVideoEffectsStore } from "@/app/lib/store/video-effects-store";
import { useAssets } from "./useAssets";
import { AssetList } from "./AssetList";
import { UploadZone } from "./UploadZone";
import { UploadDialog } from "./dialogs/UploadDialog";
import { TranscriptDialog } from "./dialogs/TranscriptDialog";
import { AssetDetailsDialog } from "./dialogs/AssetDetailsDialog";
import { VidovaModal } from "./dialogs/VidovaModal";
import { usePipelinePolling } from "@/app/lib/hooks/usePipelinePolling";
import { usePipelineStates } from "@/app/lib/hooks/usePipelineStates";

import {
  VideoPanel,
  ImagePanel,
  MusicPanel,
  TtsPanel,
  JobsPanel,
  BranchesPanel,
  TemplatesPanel,
} from "./panels";

type TabId = "assets" | "templates" | "video" | "image" | "music" | "tts" | "jobs" | "branches";

interface TabConfig {
  id: TabId;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
}

const TABS: TabConfig[] = [
  { id: "assets", icon: FolderOpen, label: "Assets", shortcut: "1" },
  { id: "templates", icon: LayoutTemplate, label: "Templates", shortcut: "2" },
  { id: "video", icon: Video, label: "Video", shortcut: "3" },
  { id: "image", icon: ImageIcon, label: "Image", shortcut: "4" },
  { id: "music", icon: Music, label: "Music", shortcut: "5" },
  { id: "tts", icon: Volume2, label: "Speech", shortcut: "6" },
  { id: "jobs", icon: ListTodo, label: "Jobs", shortcut: "7" },
  { id: "branches", icon: GitBranch, label: "Branches", shortcut: "8" },
];

interface AssetsPanelProps {
  onSetAssetTabReady?: (setTab: (tab: TabId) => void) => void;
}

export function AssetsPanel({ onSetAssetTabReady }: AssetsPanelProps) {
  const {
    assets,
    isLoading,
    error,
    transcriptions,
    metadata,
    projectId,
    fetchAssets,
    addAssets,
    renameAsset,
    updateAssetNotes,
    reorderAssets,
    deleteAsset,
    deleteAssets,
    resolveAssetDuration,
    startTranscription,
    transcodingAssetIds,
    markAssetsTranscoding,
    // Search
    searchQuery,
    searchResults,
    isSearching,
    searchAssets,
    clearSearch,
  } = useAssets();

  // Search input state (debounced)
  const [searchInput, setSearchInput] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (!value.trim()) {
        clearSearch();
        return;
      }
      searchTimeoutRef.current = setTimeout(() => {
        void searchAssets(value);
      }, 300);
    },
    [searchAssets, clearSearch]
  );

  // Filter assets based on search results
  const displayedAssets = searchResults
    ? assets.filter((asset) => searchResults.some((r) => r.id === asset.id))
    : assets;

  // Pipeline states for all assets (for Jobs tab)
  const { states: pipelineStates, refresh: refreshPipelineStates } = usePipelineStates(projectId);

  const addClip = useProjectStore((s) => s.addClip);
  const getDuration = useProjectStore((s) => s.getDuration);

  // Veo jobs tracking
  const [veoJobs, setVeoJobs] = useState<VeoJob[]>([]);
  const veoPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for Veo job updates
  const pollVeoJobs = useCallback(async () => {
    const pendingJobs = veoJobs.filter((j) => j.status === "pending" || j.status === "running");
    if (pendingJobs.length === 0) return;

    const updatedJobs = await Promise.all(
      pendingJobs.map(async (job) => {
        try {
          const authHeaders = await getAuthHeaders();
          const response = await fetch(`/api/veo/${job.id}`, {
            headers: authHeaders as Record<string, string>,
          });
          const data = (await response.json()) as { job?: VeoJob; error?: string };
          if (data.job) {
            // If completed, trigger asset refresh and show toast
            if (data.job.status === "completed" && job.status !== "completed") {
              void fetchAssets();
              toast.success("Video generation complete!", {
                description: "Your video is ready in the Assets tab.",
              });
            } else if (data.job.status === "error" && job.status !== "error") {
              toast.error("Video generation failed", {
                description: data.job.error || "Unknown error",
              });
            }
            return data.job;
          }
        } catch {
          // Keep the old job if fetch fails
        }
        return job;
      })
    );

    setVeoJobs((prev) =>
      prev.map((job) => {
        const updated = updatedJobs.find((u) => u.id === job.id);
        return updated || job;
      })
    );
  }, [veoJobs, fetchAssets]);

  // Start polling when there are pending jobs
  useEffect(() => {
    const hasPendingJobs = veoJobs.some((j) => j.status === "pending" || j.status === "running");

    if (hasPendingJobs && !veoPollingRef.current) {
      veoPollingRef.current = setInterval(() => {
        void pollVeoJobs();
      }, 12000);
    } else if (!hasPendingJobs && veoPollingRef.current) {
      clearInterval(veoPollingRef.current);
      veoPollingRef.current = null;
    }

    return () => {
      if (veoPollingRef.current) {
        clearInterval(veoPollingRef.current);
        veoPollingRef.current = null;
      }
    };
  }, [veoJobs, pollVeoJobs]);

  // Handle new Veo job started
  const handleVeoJobStarted = useCallback((job: VeoJob) => {
    setVeoJobs((prev) => [job, ...prev]);
  }, []);

  // Active tab (declared before fetchVeoJobsForProject / useEffect that depend on it)
  const [activeTab, setActiveTab] = useState<TabId>("assets");

  // Expose setActiveTab to parent for keyboard shortcuts (1–8)
  useEffect(() => {
    onSetAssetTabReady?.(setActiveTab);
    return () => {
      onSetAssetTabReady?.(() => {});
    };
  }, [onSetAssetTabReady]);

  // Fetch Veo jobs for project (so agent-started jobs appear in Jobs tab)
  const fetchVeoJobsForProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/veo?projectId=${encodeURIComponent(projectId)}`, {
        headers: authHeaders as Record<string, string>,
      });
      if (!response.ok) return;
      const data = (await response.json()) as { jobs?: VeoJob[] };
      const apiJobs = data.jobs ?? [];
      setVeoJobs((prev) => {
        const byId = new Map(apiJobs.map((j) => [j.id, j]));
        prev.forEach((j) => {
          if (!byId.has(j.id)) byId.set(j.id, j);
        });
        return Array.from(byId.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    } catch {
      // Ignore fetch errors
    }
  }, [projectId]);

  // Always fetch Veo jobs for project (on mount + periodically) so agent-started jobs appear and we poll regardless of tab
  useEffect(() => {
    if (!projectId) return;
    void fetchVeoJobsForProject();
    const interval = setInterval(fetchVeoJobsForProject, 40000);
    return () => clearInterval(interval);
  }, [projectId, fetchVeoJobsForProject]);

  // Video effect jobs from store (filter by project for Jobs tab)
  const videoEffectsJobsRecord = useVideoEffectsStore((s) => s.jobs);
  const upsertVideoEffectJob = useVideoEffectsStore((s) => s.upsertJob);
  const videoEffectJobs = useMemo((): VideoEffectJob[] => {
    const list = Object.values(videoEffectsJobsRecord);
    return projectId ? list.filter((j) => j.projectId === projectId) : list;
  }, [projectId, videoEffectsJobsRecord]);

  // Always poll pending video effect jobs (regardless of tab or selected clip)
  const videoEffectPollingRef = useRef<NodeJS.Timeout | null>(null);
  const pollVideoEffectJobs = useCallback(async () => {
    const pending = videoEffectJobs.filter(
      (j) => j.status === "pending" || j.status === "running"
    );
    if (pending.length === 0) return;
    for (const job of pending) {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`/api/video-effects/${job.id}`, {
          headers: authHeaders as Record<string, string>,
        });
        if (!response.ok) {
          if (response.status === 404) continue;
          return;
        }
        const payload = (await response.json()) as { job?: VideoEffectJob };
        if (payload.job) {
          upsertVideoEffectJob(payload.job);
          if (payload.job.status === "completed") {
            toast.success("Video effect completed", {
              description: payload.job.effectLabel,
            });
            void fetchAssets();
          } else if (payload.job.status === "error") {
            toast.error("Video effect failed", {
              description: payload.job.error ?? "Please try again.",
            });
          }
        }
      } catch {
        // Keep polling on next interval
      }
    }
  }, [videoEffectJobs, upsertVideoEffectJob, fetchAssets]);

  useEffect(() => {
    const hasPending = videoEffectJobs.some(
      (j) => j.status === "pending" || j.status === "running"
    );
    if (hasPending && !videoEffectPollingRef.current) {
      void pollVideoEffectJobs();
      videoEffectPollingRef.current = setInterval(pollVideoEffectJobs, 20000);
    } else if (!hasPending && videoEffectPollingRef.current) {
      clearInterval(videoEffectPollingRef.current);
      videoEffectPollingRef.current = null;
    }
    return () => {
      if (videoEffectPollingRef.current) {
        clearInterval(videoEffectPollingRef.current);
        videoEffectPollingRef.current = null;
      }
    };
  }, [videoEffectJobs, pollVideoEffectJobs]);

  // Dialog states (keeping transcript and details as dialogs)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [vidovaModalOpen, setVidovaModalOpen] = useState(false);
  const [transcriptDialogAssetId, setTranscriptDialogAssetId] = useState<string | null>(null);
  const [detailsDialogAssetId, setDetailsDialogAssetId] = useState<string | null>(null);


  // Count running jobs for badge
  const runningVeoCount = veoJobs.filter((j) => j.status === "pending" || j.status === "running").length;
  const runningVideoEffectCount = videoEffectJobs.filter(
    (j) => j.status === "pending" || j.status === "running"
  ).length;
  const runningJobsCount = runningVeoCount + runningVideoEffectCount;

  // Handle files from dropzone
  const handleFilesSelected = useCallback((files: File[]) => {
    setUploadInitialFiles(files);
    setUploadDialogOpen(true);
  }, []);

  const handleUploadComplete = useCallback(
    (newAssets: RemoteAsset[], options?: { transcodeStarted?: boolean; convertStarted?: boolean }) => {
      addAssets(newAssets);
      // Mark assets as processing if transcode or convert started
      if ((options?.transcodeStarted || options?.convertStarted) && newAssets.length > 0) {
        markAssetsTranscoding(newAssets.map((a) => a.id));
      }
      void fetchAssets();
    },
    [addAssets, fetchAssets, markAssetsTranscoding]
  );

  // Handle generated asset
  const handleGenerated = useCallback(
    (asset: RemoteAsset) => {
      addAssets([asset]);
      void fetchAssets();
      // Switch to assets tab to see the new asset
      setActiveTab("assets");
    },
    [addAssets, fetchAssets]
  );

  // Add asset to timeline
  const handleAddToTimeline = useCallback(
    (asset: RemoteAsset) => {
      const duration = resolveAssetDuration(asset);
      const name = asset.name || "Asset";
      const start = getDuration();
      const assetMetadata = metadata[asset.id];
      // For video/audio, use the resolved duration as the source duration
      const sourceDuration = (asset.type === "video" || asset.type === "audio" || asset.type === "other") 
        ? duration 
        : undefined;
      const clipOptions = {
        assetId: asset.id,
        width: asset.width ?? assetMetadata?.width,
        height: asset.height ?? assetMetadata?.height,
        sourceDuration,
      };

      if (asset.type === "video" || asset.type === "other") {
        addClip(createVideoClip(asset.url, name, start, duration, clipOptions));
      } else if (asset.type === "audio") {
        addClip(createAudioClip(asset.url, name, start, duration, { assetId: asset.id, sourceDuration }));
      } else {
        addClip(createImageClip(asset.url, name, start, duration, clipOptions));
      }
    },
    [addClip, getDuration, resolveAssetDuration, metadata]
  );


  // Get data for dialogs
  const transcriptDialogData = transcriptDialogAssetId
    ? transcriptions[transcriptDialogAssetId]
    : null;

  const detailsDialogAsset = detailsDialogAssetId
    ? assets.find((a) => a.id === detailsDialogAssetId)
    : null;

  // Fetch pipeline state for the asset details dialog
  const { state: pipelineState, isLoading: pipelineLoading, refresh: refreshPipelineState } =
    usePipelinePolling(detailsDialogAssetId, projectId, {
      enabled: !!detailsDialogAssetId,
    });
  const detailsDialogSteps = pipelineState?.steps ?? [];

  const detailsDialogTranscription = detailsDialogAssetId
    ? transcriptions[detailsDialogAssetId]
    : undefined;

  return (
    <>
      <div className="flex h-full">
        {/* Vertical Tab Bar */}
        <TooltipProvider delayDuration={300}>
          <div className="w-11 shrink-0 border-r border-border bg-muted/30 flex flex-col items-center py-2 gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showBadge = tab.id === "jobs" && runningJobsCount > 0;

              return (
                <Tooltip key={tab.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "relative size-8 rounded-md flex items-center justify-center transition-all duration-150",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="size-4" />
                      {showBadge && (
                        <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-blue-500 text-[9px] font-medium text-white flex items-center justify-center">
                          {runningJobsCount > 9 ? "9+" : runningJobsCount}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    <span>{tab.label}</span>
                    {tab.shortcut && (
                      <span className="ml-2 text-muted-foreground text-[10px]">
                        {tab.shortcut}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Panel Content - All panels stay mounted for state persistence */}
        <div className="flex-1 min-w-0 relative">
          {/* Assets Panel */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col",
              activeTab !== "assets" && "invisible pointer-events-none"
            )}
          >
            {/* Upload Zone + Record */}
            <div className="p-3 border-b border-border flex flex-col gap-2">
              <div className="flex items-stretch gap-2">
                <div className="flex-1 min-w-0">
                  <UploadZone onFilesSelected={handleFilesSelected} compact />
                </div>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 h-full gap-1.5 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 hover:border-rose-300 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/50 dark:hover:text-rose-300"
                        onClick={() => setVidovaModalOpen(true)}
                      >
                        <Circle className="size-3 fill-current" />
                        <span className="text-xs font-medium">Record</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Record with Vidova
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Search + Asset List */}
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Search Input */}
              <div className="px-3 py-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search assets..."
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {(searchInput || isSearching) && (
                    <button
                      onClick={() => {
                        setSearchInput("");
                        clearSearch();
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {isSearching ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {searchResults
                    ? `${displayedAssets.length} result${displayedAssets.length !== 1 ? "s" : ""}`
                    : `${assets.length} asset${assets.length !== 1 ? "s" : ""}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void fetchAssets()}
                >
                  <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
                </Button>
              </div>
              <ScrollArea className="flex-1 min-h-0 overflow-hidden">
                <AssetList
                  assets={displayedAssets}
                  isLoading={isLoading}
                  error={error}
                  metadata={metadata}
                  transcriptions={transcriptions}
                  resolveAssetDuration={resolveAssetDuration}
                  onAddToTimeline={handleAddToTimeline}
                  onStartTranscription={startTranscription}
                  onViewTranscription={setTranscriptDialogAssetId}
                  onViewDetails={setDetailsDialogAssetId}
                  onRename={renameAsset}
                  onReorder={reorderAssets}
                  onDelete={deleteAsset}
                  onDeleteMany={deleteAssets}
                  onRefresh={fetchAssets}
                  transcodingAssetIds={transcodingAssetIds}
                />
              </ScrollArea>
            </div>

          </div>

          {/* Templates Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "templates" && "invisible pointer-events-none"
            )}
          >
            <TemplatesPanel projectId={projectId} />
          </div>

          {/* Video Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "video" && "invisible pointer-events-none"
            )}
          >
            <VideoPanel projectId={projectId} onJobStarted={handleVeoJobStarted} />
          </div>

          {/* Image Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "image" && "invisible pointer-events-none"
            )}
          >
            <ImagePanel projectId={projectId} onGenerated={handleGenerated} />
          </div>

          {/* Music Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "music" && "invisible pointer-events-none"
            )}
          >
            <MusicPanel projectId={projectId} onGenerated={handleGenerated} />
          </div>

          {/* TTS Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "tts" && "invisible pointer-events-none"
            )}
          >
            <TtsPanel projectId={projectId} onGenerated={handleGenerated} />
          </div>

          {/* Jobs Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "jobs" && "invisible pointer-events-none"
            )}
          >
            <JobsPanel
              assets={assets}
              pipelineStates={pipelineStates}
              veoJobs={veoJobs}
              videoEffectJobs={videoEffectJobs}
              onRefresh={() => {
                fetchAssets();
                refreshPipelineStates();
                void fetchVeoJobsForProject();
              }}
              isLoading={isLoading}
            />
          </div>

          {/* Branches Panel */}
          <div
            className={cn(
              "absolute inset-0",
              activeTab !== "branches" && "invisible pointer-events-none"
            )}
          >
            <BranchesPanel projectId={projectId} />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <UploadDialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) {
            setUploadInitialFiles([]);
          }
        }}
        initialFiles={uploadInitialFiles}
        projectId={projectId}
        onUploadComplete={handleUploadComplete}
      />

      <TranscriptDialog
        open={!!transcriptDialogAssetId}
        onOpenChange={(open) => !open && setTranscriptDialogAssetId(null)}
        transcription={transcriptDialogData ?? null}
      />

      <AssetDetailsDialog
        open={!!detailsDialogAssetId}
        onOpenChange={(open) => !open && setDetailsDialogAssetId(null)}
        asset={detailsDialogAsset ?? null}
        projectId={projectId}
        pipelineSteps={detailsDialogSteps}
        pipelineLoading={pipelineLoading}
        transcription={detailsDialogTranscription}
        onPipelineRefresh={fetchAssets}
        onRefreshPipeline={refreshPipelineState}
        onUpdateNotes={updateAssetNotes}
      />

      <VidovaModal open={vidovaModalOpen} onOpenChange={setVidovaModalOpen} />
    </>
  );
}
