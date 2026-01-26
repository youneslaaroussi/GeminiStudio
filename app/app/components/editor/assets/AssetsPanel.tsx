"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Type } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { createTextClip, createVideoClip, createAudioClip, createImageClip } from "@/app/types/timeline";
import type { RemoteAsset } from "@/app/types/assets";
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

import { useAssets } from "./useAssets";
import { AssetList } from "./AssetList";
import { UploadZone } from "./UploadZone";
import { GenerateSection } from "./GenerateSection";
import { UploadDialog } from "./dialogs/UploadDialog";
import { VeoDialog } from "./dialogs/VeoDialog";
import { BananaDialog } from "./dialogs/BananaDialog";
import { TranscriptDialog } from "./dialogs/TranscriptDialog";
import { AssetDetailsDialog } from "./dialogs/AssetDetailsDialog";

export function AssetsPanel() {
  const {
    assets,
    isLoading,
    error,
    pipelineStates,
    transcriptions,
    metadata,
    projectId,
    fetchAssets,
    addAssets,
    deleteAsset,
    getPipelineStep,
    resolveAssetDuration,
    startTranscription,
  } = useAssets();

  const addClip = useProjectStore((s) => s.addClip);
  const getDuration = useProjectStore((s) => s.getDuration);

  // Dialog states
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [veoDialogOpen, setVeoDialogOpen] = useState(false);
  const [bananaDialogOpen, setBananaDialogOpen] = useState(false);
  const [transcriptDialogAssetId, setTranscriptDialogAssetId] = useState<string | null>(null);
  const [detailsDialogAssetId, setDetailsDialogAssetId] = useState<string | null>(null);

  // Text input state
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textSectionOpen, setTextSectionOpen] = useState(false);

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
    },
    [addAssets, fetchAssets]
  );

  // Add asset to timeline
  const handleAddToTimeline = useCallback(
    (asset: RemoteAsset) => {
      const duration = resolveAssetDuration(asset);
      const name = asset.name || "Asset";
      const start = getDuration();
      const clipOptions = { assetId: asset.id };

      if (asset.type === "video" || asset.type === "other") {
        addClip(createVideoClip(asset.url, name, start, duration, clipOptions));
      } else if (asset.type === "audio") {
        addClip(createAudioClip(asset.url, name, start, duration, clipOptions));
      } else {
        addClip(createImageClip(asset.url, name, start, duration, clipOptions));
      }
    },
    [addClip, getDuration, resolveAssetDuration]
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

  const detailsDialogSteps = detailsDialogAssetId
    ? pipelineStates[detailsDialogAssetId] ?? []
    : [];

  const detailsDialogTranscription = detailsDialogAssetId
    ? transcriptions[detailsDialogAssetId]
    : undefined;

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Upload Zone */}
        <div className="p-3 border-b border-border">
          <UploadZone onFilesSelected={handleFilesSelected} compact />
        </div>

        {/* Generate + Refresh */}
        <div className="p-3 border-b border-border space-y-3">
          <GenerateSection
            onOpenVeo={() => setVeoDialogOpen(true)}
            onOpenBanana={() => setBananaDialogOpen(true)}
          />
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
          <ScrollArea className="flex-1">
            <AssetList
              assets={assets}
              isLoading={isLoading}
              error={error}
              metadata={metadata}
              transcriptions={transcriptions}
              getPipelineStep={getPipelineStep}
              resolveAssetDuration={resolveAssetDuration}
              onAddToTimeline={handleAddToTimeline}
              onStartTranscription={startTranscription}
              onViewTranscription={setTranscriptDialogAssetId}
              onViewDetails={setDetailsDialogAssetId}
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

      {/* Dialogs */}
      <UploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        initialFiles={uploadInitialFiles}
        projectId={projectId}
        onUploadComplete={handleUploadComplete}
      />

      <VeoDialog
        open={veoDialogOpen}
        onOpenChange={setVeoDialogOpen}
        projectId={projectId}
        onGenerated={handleGenerated}
      />

      <BananaDialog
        open={bananaDialogOpen}
        onOpenChange={setBananaDialogOpen}
        projectId={projectId}
        onGenerated={handleGenerated}
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
      />
    </>
  );
}
