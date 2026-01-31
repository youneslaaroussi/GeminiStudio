"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Trash2,
  File as FileIcon,
  Loader2,
  Coins,
  Video,
  Image,
  Music,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { RemoteAsset } from "@/app/types/assets";
import { createId, formatBytes } from "../utils";
import { getAuthToken } from "@/app/lib/hooks/useAuthFetch";
import {
  CREDITS_PER_ACTION,
  getUploadCreditBreakdown,
} from "@/app/lib/credits-config";

interface QueuedFile {
  id: string;
  file: File;
}

// Transcode options
interface TranscodeOptions {
  enabled: boolean;
  preset: string; // "preset/web-hd", "preset/web-sd", "custom"
  outputFormat: string; // "mp4", "hls", "dash"
  videoCodec: string; // "h264", "h265", "vp9"
  videoBitrate: number | null; // kbps
  width: number | null;
  height: number | null;
  audioCodec: string; // "aac", "mp3"
  audioBitrate: number | null; // kbps
}

const DEFAULT_TRANSCODE_OPTIONS: TranscodeOptions = {
  enabled: true,  // Transcode by default to ensure proper format for analysis
  preset: "preset/web-hd",
  outputFormat: "mp4",
  videoCodec: "h264",
  videoBitrate: 5000, // 5 Mbps
  width: null,
  height: null,
  audioCodec: "aac",
  audioBitrate: 128, // 128 kbps
};

const PRESET_OPTIONS = [
  { value: "preset/web-hd", label: "Web HD (up to 720p)", description: "Aspect preserved, scaled for web" },
  { value: "preset/web-sd", label: "Web SD (up to 360p)", description: "Aspect preserved, smaller files" },
  { value: "custom", label: "Custom", description: "Configure your own settings" },
];

const FORMAT_OPTIONS = [
  { value: "mp4", label: "MP4", description: "Universal compatibility" },
  { value: "hls", label: "HLS", description: "Adaptive streaming (Apple)" },
  { value: "dash", label: "DASH", description: "Adaptive streaming (MPEG)" },
];

const VIDEO_CODEC_OPTIONS = [
  { value: "h264", label: "H.264", description: "Wide compatibility" },
  { value: "h265", label: "H.265/HEVC", description: "Better compression" },
  { value: "vp9", label: "VP9", description: "Open format, good quality" },
];

const AUDIO_CODEC_OPTIONS = [
  { value: "aac", label: "AAC", description: "Best compatibility" },
  { value: "mp3", label: "MP3", description: "Legacy support" },
  { value: "opus", label: "Opus", description: "Best quality/size ratio" },
];

const BITRATE_PRESETS = [
  { value: 1000, label: "1 Mbps", description: "Low quality" },
  { value: 2500, label: "2.5 Mbps", description: "SD quality" },
  { value: 5000, label: "5 Mbps", description: "HD quality" },
  { value: 8000, label: "8 Mbps", description: "Full HD" },
  { value: 15000, label: "15 Mbps", description: "High quality" },
];

const RESOLUTION_PRESETS = [
  { width: null, height: null, label: "Original" },
  { width: 640, height: 360, label: "360p" },
  { width: 854, height: 480, label: "480p" },
  { width: 1280, height: 720, label: "720p" },
  { width: 1920, height: 1080, label: "1080p" },
];

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFiles?: File[];
  projectId: string | null;
  onUploadComplete: (assets: RemoteAsset[], options?: { transcodeStarted?: boolean; convertStarted?: boolean }) => void;
}

