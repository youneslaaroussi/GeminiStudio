"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  RefreshCw,
  Type,
  FolderOpen,
  Video,
  ImageIcon,
  Music,
  Volume2,
  ListTodo,
  GitBranch,
} from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { createTextClip, createVideoClip, createAudioClip, createImageClip } from "@/app/types/timeline";
import type { RemoteAsset } from "@/app/types/assets";
import type { VeoJob } from "@/app/types/veo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

import { useAssets } from "./useAssets";
import { AssetList } from "./AssetList";
import { UploadZone } from "./UploadZone";
import { UploadDialog } from "./dialogs/UploadDialog";
import { TranscriptDialog } from "./dialogs/TranscriptDialog";
import { AssetDetailsDialog } from "./dialogs/AssetDetailsDialog";
import { usePipelinePolling } from "@/app/lib/hooks/usePipelinePolling";
import { usePipelineStates } from "@/app/lib/hooks/usePipelineStates";

import {
  VideoPanel,
  ImagePanel,
  MusicPanel,
  TtsPanel,
  JobsPanel,
  BranchesPanel,
} from "./panels";

type TabId = "assets" | "video" | "image" | "music" | "tts" | "jobs" | "branches";

interface TabConfig {
  id: TabId;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
}

const TABS: TabConfig[] = [
  { id: "assets", icon: FolderOpen, label: "Assets", shortcut: "1" },
  { id: "video", icon: Video, label: "Video", shortcut: "2" },
  { id: "image", icon: ImageIcon, label: "Image", shortcut: "3" },
  { id: "music", icon: Music, label: "Music", shortcut: "4" },
  { id: "tts", icon: Volume2, label: "Speech", shortcut: "5" },
  { id: "jobs", icon: ListTodo, label: "Jobs", shortcut: "6" },
  { id: "branches", icon: GitBranch, label: "Branches", shortcut: "7" },
];

export function AssetsPanel() {
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
    reorderAssets,
    deleteAsset,
    resolveAssetDuration,
    startTranscription,
  } = useAssets();

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
          const response = await fetch(`/api/veo/${job.id}`);
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
      }, 3000);
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

  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>("assets");

  // Dialog states (keeping transcript and details as dialogs)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [transcriptDialogAssetId, setTranscriptDialogAssetId] = useState<string | null>(null);
  const [detailsDialogAssetId, setDetailsDialogAssetId] = useState<string | null>(null);

  // Text input state
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textSectionOpen, setTextSectionOpen] = useState(false);

  // Count running jobs for badge
  const runningVeoCount = veoJobs.filter((j) => j.status === "pending" || j.status === "running").length;
  const runningJobsCount = runningVeoCount;

  // Handle files from dropzone
  const handleFilesSelected = useCallback((files: File[]) => {
    setUploadInitialFiles(files);
    setUploadDialogOpen(true);
  }, []);

  // Handle upload complete
  const handleUploadComplete = useCallback(
    (newAssets: RemoteAsset[]) => {
      addAssets(newAssets);
      void fetchAssets();
    },
    [addAssets, fetchAssets]
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
      const clipOptions = {
        assetId: asset.id,
        width: asset.width ?? assetMetadata?.width,
        height: asset.height ?? assetMetadata?.height,
      };

      if (asset.type === "video" || asset.type === "other") {
        addClip(createVideoClip(asset.url, name, start, duration, clipOptions));
      } else if (asset.type === "audio") {
        addClip(createAudioClip(asset.url, name, start, duration, clipOptions));
      } else {
        addClip(createImageClip(asset.url, name, start, duration, clipOptions));
      }
    },
    [addClip, getDuration, resolveAssetDuration, metadata]
  );

  // Add text to timeline
  const handleAddText = useCallback(() => {
    if (!textContent.trim()) return;
    const name = textName.trim() || "Text";
    const clip = createTextClip(textContent, name, getDuration(), 5);
    addClip(clip);
    setTextContent("");
    setTextName("");
  }, [textContent, textName, addClip, getDuration]);

  // Get data for dialogs
  const transcriptDialogData = transcriptDialogAssetId
    ? transcriptions[transcriptDialogAssetId]
    : null;

  const detailsDialogAsset = detailsDialogAssetId
    ? assets.find((a) => a.id === detailsDialogAssetId)
    : null;

  // Fetch pipeline state for the asset details dialog
  const { state: pipelineState } = usePipelinePolling(
    detailsDialogAssetId,
    projectId,
    { enabled: !!detailsDialogAssetId }
  );
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
            {/* Upload Zone */}
            <div className="p-3 border-b border-border">
              <UploadZone onFilesSelected={handleFilesSelected} compact />
            </div>

            {/* Asset List */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {assets.length} asset{assets.length !== 1 && "s"}
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
                  assets={assets}
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
                  onRefresh={fetchAssets}
                />
              </ScrollArea>
            </div>

            {/* Add Text (collapsible) */}
            <Collapsible
              open={textSectionOpen}
              onOpenChange={setTextSectionOpen}
              className="border-t border-border"
            >
              <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Type className="size-3.5" />
                  Add Text
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    textSectionOpen && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0 space-y-2">
                  <Input
                    placeholder="Name (optional)"
                    value={textName}
                    onChange={(e) => setTextName(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Textarea
                    placeholder="Enter text..."
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={2}
                    className="text-sm resize-none"
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!textContent.trim()}
                    onClick={handleAddText}
                  >
                    <Type className="size-3.5 mr-1.5" />
                    Add to Timeline
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
              onRefresh={() => { fetchAssets(); refreshPipelineStates(); }}
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
        pipelineSteps={detailsDialogSteps}
        transcription={detailsDialogTranscription}
        onPipelineRefresh={fetchAssets}
      />
    </>
  );
}
