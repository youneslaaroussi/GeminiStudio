"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Gauge,
  Loader2,
  Plus,
  PlusCircle,
  Trash2,
  UploadCloud,
  FileAudio,
  FileVideo,
  FileImage,
  File as FileIcon,
  Type,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useProjectStore } from "@/app/lib/store/project-store";
import {
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
} from "@/app/types/timeline";
import type { TimelineClip } from "@/app/types/timeline";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RemoteAsset, AssetDragPayload } from "@/app/types/assets";
import { ASSET_DRAG_DATA_MIME, DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";

interface QueuedFile {
  id: string;
  file: File;
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function AssetsPanel() {
  const [assets, setAssets] = useState<RemoteAsset[]>([]);
  const [isFetchingAssets, setIsFetchingAssets] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [textName, setTextName] = useState("");
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});

  const addClip = useProjectStore((s) => s.addClip);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);
  const getDuration = useProjectStore((s) => s.getDuration);

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip: TimelineClip | undefined = allClips.find(
    (clip) => clip.id === selectedClipId
  );

  const fetchAssets = useCallback(async () => {
    setIsFetchingAssets(true);
    setFetchError(null);
    try {
      const response = await fetch("/api/assets");
      if (!response.ok) {
        throw new Error("Failed to load assets");
      }
      const data = (await response.json()) as { assets: RemoteAsset[] };
      setAssets(data.assets ?? []);
    } catch (error) {
      console.error(error);
      setFetchError("Could not load assets");
    } finally {
      setIsFetchingAssets(false);
    }
  }, []);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    let cancelled = false;
    const mediaElements: HTMLMediaElement[] = [];
    const missingDurations = assets.filter(
      (asset) => assetDurations[asset.id] == null
    );

    missingDurations.forEach((asset) => {
      if (asset.type === "image") {
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: DEFAULT_ASSET_DURATIONS.image };
        });
        return;
      }
      const media =
        asset.type === "audio"
          ? document.createElement("audio")
          : document.createElement("video");
      media.preload = "metadata";
      media.src = asset.url;
      media.onloadedmetadata = () => {
        if (cancelled) return;
        const duration =
          Number.isFinite(media.duration) && media.duration > 0
            ? media.duration
            : DEFAULT_ASSET_DURATIONS[asset.type] ?? 5;
        setAssetDurations((prev) => {
          if (prev[asset.id] && prev[asset.id] === duration) return prev;
          return { ...prev, [asset.id]: duration };
        });
        media.remove();
      };
      media.onerror = () => {
        if (cancelled) return;
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: DEFAULT_ASSET_DURATIONS[asset.type] ?? 5 };
        });
        media.remove();
      };
      mediaElements.push(media);
    });

    return () => {
      cancelled = true;
      mediaElements.forEach((media) => {
        media.onloadedmetadata = null;
        media.onerror = null;
        media.remove();
      });
    };
  }, [assets, assetDurations]);

  const resolveAssetDuration = useCallback(
    (asset: RemoteAsset) => assetDurations[asset.id] ?? DEFAULT_ASSET_DURATIONS[asset.type] ?? 5,
    [assetDurations]
  );

  const handleAddAssetToTimeline = useCallback(
    (asset: RemoteAsset) => {
      const duration = resolveAssetDuration(asset);
      const name = asset.name || "Uploaded Asset";
      const start = getDuration();

      if (asset.type === "video" || asset.type === "other") {
        const clip = createVideoClip(asset.url, name, start, duration);
        addClip(clip);
      } else if (asset.type === "audio") {
        const clip = createAudioClip(asset.url, name, start, duration);
        addClip(clip);
      } else {
        const clip = createImageClip(asset.url, name, start, duration);
        addClip(clip);
      }
    },
    [addClip, getDuration, resolveAssetDuration]
  );

  const handleFilesSelected = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setQueuedFiles((prev) => {
      const existing = new Set(prev.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
      const additions = acceptedFiles
        .filter((file) => !existing.has(`${file.name}-${file.size}-${file.lastModified}`))
        .map((file) => ({ id: createId(), file }));
      return [...prev, ...additions];
    });
    setUploadError(null);
    setIsUploadDialogOpen(true);
  }, []);

  const clearQueue = useCallback(() => {
    setQueuedFiles([]);
    setUploadProgress(0);
    setUploadError(null);
  }, []);

  const dropzone = useDropzone({
    onDrop: handleFilesSelected,
    multiple: true,
  });

  const modalDropzone = useDropzone({
    onDrop: handleFilesSelected,
    multiple: true,
  });

  const handleRemoveQueued = useCallback((id: string) => {
    setQueuedFiles((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const totalQueuedSize = useMemo(
    () => queuedFiles.reduce((sum, item) => sum + item.file.size, 0),
    [queuedFiles]
  );

  const uploadWithProgress = useCallback(
    (formData: FormData) => {
      return new Promise<{ assets: RemoteAsset[] }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/assets");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const value = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(value);
          }
        };
        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (error) {
              reject(error);
            }
          } else {
            reject(new Error("Upload failed"));
          }
        };
        xhr.send(formData);
      });
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!queuedFiles.length || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    const formData = new FormData();
    queuedFiles.forEach((item) => {
      formData.append("files", item.file);
    });
    try {
      const result = await uploadWithProgress(formData);
      setAssets((prev) => [...result.assets, ...prev]);
      clearQueue();
      setIsUploadDialogOpen(false);
    } catch (error) {
      console.error(error);
      setUploadError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      void fetchAssets();
    }
  }, [queuedFiles, isUploading, uploadWithProgress, clearQueue, fetchAssets]);

  const handleAddText = useCallback(() => {
    if (!textContent.trim()) return;

    const name = textName.trim() || "Text";
    const clip = createTextClip(
      textContent,
      name,
      getDuration(),
      5 // Default 5 seconds
    );
    addClip(clip);
    setTextContent("");
    setTextName("");
  }, [textContent, textName, addClip, getDuration]);

  const handleSpeedChange = useCallback(
    (speed: number) => {
      if (!selectedClipId) return;
      updateClip(selectedClipId, { speed });
    },
    [selectedClipId, updateClip]
  );

  const assetIcon = useCallback((asset: RemoteAsset) => {
    if (asset.type === "video") return <FileVideo className="size-4 text-blue-400" />;
    if (asset.type === "audio") return <FileAudio className="size-4 text-green-400" />;
    if (asset.type === "image") return <FileImage className="size-4 text-orange-400" />;
    return <FileIcon className="size-4 text-muted-foreground" />;
  }, []);

  const handleAssetDragStart = useCallback(
    (asset: RemoteAsset, event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer) return;
      const payload: AssetDragPayload = {
        id: asset.id,
        name: asset.name,
        url: asset.url,
        type: asset.type,
        duration: resolveAssetDuration(asset),
      };
      event.dataTransfer.setData(ASSET_DRAG_DATA_MIME, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "copy";
    },
    [resolveAssetDuration]
  );

  const handleDialogChange = useCallback(
    (open: boolean) => {
      if (!open && !isUploading) {
        clearQueue();
      }
      setIsUploadDialogOpen(open);
    },
    [clearQueue, isUploading]
  );

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">Assets</h2>
          <p className="text-xs text-muted-foreground">Upload media and add it to your timeline</p>
        </div>

        <div className="flex-1 overflow-hidden p-3 space-y-4">
          <div
            {...dropzone.getRootProps()}
            className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors flex flex-col items-center justify-center gap-2"
          >
            <input {...dropzone.getInputProps()} />
            <UploadCloud className="size-6 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {dropzone.isDragActive ? "Drop files to add them" : "Drag and drop files here"}
              </p>
              <p className="text-xs text-muted-foreground">or click to select files from your device</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setIsUploadDialogOpen(true);
              }}
            >
              Manage Upload Queue
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Uploaded Assets
              </h3>
              <p className="text-xs text-muted-foreground">
                {isFetchingAssets
                  ? "Loading..."
                  : assets.length
                    ? `${assets.length} asset${assets.length === 1 ? "" : "s"}`
                    : "No assets uploaded yet"}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchAssets()}>
              Refresh
            </Button>
          </div>

          <div className="h-48 rounded-md border border-border">
            <ScrollArea className="h-full">
              <div className="divide-y divide-border">
                {isFetchingAssets && (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading assets...
                  </div>
                )}
                {fetchError && (
                  <div className="p-4 text-sm text-destructive">{fetchError}</div>
                )}
                {!isFetchingAssets && !assets.length && !fetchError && (
                  <div className="p-4 text-sm text-muted-foreground">
                    Uploaded assets will appear here. Use the uploader above to add your media.
                  </div>
                )}
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center gap-3 p-3 cursor-grab rounded-md hover:bg-muted/50 transition-colors"
                    draggable
                    onDragStart={(event) => handleAssetDragStart(asset, event)}
                    title="Drag into the timeline or click Add"
                  >
                    <div className="rounded-md bg-muted p-2">{assetIcon(asset)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{asset.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {asset.type.toUpperCase()} • {formatBytes(asset.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAddAssetToTimeline(asset)}
                    >
                      <Plus className="size-4" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

        {/* Add Text */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Add Text
          </h3>
          <div className="space-y-2">
            <input
              type="text"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Enter text..."
              rows={3}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm resize-none"
            />
            <button
              type="button"
              onClick={handleAddText}
              disabled={!textContent.trim()}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Type className="size-3 inline mr-1" />
              Add Text to Timeline
            </button>
          </div>
        </div>

        {/* Clip Properties */}
        {selectedClip && (
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Clip Properties
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Name:</span>
                <span className="truncate max-w-[120px]">{selectedClip.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Start:</span>
                <span>{selectedClip.start.toFixed(2)}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span>{selectedClip.duration.toFixed(2)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <Gauge className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">Speed:</span>
                <select
                  value={selectedClip.speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      <Dialog open={isUploadDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload Assets</DialogTitle>
            <DialogDescription>
              Drop files here or browse to add them to your upload queue. We&apos;ll store them locally and serve a
              timeline-ready URL.
            </DialogDescription>
          </DialogHeader>
          <div
            {...modalDropzone.getRootProps()}
            className="border border-dashed border-border rounded-md p-4 text-center cursor-pointer hover:border-primary transition-colors flex flex-col items-center gap-2"
          >
            <input {...modalDropzone.getInputProps()} />
            <UploadCloud className="size-6 text-primary" />
            <p className="text-sm font-medium text-foreground">
              {modalDropzone.isDragActive ? "Drop the files to queue" : "Drag and drop files"}
            </p>
            <p className="text-xs text-muted-foreground">You can also click to select files</p>
            <Button
              type="button"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                modalDropzone.open();
              }}
            >
              Browse Files
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Files in queue</p>
              <p className="text-xs text-muted-foreground">{formatBytes(totalQueuedSize)}</p>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {queuedFiles.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No files queued yet. Drop or browse to add some.
                </div>
              )}
              {queuedFiles.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3">
                  <div className="rounded-md bg-muted p-2">
                    <FileIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveQueued(item.id)}
                    disabled={isUploading}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} />
            </div>
          )}

          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearQueue}
              disabled={!queuedFiles.length || isUploading}
            >
              <Trash2 className="size-4" />
              Clear Queue
            </Button>
            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isUploading}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={() => void handleUpload()}
                disabled={!queuedFiles.length || isUploading}
              >
                {isUploading ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                {isUploading ? "Uploading..." : `Upload ${queuedFiles.length || ""}`}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