export function UploadDialog({
  open,
  onOpenChange,
  initialFiles,
  projectId,
  onUploadComplete,
}: UploadDialogProps) {
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcodeOptions, setTranscodeOptions] = useState<TranscodeOptions>(DEFAULT_TRANSCODE_OPTIONS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Check if any video files are in the queue
  const hasVideoFiles = useMemo(
    () => queuedFiles.some((item) => item.file.type.startsWith("video/")),
    [queuedFiles]
  );

  // Sync initialFiles when dialog opens
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      setQueuedFiles((prev) => {
        const existing = new Set(
          prev.map((item) => `${item.file.name}-${item.file.size}`)
        );
        const additions = initialFiles
          .filter((file) => !existing.has(`${file.name}-${file.size}`))
          .map((file) => ({ id: createId(), file }));
        return [...prev, ...additions];
      });
    }
  }, [open, initialFiles]);

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setQueuedFiles((prev) => {
      const existing = new Set(
        prev.map((item) => `${item.file.name}-${item.file.size}`)
      );
      const additions = acceptedFiles
        .filter((file) => !existing.has(`${file.name}-${file.size}`))
        .map((file) => ({ id: createId(), file }));
      return [...prev, ...additions];
    });
    setError(null);
  }, []);

  const dropzone = useDropzone({
    onDrop: handleDrop,
    multiple: true,
  });

  const handleRemove = useCallback((id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const totalSize = useMemo(
    () => queuedFiles.reduce((sum, item) => sum + item.file.size, 0),
    [queuedFiles]
  );

  const creditBreakdown = useMemo(
    () => getUploadCreditBreakdown(queuedFiles.map((item) => item.file)),
    [queuedFiles]
  );

  const handleUpload = useCallback(async () => {
    if (!queuedFiles.length || isUploading || !projectId) return;
    setIsUploading(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("projectId", projectId);
    queuedFiles.forEach((item) => formData.append("files", item.file));

    // Add transcode options if enabled and there are video files
    if (transcodeOptions.enabled && hasVideoFiles) {
      const transcodePayload: Record<string, unknown> = {};

      if (transcodeOptions.preset !== "custom") {
        transcodePayload.preset = transcodeOptions.preset;
      } else {
        transcodePayload.outputFormat = transcodeOptions.outputFormat;
        transcodePayload.videoCodec = transcodeOptions.videoCodec;
        if (transcodeOptions.videoBitrate) {
          transcodePayload.videoBitrate = transcodeOptions.videoBitrate * 1000; // Convert to bps
        }
        if (transcodeOptions.width) {
          transcodePayload.width = transcodeOptions.width;
        }
        if (transcodeOptions.height) {
          transcodePayload.height = transcodeOptions.height;
        }
        transcodePayload.audioCodec = transcodeOptions.audioCodec;
        if (transcodeOptions.audioBitrate) {
          transcodePayload.audioBitrate = transcodeOptions.audioBitrate * 1000; // Convert to bps
        }
      }

      formData.append("transcodeOptions", JSON.stringify(transcodePayload));
    }

    try {
      // Get auth token
      const token = await getAuthToken();

      const result = await new Promise<{ assets: RemoteAsset[]; transcodeStarted?: boolean; convertStarted?: boolean }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/assets");

          // Set auth header if we have a token
          if (token) {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          }

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("Invalid response"));
              }
            } else if (xhr.status === 401) {
              reject(new Error("Unauthorized. Please log in again."));
            } else if (xhr.status === 402) {
              // Insufficient credits
              try {
                const data = JSON.parse(xhr.responseText);
                reject(new Error(data.error || "Insufficient credits"));
              } catch {
                reject(new Error("Insufficient credits to upload files"));
              }
            } else if (xhr.status === 503) {
              reject(new Error("Asset service not available. Check ASSET_SERVICE_URL."));
            } else {
              reject(new Error("Upload failed"));
            }
          };
          xhr.send(formData);
        }
      );

      onUploadComplete(result.assets, { transcodeStarted: result.transcodeStarted, convertStarted: result.convertStarted });
      setQueuedFiles([]);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  }, [queuedFiles, isUploading, projectId, onUploadComplete, onOpenChange, hasVideoFiles, transcodeOptions]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isUploading) {
        setQueuedFiles([]);
        setError(null);
        setTranscodeOptions(DEFAULT_TRANSCODE_OPTIONS);
        setShowAdvanced(false);
      }
      onOpenChange(nextOpen);
    },
    [isUploading, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Assets</DialogTitle>
        </DialogHeader>

        <div
          {...dropzone.getRootProps()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        >
          <input {...dropzone.getInputProps()} />
          <Upload className="size-6 text-primary" />
          <p className="text-sm font-medium">
            {dropzone.isDragActive ? "Drop files here" : "Drop files to upload"}
          </p>
          <p className="text-xs text-muted-foreground">or click to browse</p>
        </div>

        {queuedFiles.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {queuedFiles.length} file{queuedFiles.length !== 1 && "s"}
              </span>
              <span className="text-muted-foreground">
                {formatBytes(totalSize)}
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {queuedFiles.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 text-sm"
                >
                  <FileIcon className="size-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{item.file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatBytes(item.file.size)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => handleRemove(item.id)}
                    disabled={isUploading}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Credit cost breakdown */}
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Coins className="size-4 text-amber-500" />
                <span>Credit Cost</span>
              </div>
              <div className="grid gap-1.5 text-xs">
                {creditBreakdown.videos > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Video className="size-3.5" />
                      {creditBreakdown.videos} video{creditBreakdown.videos !== 1 && "s"}
                    </span>
                    <span>{creditBreakdown.videos * CREDITS_PER_ACTION.upload_video} R-Credits</span>
                  </div>
                )}
                {creditBreakdown.images > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Image className="size-3.5" />
                      {creditBreakdown.images} image{creditBreakdown.images !== 1 && "s"}
                    </span>
                    <span>{creditBreakdown.images * CREDITS_PER_ACTION.upload_image} R-Credits</span>
                  </div>
                )}
                {creditBreakdown.audio > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Music className="size-3.5" />
                      {creditBreakdown.audio} audio file{creditBreakdown.audio !== 1 && "s"}
                    </span>
                    <span>{creditBreakdown.audio * CREDITS_PER_ACTION.upload_audio} R-Credits</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1.5 border-t border-border font-medium text-foreground">
                  <span>Total</span>
                  <span className="text-amber-500">{creditBreakdown.totalCredits} R-Credits</span>
                </div>
              </div>
            </div>

            {/* Transcode options (only show if video files are present) */}
            {hasVideoFiles && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 className="size-4 text-primary" />
                    <Label htmlFor="transcode-toggle" className="text-sm font-medium cursor-pointer">
                      Transcode Videos
                    </Label>
                  </div>
                  <Switch
                    id="transcode-toggle"
                    checked={transcodeOptions.enabled}
                    onCheckedChange={(checked) =>
                      setTranscodeOptions((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>

                {transcodeOptions.enabled && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    {/* Preset selection */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Quality Preset</Label>
                      <Select
                        value={transcodeOptions.preset}
                        onValueChange={(value) =>
                          setTranscodeOptions((prev) => ({ ...prev, preset: value }))
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRESET_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <div className="flex flex-col">
                                <span>{opt.label}</span>
                                <span className="text-xs text-muted-foreground">{opt.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Custom options toggle */}
                    {transcodeOptions.preset === "custom" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                          {showAdvanced ? "Hide" : "Show"} advanced options
                        </button>

                        {showAdvanced && (
                          <div className="space-y-3 pt-2">
                            {/* Output format */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Format</Label>
                                <Select
                                  value={transcodeOptions.outputFormat}
                                  onValueChange={(value) =>
                                    setTranscodeOptions((prev) => ({ ...prev, outputFormat: value }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {FORMAT_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Video Codec</Label>
                                <Select
                                  value={transcodeOptions.videoCodec}
                                  onValueChange={(value) =>
                                    setTranscodeOptions((prev) => ({ ...prev, videoCodec: value }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {VIDEO_CODEC_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {/* Video bitrate */}
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Video Bitrate</Label>
                              <Select
                                value={String(transcodeOptions.videoBitrate || 5000)}
                                onValueChange={(value) =>
                                  setTranscodeOptions((prev) => ({ ...prev, videoBitrate: parseInt(value) }))
                                }
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BITRATE_PRESETS.map((opt) => (
                                    <SelectItem key={opt.value} value={String(opt.value)}>
                                      {opt.label} - {opt.description}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Resolution */}
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Resolution</Label>
                              <Select
                                value={
                                  transcodeOptions.width
                                    ? `${transcodeOptions.width}x${transcodeOptions.height}`
                                    : "original"
                                }
                                onValueChange={(value) => {
                                  if (value === "original") {
                                    setTranscodeOptions((prev) => ({ ...prev, width: null, height: null }));
                                  } else {
                                    const [w, h] = value.split("x").map(Number);
                                    setTranscodeOptions((prev) => ({ ...prev, width: w, height: h }));
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {RESOLUTION_PRESETS.map((opt) => (
                                    <SelectItem
                                      key={opt.label}
                                      value={opt.width ? `${opt.width}x${opt.height}` : "original"}
                                    >
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Audio settings */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Audio Codec</Label>
                                <Select
                                  value={transcodeOptions.audioCodec}
                                  onValueChange={(value) =>
                                    setTranscodeOptions((prev) => ({ ...prev, audioCodec: value }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {AUDIO_CODEC_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Audio Bitrate</Label>
                                <Select
                                  value={String(transcodeOptions.audioBitrate || 128)}
                                  onValueChange={(value) =>
                                    setTranscodeOptions((prev) => ({ ...prev, audioBitrate: parseInt(value) }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="64">64 kbps</SelectItem>
                                    <SelectItem value="128">128 kbps</SelectItem>
                                    <SelectItem value="192">192 kbps</SelectItem>
                                    <SelectItem value="256">256 kbps</SelectItem>
                                    <SelectItem value="320">320 kbps</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Transcoded videos will be processed in the background and stored alongside the original.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isUploading && (
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Uploading... {progress}%
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={queuedFiles.length === 0 || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="size-4 mr-2" />
                Upload {queuedFiles.length > 0 && `(${queuedFiles.length})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
