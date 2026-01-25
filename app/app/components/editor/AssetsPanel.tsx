"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from "react";
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
  Clapperboard,
  Wand2,
  FileText,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "sonner";
import type { TranscriptionSegment } from "@/app/types/transcription";
import type { PipelineStepState, PipelineStepStatus } from "@/app/types/pipeline";

interface PromptSuggestion {
  cinematography: string;
  subject: string;
  action: string;
  context: string;
  styleAmbiance: string;
  audioDirection: string;
  finalPrompt: string;
}

interface QueuedFile {
  id: string;
  file: File;
}

interface EncodedFile {
  name: string;
  data: string;
  mimeType: string;
  size: number;
}

interface ApiTranscriptionJob {
  id: string;
  assetId: string;
  assetName: string;
  assetUrl?: string;
  status: "pending" | "processing" | "completed" | "error";
  transcript?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  languageCodes?: string[];
  segments?: TranscriptionSegment[];
}

const STEP_STATUS_BADGE_STYLES: Record<PipelineStepStatus, string> = {
  idle: "bg-muted text-muted-foreground border border-border/60",
  queued: "bg-amber-500/15 text-amber-700 border border-amber-200 dark:text-amber-200 dark:border-amber-500/40",
  running: "bg-blue-500/15 text-blue-700 border border-blue-200 dark:text-blue-200 dark:border-blue-500/40",
  waiting: "bg-slate-500/15 text-slate-700 border border-slate-200 dark:text-slate-200 dark:border-slate-500/40",
  succeeded: "bg-emerald-500/15 text-emerald-700 border border-emerald-200 dark:text-emerald-200 dark:border-emerald-500/40",
  failed: "bg-destructive/15 text-destructive border border-destructive/30",
};

const STEP_STATUS_DOT_STYLES: Record<PipelineStepStatus, string> = {
  idle: "bg-muted-foreground/50",
  queued: "bg-amber-500",
  running: "bg-blue-500",
  waiting: "bg-slate-400",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
};

function StepStatusBadge({ status }: { status: PipelineStepStatus }) {
  const style = STEP_STATUS_BADGE_STYLES[status] ?? STEP_STATUS_BADGE_STYLES.idle;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${style}`}
    >
      {status}
    </span>
  );
}

function StepStatusDot({ status }: { status: PipelineStepStatus }) {
  const style = STEP_STATUS_DOT_STYLES[status] ?? STEP_STATUS_DOT_STYLES.idle;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${style}`} />;
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

function stripDataUrlPrefix(value: string) {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return value;
  return value.slice(commaIndex + 1);
}

async function encodeFile(file: File): Promise<EncodedFile> {
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read file"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });

  const data = stripDataUrlPrefix(result);
  if (!data) {
    throw new Error("File data is empty");
  }

  return {
    name: file.name,
    data,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
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
  const [isVeoModalOpen, setIsVeoModalOpen] = useState(false);
  const [veoPrompt, setVeoPrompt] = useState("");
  const [veoPromptIdea, setVeoPromptIdea] = useState("");
  const [veoDuration, setVeoDuration] = useState(8);
  const [veoAspectRatio, setVeoAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [veoResolution, setVeoResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [veoGenerateAudio, setVeoGenerateAudio] = useState(true);
  const [veoIsGenerating, setVeoIsGenerating] = useState(false);
  const [veoError, setVeoError] = useState<string | null>(null);
  const [veoImageInput, setVeoImageInput] = useState<EncodedFile | null>(null);
  const [veoLastFrameInput, setVeoLastFrameInput] = useState<EncodedFile | null>(null);
  const [veoReferenceImages, setVeoReferenceImages] = useState<EncodedFile[]>([]);
  const [veoVideoInput, setVeoVideoInput] = useState<EncodedFile | null>(null);
  const [veoResizeMode, setVeoResizeMode] = useState<"pad" | "crop">("pad");
  const [veoNegativePrompt, setVeoNegativePrompt] = useState("");
  const [promptSuggestion, setPromptSuggestion] = useState<PromptSuggestion | null>(null);
  const [promptSuggestionError, setPromptSuggestionError] = useState<string | null>(null);
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [isBananaModalOpen, setIsBananaModalOpen] = useState(false);
  const [bananaPrompt, setBananaPrompt] = useState("");
  const [bananaAspectRatio, setBananaAspectRatio] = useState("1:1");
  const [bananaImageSize, setBananaImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [bananaIsGenerating, setBananaIsGenerating] = useState(false);
  const [bananaError, setBananaError] = useState<string | null>(null);
  const [pipelineStates, setPipelineStates] = useState<Record<string, PipelineStepState[]>>({});
  const [bananaSourceImage, setBananaSourceImage] = useState<EncodedFile | null>(null);

  const addClip = useProjectStore((s) => s.addClip);
  const publishAssets = useAssetsStore((state) => state.setAssets);
  const upsertAssetMetadata = useAssetsStore((state) => state.upsertMetadata);
  const metadata = useAssetsStore((state) => state.metadata);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);
  const getDuration = useProjectStore((s) => s.getDuration);
  const transcriptions = useProjectStore((s) => s.project.transcriptions ?? {});
  const upsertProjectTranscription = useProjectStore((s) => s.upsertProjectTranscription);
  const getPipelineStep = useCallback(
    (assetId: string, stepId: string) => pipelineStates[assetId]?.find((step) => step.id === stepId),
    [pipelineStates]
  );

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip: TimelineClip | undefined = allClips.find(
    (clip) => clip.id === selectedClipId
  );

  const [transcriptDialogAssetId, setTranscriptDialogAssetId] = useState<string | null>(null);
  const [detailsDialogAssetId, setDetailsDialogAssetId] = useState<string | null>(null);
  const assetsRef = useRef<RemoteAsset[]>([]);
  const pollingJobsRef = useRef(new Set<string>());

  const fetchPipelineStates = useCallback(async () => {
    try {
      const response = await fetch("/api/assets/pipeline");
      if (!response.ok) {
        throw new Error("Failed to load pipeline states");
      }
      const data = (await response.json()) as { pipelines?: Array<{ assetId: string; steps: PipelineStepState[] }> };
      const map = Object.fromEntries(
        (data.pipelines ?? []).map((pipeline) => [pipeline.assetId, pipeline.steps])
      );
      setPipelineStates(map);
    } catch (error) {
      console.error("Failed to fetch pipeline states", error);
    }
  }, []);

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
      void fetchPipelineStates();
    } catch (error) {
      console.error(error);
      setFetchError("Could not load assets");
    } finally {
      setIsFetchingAssets(false);
    }
  }, [fetchPipelineStates]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    void fetchPipelineStates();
  }, [fetchPipelineStates]);

  useEffect(() => {
    publishAssets(assets);
  }, [assets, publishAssets]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    Object.entries(pipelineStates).forEach(([assetId, steps]) => {
      const transcriptionStep = steps.find((step) => step.id === "transcription");
      if (
        transcriptionStep?.status === "succeeded" &&
        typeof transcriptionStep.metadata?.transcript === "string"
      ) {
        const assetSnapshot = assetsRef.current.find((entry) => entry.id === assetId);
        if (!assetSnapshot) return;
        upsertProjectTranscription({
          assetId,
          assetName: assetSnapshot.name,
          assetUrl: assetSnapshot.url,
          status: "completed",
          jobId: (transcriptionStep.metadata.jobId as string) || undefined,
          transcript: transcriptionStep.metadata.transcript as string,
          languageCodes: (transcriptionStep.metadata.languageCodes as string[]) ?? ["en-US"],
          createdAt: transcriptionStep.startedAt ?? new Date().toISOString(),
          updatedAt: transcriptionStep.updatedAt,
          segments: Array.isArray(transcriptionStep.metadata.segments)
            ? (transcriptionStep.metadata.segments as TranscriptionSegment[])
            : [],
        });
      }
    });
  }, [pipelineStates, upsertProjectTranscription]);

  const pollTranscriptionJob = useCallback(
    async (assetId: string, jobId: string) => {
      const pollKey = `${assetId}:${jobId}`;
      if (pollingJobsRef.current.has(pollKey)) {
        return;
      }
      pollingJobsRef.current.add(pollKey);

      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      try {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (attempt > 0) {
            await wait(4000);
          }
          const response = await fetch(`/api/transcriptions/${jobId}`);
          const payload = (await response.json()) as { job?: ApiTranscriptionJob; error?: string };
          if (!response.ok || !payload.job) {
            throw new Error(payload.error || "Failed to fetch transcription status");
          }

          const assetSnapshot = assetsRef.current.find((entry) => entry.id === assetId);
          upsertProjectTranscription({
            assetId,
            assetName: assetSnapshot?.name ?? payload.job.assetName,
            assetUrl: assetSnapshot?.url ?? payload.job.assetUrl ?? "",
            jobId: payload.job.id,
            status: payload.job.status,
            languageCodes: payload.job.languageCodes ?? ["en-US"],
            transcript: payload.job.transcript,
            error: payload.job.error,
            createdAt: payload.job.createdAt,
            updatedAt: payload.job.updatedAt,
            segments: payload.job.segments ?? [],
          });

          if (payload.job.status === "completed") {
            const displayName = assetSnapshot?.name ?? payload.job.assetName;
            toast.success("Transcription ready", {
              description: displayName ? `“${displayName}” transcript is ready.` : undefined,
              action: {
                label: "View",
                onClick: () => setTranscriptDialogAssetId(assetId),
              },
            });
            void fetchPipelineStates();
            return;
          }

          if (payload.job.status === "error") {
            toast.error("Transcription failed", {
              description: payload.job.error || "Please try again.",
            });
            void fetchPipelineStates();
            return;
          }
        }

        toast.error("Transcription timed out", {
          description: "Please try again in a moment.",
        });
        void fetchPipelineStates();
      } catch (error) {
        console.error("Polling transcription failed", error);
        toast.error("Unable to poll transcription", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
        void fetchPipelineStates();
      } finally {
        pollingJobsRef.current.delete(pollKey);
      }
    },
    [upsertProjectTranscription, setTranscriptDialogAssetId, fetchPipelineStates]
  );

  useEffect(() => {
    Object.entries(pipelineStates).forEach(([assetId, steps]) => {
      const transcriptionStep = steps.find((step) => step.id === "transcription");
      const jobId = transcriptionStep?.metadata?.jobId;
      if (
        typeof jobId === "string" &&
        (transcriptionStep?.status === "waiting" || transcriptionStep?.status === "running")
      ) {
        void pollTranscriptionJob(assetId, jobId);
      }
    });
  }, [pipelineStates, pollTranscriptionJob]);

  useEffect(() => {
    let cancelled = false;
    const mediaElements: Array<HTMLMediaElement | HTMLImageElement> = [];
    const missingDurations = assets.filter(
      (asset) => assetDurations[asset.id] == null
    );

    missingDurations.forEach((asset) => {
      const defaultDuration =
        DEFAULT_ASSET_DURATIONS[asset.type] ?? DEFAULT_ASSET_DURATIONS.other;
      if (asset.type === "image") {
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: defaultDuration };
        });
        upsertAssetMetadata(asset.id, { duration: defaultDuration });
        const img = new Image();
        img.src = asset.url;
        img.onload = () => {
          if (cancelled) return;
          upsertAssetMetadata(asset.id, {
            duration: defaultDuration,
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          img.remove();
        };
        img.onerror = () => {
          img.remove();
        };
        mediaElements.push(img);
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
            : defaultDuration;
        setAssetDurations((prev) => {
          if (prev[asset.id] && prev[asset.id] === duration) return prev;
          return { ...prev, [asset.id]: duration };
        });
        upsertAssetMetadata(asset.id, {
          duration,
          width:
            asset.type === "video" && media instanceof HTMLVideoElement
              ? media.videoWidth || undefined
              : undefined,
          height:
            asset.type === "video" && media instanceof HTMLVideoElement
              ? media.videoHeight || undefined
              : undefined,
        });
        media.remove();
      };
      media.onerror = () => {
        if (cancelled) return;
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: defaultDuration };
        });
        upsertAssetMetadata(asset.id, { duration: defaultDuration });
        media.remove();
      };
      mediaElements.push(media);
    });

    return () => {
      cancelled = true;
      mediaElements.forEach((media) => {
        if (media instanceof HTMLImageElement) {
          media.onload = null;
          media.onerror = null;
        } else {
          media.onloadedmetadata = null;
          media.onerror = null;
        }
        media.remove();
      });
    };
  }, [assets, assetDurations, upsertAssetMetadata]);

  useEffect(() => {
    if (veoVideoInput && veoResolution !== "720p") {
      setVeoResolution("720p");
    }
  }, [veoVideoInput, veoResolution]);

  useEffect(() => {
    const needsEightSeconds = veoResolution !== "720p" || veoReferenceImages.length > 0 || Boolean(veoVideoInput);
    if (needsEightSeconds && veoDuration !== 8) {
      setVeoDuration(8);
    }
  }, [veoResolution, veoReferenceImages.length, veoVideoInput, veoDuration]);

  const resolveAssetDuration = useCallback(
    (asset: RemoteAsset) => assetDurations[asset.id] ?? DEFAULT_ASSET_DURATIONS[asset.type] ?? 5,
    [assetDurations]
  );

  const handleAddAssetToTimeline = useCallback(
    (asset: RemoteAsset) => {
      const duration = resolveAssetDuration(asset);
      const name = asset.name || "Uploaded Asset";
      const start = getDuration();

      const clipOptions = { assetId: asset.id };
      if (asset.type === "video" || asset.type === "other") {
        const clip = createVideoClip(asset.url, name, start, duration, clipOptions);
        addClip(clip);
      } else if (asset.type === "audio") {
        const clip = createAudioClip(asset.url, name, start, duration, clipOptions);
        addClip(clip);
      } else {
        const clip = createImageClip(asset.url, name, start, duration, clipOptions);
        addClip(clip);
      }
    },
    [addClip, getDuration, resolveAssetDuration]
  );

  const handleStartTranscription = useCallback(
    async (asset: RemoteAsset) => {
      if (asset.type !== "audio" && asset.type !== "video") {
        toast.error("Only audio or video assets can be transcribed.");
        return;
      }

      const existingStep = getPipelineStep(asset.id, "transcription");
      const existingJobId = typeof existingStep?.metadata?.jobId === "string" ? (existingStep.metadata.jobId as string) : null;
      if (existingJobId && (existingStep?.status === "waiting" || existingStep?.status === "running")) {
        toast.info("Transcription already running", {
          description: "You'll get a heads-up when it's done.",
        });
        void pollTranscriptionJob(asset.id, existingJobId);
        return;
      }

      try {
        const response = await fetch(`/api/assets/${asset.id}/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: "transcription" }),
        });
        const payload = (await response.json()) as {
          pipeline?: { assetId: string; steps: PipelineStepState[] };
          error?: string;
        };
        if (!response.ok || !payload.pipeline) {
          throw new Error(payload.error || "Failed to start transcription");
        }
        setPipelineStates((prev) => ({
          ...prev,
          [asset.id]: payload.pipeline!.steps,
        }));
        const step = payload.pipeline.steps.find((s) => s.id === "transcription");
        const jobId = typeof step?.metadata?.jobId === "string" ? (step.metadata.jobId as string) : null;

        if (jobId && (step?.status === "waiting" || step?.status === "running")) {
          toast.success("Transcription started", {
            description: `We'll notify you when “${asset.name}” is ready.`,
          });
          void pollTranscriptionJob(asset.id, jobId);
        } else if (step?.status === "succeeded") {
          toast.success("Transcription ready", {
            description: `“${asset.name}” transcript is ready.`,
            action: {
              label: "View",
              onClick: () => setTranscriptDialogAssetId(asset.id),
            },
          });
        }
      } catch (error) {
        console.error("Transcription request failed", error);
        toast.error("Unable to start transcription", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [getPipelineStep, pollTranscriptionJob, setTranscriptDialogAssetId]
  );

  const handleViewTranscription = useCallback((assetId: string) => {
    setTranscriptDialogAssetId(assetId);
  }, [setTranscriptDialogAssetId]);

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

  const readSingleFile = useCallback(
    async (
      files: FileList | null,
      setter: (value: EncodedFile | null) => void,
      errorSetter: (message: string | null) => void
    ) => {
      const file = files?.[0];
      if (!file) return;
      try {
        const encoded = await encodeFile(file);
        setter(encoded);
        errorSetter(null);
      } catch (error) {
        console.error(error);
        errorSetter("Unable to read the selected file. Please try again.");
      }
    },
    []
  );

  const handleVeoImageFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await readSingleFile(event.target.files, setVeoImageInput, setVeoError);
      event.target.value = "";
    },
    [readSingleFile]
  );

  const handleVeoLastFrameFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await readSingleFile(event.target.files, setVeoLastFrameInput, setVeoError);
      event.target.value = "";
    },
    [readSingleFile]
  );

  const handleVeoVideoFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await readSingleFile(event.target.files, setVeoVideoInput, setVeoError);
      event.target.value = "";
    },
    [readSingleFile]
  );

  const handleReferenceImagesChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files?.length) return;
      try {
        const remaining = Math.max(0, 3 - veoReferenceImages.length);
        if (remaining === 0) return;
        const next = Array.from(files).slice(0, remaining);
        const encoded = await Promise.all(next.map((file) => encodeFile(file)));
        setVeoReferenceImages((prev) => [...prev, ...encoded].slice(0, 3));
        setVeoError(null);
      } catch (error) {
        console.error(error);
        setVeoError("Unable to read reference images. Please try again.");
      } finally {
        event.target.value = "";
      }
    },
    [veoReferenceImages.length]
  );

  const handleBananaSourceChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await readSingleFile(event.target.files, setBananaSourceImage, setBananaError);
      event.target.value = "";
    },
    [readSingleFile]
  );

  const removeReferenceImage = useCallback((index: number) => {
    setVeoReferenceImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  const handleVeoGeneration = useCallback(async () => {
    if (veoIsGenerating || !veoPrompt.trim()) return;
    setVeoIsGenerating(true);
    setVeoError(null);
    try {
      const payload: Record<string, unknown> = {
        prompt: veoPrompt,
        durationSeconds: veoDuration,
        aspectRatio: veoAspectRatio,
        resolution: veoResolution,
        generateAudio: veoGenerateAudio,
      };

      if (veoImageInput) {
        payload.image = { data: veoImageInput.data, mimeType: veoImageInput.mimeType };
        payload.resizeMode = veoResizeMode;
      }

      if (veoLastFrameInput) {
        payload.lastFrame = { data: veoLastFrameInput.data, mimeType: veoLastFrameInput.mimeType };
      }

      if (veoReferenceImages.length) {
        payload.referenceImages = veoReferenceImages.map((image) => ({
          data: image.data,
          mimeType: image.mimeType,
          referenceType: "asset",
        }));
      }

      if (veoVideoInput) {
        payload.video = { data: veoVideoInput.data, mimeType: veoVideoInput.mimeType };
      }

      if (veoNegativePrompt.trim()) {
        payload.negativePrompt = veoNegativePrompt.trim();
      }

      const response = await fetch("/api/veo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { asset?: RemoteAsset; error?: string };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Failed to generate Veo asset");
      }
      setAssets((prev) => [data.asset!, ...prev]);
      setIsVeoModalOpen(false);
      setVeoPrompt("");
      setVeoPromptIdea("");
      setVeoError(null);
      setVeoImageInput(null);
      setVeoLastFrameInput(null);
      setVeoReferenceImages([]);
      setVeoVideoInput(null);
      setVeoNegativePrompt("");
      setVeoResizeMode("pad");
      void fetchAssets();
    } catch (error) {
      console.error(error);
      setVeoError(error instanceof Error ? error.message : "Failed to generate Veo asset");
    } finally {
      setVeoIsGenerating(false);
    }
  }, [
    veoIsGenerating,
    veoPrompt,
    veoDuration,
    veoAspectRatio,
    veoResolution,
    veoGenerateAudio,
    fetchAssets,
    veoImageInput,
    veoLastFrameInput,
    veoReferenceImages,
    veoVideoInput,
    veoNegativePrompt,
    veoResizeMode,
  ]);

  const handlePromptAssist = useCallback(async () => {
    const seed = (veoPromptIdea || veoPrompt).trim();
    if (!seed || isPromptLoading) {
      if (!seed) {
        setPromptSuggestionError("Provide a short idea to enhance.");
      }
      return;
    }
    setIsPromptLoading(true);
    setPromptSuggestionError(null);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: seed,
          aspectRatio: veoAspectRatio,
          durationSeconds: veoDuration as 4 | 6 | 8,
          includeAudio: veoGenerateAudio,
        }),
      });
      const data = (await response.json()) as { suggestion?: PromptSuggestion; error?: string };
      if (!response.ok || !data.suggestion) {
        throw new Error(data.error || "Failed to enhance prompt");
      }
      setPromptSuggestion(data.suggestion);
      setPromptSuggestionError(null);
      setVeoPrompt(data.suggestion.finalPrompt);
    } catch (error) {
      console.error(error);
      setPromptSuggestionError(error instanceof Error ? error.message : "Failed to enhance prompt");
    } finally {
      setIsPromptLoading(false);
    }
  }, [veoPromptIdea, veoPrompt, isPromptLoading, veoAspectRatio, veoDuration, veoGenerateAudio]);

  const handleBananaGeneration = useCallback(async () => {
    if (bananaIsGenerating || !bananaPrompt.trim()) return;
    setBananaIsGenerating(true);
    setBananaError(null);
    try {
      const payload: Record<string, unknown> = {
        prompt: bananaPrompt,
        aspectRatio: bananaAspectRatio,
        imageSize: bananaImageSize,
      };

      if (bananaSourceImage) {
        payload.sourceImage = { data: bananaSourceImage.data, mimeType: bananaSourceImage.mimeType };
      }

      const response = await fetch("/api/banana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { asset?: RemoteAsset; error?: string };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Failed to generate Banana Pro asset");
      }
      setAssets((prev) => [data.asset!, ...prev]);
      setIsBananaModalOpen(false);
      setBananaPrompt("");
      setBananaError(null);
      setBananaSourceImage(null);
      void fetchAssets();
    } catch (error) {
      console.error(error);
      setBananaError(error instanceof Error ? error.message : "Failed to generate Banana asset");
    } finally {
      setBananaIsGenerating(false);
    }
  }, [bananaIsGenerating, bananaPrompt, bananaAspectRatio, bananaImageSize, bananaSourceImage, fetchAssets]);

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

  const durationLockedToEight = veoResolution !== "720p" || veoReferenceImages.length > 0 || Boolean(veoVideoInput);
  const videoExtensionActive = Boolean(veoVideoInput);

  const handleAssetDragStart = useCallback(
    (asset: RemoteAsset, event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer) return;
      const assetMetadata = metadata[asset.id];
      const payload: AssetDragPayload = {
        id: asset.id,
        name: asset.name,
        url: asset.url,
        type: asset.type,
        duration: resolveAssetDuration(asset),
        width: assetMetadata?.width,
        height: assetMetadata?.height,
      };
      event.dataTransfer.setData(ASSET_DRAG_DATA_MIME, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "copy";
    },
    [resolveAssetDuration, metadata]
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

  const handleVeoDialogChange = useCallback(
    (open: boolean) => {
      if (!open && veoIsGenerating) return;
      if (!open) {
        setVeoError(null);
        setPromptSuggestion(null);
        setPromptSuggestionError(null);
        setVeoPromptIdea("");
        setVeoImageInput(null);
        setVeoLastFrameInput(null);
        setVeoReferenceImages([]);
        setVeoVideoInput(null);
        setVeoNegativePrompt("");
        setVeoResizeMode("pad");
      }
      setIsVeoModalOpen(open);
    },
    [veoIsGenerating]
  );

  const handleBananaDialogChange = useCallback(
    (open: boolean) => {
      if (!open && bananaIsGenerating) return;
      if (!open) {
        setBananaError(null);
        setBananaSourceImage(null);
      }
      setIsBananaModalOpen(open);
    },
    [bananaIsGenerating]
  );

  const activeTranscription = transcriptDialogAssetId ? transcriptions[transcriptDialogAssetId] : null;
  const selectedDetailsAsset = detailsDialogAssetId
    ? assets.find((asset) => asset.id === detailsDialogAssetId)
    : null;
  const selectedDetailsSteps = detailsDialogAssetId
    ? pipelineStates[detailsDialogAssetId] ?? []
    : [];
  const selectedDetailsTranscription = detailsDialogAssetId
    ? transcriptions[detailsDialogAssetId]
    : undefined;
  const uploadMetadata = useMemo(() => {
    const metadata = selectedDetailsSteps.find((step) => step.id === "cloud-upload")?.metadata;
    if (!metadata) return undefined;
    return {
      gcsUri: typeof metadata["gcsUri"] === "string" ? (metadata["gcsUri"] as string) : undefined,
      signedUrl: typeof metadata["signedUrl"] === "string" ? (metadata["signedUrl"] as string) : undefined,
      bucket: typeof metadata["bucket"] === "string" ? (metadata["bucket"] as string) : undefined,
      objectName: typeof metadata["objectName"] === "string" ? (metadata["objectName"] as string) : undefined,
    };
  }, [selectedDetailsSteps]);

  const copyToClipboard = useCallback(async (value: string, label: string) => {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch (error) {
      console.error("Unable to copy value", error);
      toast.error(`Unable to copy ${label.toLowerCase()}`);
    }
  }, []);

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

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Generate AI Assets</h3>
              <p className="text-xs text-muted-foreground">
                Use Veo 3 for video clips or Gemini Banana Pro for polished imagery.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setIsVeoModalOpen(true)}>
                <Clapperboard className="size-4 mr-2" />
                Veo 3 Video
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIsBananaModalOpen(true)}
              >
                <Wand2 className="size-4 mr-2" />
                Banana Pro Image
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Generations are saved to your asset library automatically once complete.
            </p>
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
                {assets.map((asset) => {
                  const transcriptionStep = getPipelineStep(asset.id, "transcription");
                  const transcriptionRecord = transcriptions[asset.id];
                  const canTranscribe = asset.type === "audio" || asset.type === "video";
                  const isProcessing =
                    transcriptionStep?.status === "waiting" || transcriptionStep?.status === "running";
                  let statusLabel: string | null = null;
                  if (transcriptionStep) {
                    if (isProcessing) {
                      statusLabel = "Transcribing...";
                    } else if (transcriptionStep.status === "succeeded") {
                      statusLabel = "Transcript ready";
                    } else if (transcriptionStep.status === "failed") {
                      statusLabel = "Transcription failed";
                    } else if (transcriptionStep.status !== "idle") {
                      statusLabel = "Queued for transcription";
                    }
                  }
                  return (
                    <ContextMenu key={asset.id}>
                      <ContextMenuTrigger asChild>
                        <div
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
                            {statusLabel && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
                                {isProcessing ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <FileText className="size-3" />
                                )}
                                {statusLabel}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {transcriptionRecord?.status === "completed" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleViewTranscription(asset.id);
                                }}
                              >
                                <FileText className="size-4" />
                                <span className="sr-only">View transcription</span>
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDetailsDialogAssetId(asset.id);
                              }}
                            >
                              <FileIcon className="size-4" />
                              <span className="sr-only">View details</span>
                            </Button>
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
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuLabel inset>{asset.name}</ContextMenuLabel>
                        <ContextMenuItem onClick={() => handleAddAssetToTimeline(asset)}>
                          <Plus className="size-4 mr-2" />
                          Add to timeline
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          disabled={!canTranscribe || isProcessing}
                          onClick={() => void handleStartTranscription(asset)}
                        >
                          <FileText className="size-4 mr-2" />
                          {isProcessing ? "Transcribing..." : "Transcribe audio/video"}
                        </ContextMenuItem>
                        {transcriptionRecord?.status === "completed" && (
                          <ContextMenuItem onClick={() => handleViewTranscription(asset.id)}>
                            <Type className="size-4 mr-2" />
                            View transcription
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem onClick={() => setDetailsDialogAssetId(asset.id)}>
                          <FileIcon className="size-4 mr-2" />
                          View details
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
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

      <Dialog
        open={!!transcriptDialogAssetId}
        onOpenChange={(open) => {
          if (!open) {
            setTranscriptDialogAssetId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transcription</DialogTitle>
            <DialogDescription>
              {activeTranscription ? `Transcript for ${activeTranscription.assetName}` : "Select an asset to view its transcript."}
            </DialogDescription>
          </DialogHeader>
          {activeTranscription ? (
            activeTranscription.status === "completed" ? (
              activeTranscription.transcript ? (
                <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {activeTranscription.transcript}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Google Speech-to-Text returned an empty transcript for this asset.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                {activeTranscription.status === "processing"
                  ? "The transcription is still processing. We'll notify you when it finishes."
                  : activeTranscription.error || "No transcription available yet."}
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">No transcription selected.</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detailsDialogAssetId}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsDialogAssetId(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Asset Details</DialogTitle>
            <DialogDescription>
              {selectedDetailsAsset
                ? selectedDetailsAsset.name
                : "Select an asset to view its metadata and pipeline status."}
            </DialogDescription>
          </DialogHeader>
          {selectedDetailsAsset ? (
            <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground">General</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
                    <p className="text-sm font-medium text-foreground truncate" title={selectedDetailsAsset.name}>
                      {selectedDetailsAsset.name}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
                    <p className="text-sm font-medium capitalize">{selectedDetailsAsset.type}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Uploaded</p>
                    <p className="text-sm font-medium">
                      {new Date(selectedDetailsAsset.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Size</p>
                    <p className="text-sm font-medium">{formatBytes(selectedDetailsAsset.size)}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-background/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <span>Asset ID</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => copyToClipboard(selectedDetailsAsset.id, "Asset ID")}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs font-mono break-all">{selectedDetailsAsset.id}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <span>Local asset URL</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => copyToClipboard(selectedDetailsAsset.url, "Local URL")}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs font-mono break-all">{selectedDetailsAsset.url}</p>
                  </div>
                </div>
              </section>

              {uploadMetadata && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">Cloud Storage</h4>
                    <div className="flex flex-wrap gap-2">
                      {uploadMetadata.signedUrl && (
                        <Button type="button" size="sm" variant="outline" asChild>
                          <a href={uploadMetadata.signedUrl} target="_blank" rel="noreferrer">
                            Open signed URL
                          </a>
                        </Button>
                      )}
                      {uploadMetadata.signedUrl && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => copyToClipboard(uploadMetadata.signedUrl!, "Signed URL")}
                        >
                          Copy signed URL
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-border/70 bg-muted/5 p-3">
                    {uploadMetadata.gcsUri && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                          <span>GCS URI</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => copyToClipboard(uploadMetadata.gcsUri!, "GCS URI")}
                          >
                            Copy
                          </Button>
                        </div>
                        <p className="text-xs font-mono break-all">{uploadMetadata.gcsUri}</p>
                      </div>
                    )}
                    {uploadMetadata.bucket && (
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Bucket</p>
                        <p className="text-sm font-medium">{uploadMetadata.bucket}</p>
                      </div>
                    )}
                    {uploadMetadata.objectName && (
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Object name</p>
                        <p className="text-xs font-mono break-all">{uploadMetadata.objectName}</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Pipeline Steps</h4>
                  <p className="text-xs text-muted-foreground">
                    {selectedDetailsSteps.length
                      ? "Auto-run steps with live status"
                      : "Pipeline has not started yet"}
                  </p>
                </div>
                <div className="space-y-4">
                  {selectedDetailsSteps.length ? (
                    selectedDetailsSteps.map((step, index) => (
                      <div key={step.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="rounded-full border border-border/60 bg-background/80 p-1">
                            <StepStatusDot status={step.status} />
                          </div>
                          {index < selectedDetailsSteps.length - 1 && (
                            <div className="mt-1 w-px flex-1 bg-border/70" />
                          )}
                        </div>
                        <div className="flex-1 rounded-lg border border-border/70 bg-background/60 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">{step.label}</p>
                              <p className="text-xs text-muted-foreground">
                                Updated {step.updatedAt ? new Date(step.updatedAt).toLocaleString() : "–"}
                              </p>
                            </div>
                            <StepStatusBadge status={step.status} />
                          </div>
                          {step.error && (
                            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                              {step.error}
                            </p>
                          )}
                          {step.metadata && Object.keys(step.metadata).length > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                                <span>Metadata</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() =>
                                    copyToClipboard(
                                      JSON.stringify(step.metadata, null, 2),
                                      `${step.label} metadata`
                                    )
                                  }
                                >
                                  Copy JSON
                                </Button>
                              </div>
                              <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">
                                {JSON.stringify(step.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No pipeline steps have run yet.</p>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Transcription</h4>
                  {selectedDetailsTranscription && (
                    <span className="text-xs text-muted-foreground capitalize">
                      {selectedDetailsTranscription.status}
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/5 p-3 text-sm">
                  {selectedDetailsTranscription?.transcript ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Full transcript</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() =>
                            copyToClipboard(selectedDetailsTranscription.transcript!, "Transcript")
                          }
                        >
                          Copy text
                        </Button>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded bg-background/40 p-2 text-sm whitespace-pre-wrap">
                        {selectedDetailsTranscription.transcript}
                      </div>
                    </div>
                  ) : selectedDetailsTranscription ? (
                    <p className="text-sm text-muted-foreground">
                      {selectedDetailsTranscription.status === "processing"
                        ? "Transcription is still processing."
                        : selectedDetailsTranscription.error || "No transcription available."}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No transcription available.</p>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No asset selected.</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={isVeoModalOpen} onOpenChange={handleVeoDialogChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Veo 3 Video</DialogTitle>
            <DialogDescription>
              Describe the shot you want. Generation typically takes 20-40 seconds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Prompt</label>
              <textarea
                value={veoPrompt}
                onChange={(event) => setVeoPrompt(event.target.value)}
                rows={4}
                disabled={veoIsGenerating}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm resize-none"
                placeholder="Cinematic dolly shot through a neon city street at night..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Need help? Describe the idea</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <input
                  type="text"
                  value={veoPromptIdea}
                  onChange={(event) => setVeoPromptIdea(event.target.value)}
                  placeholder="Short idea to expand (e.g. astronaut explores coral canyon)"
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  disabled={veoIsGenerating}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handlePromptAssist()}
                  disabled={isPromptLoading || (!veoPromptIdea.trim() && !veoPrompt.trim())}
                >
                  {isPromptLoading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  {isPromptLoading ? "Enhancing..." : "Generate Prompt"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Gemini follows the Veo 3.1 prompting guide formula to expand your idea.
              </p>
              {promptSuggestionError && <p className="text-xs text-destructive">{promptSuggestionError}</p>}
            {promptSuggestion && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">Enhanced prompt</p>
                  <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setVeoPrompt(promptSuggestion.finalPrompt)}
                    >
                      Use
                    </Button>
                  </div>
                  <p className="text-foreground text-[13px] leading-relaxed">{promptSuggestion.finalPrompt}</p>
                  <div className="grid gap-1">
                    <p><span className="font-medium">Cinematography:</span> {promptSuggestion.cinematography}</p>
                    <p><span className="font-medium">Subject:</span> {promptSuggestion.subject}</p>
                    <p><span className="font-medium">Action:</span> {promptSuggestion.action}</p>
                    <p><span className="font-medium">Context:</span> {promptSuggestion.context}</p>
                    <p><span className="font-medium">Style:</span> {promptSuggestion.styleAmbiance}</p>
                    <p><span className="font-medium">Audio:</span> {promptSuggestion.audioDirection}</p>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3 rounded-md border border-border/70 bg-muted/10 p-3">
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Optional inputs</h4>
              <p className="text-[11px] text-muted-foreground">
                Animate an image, constrain the last frame, pass up to 3 reference images, or extend a Veo-generated video.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Animate an image</label>
              <input
                type="file"
                accept="image/*"
                disabled={veoIsGenerating}
                onChange={handleVeoImageFileChange}
                className="block text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Ideal for image-to-video or first/last frame workflows.
              </p>
              {veoImageInput && (
                <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-xs">
                  <div>
                    <p className="font-medium truncate">{veoImageInput.name}</p>
                    <p className="text-muted-foreground">{formatBytes(veoImageInput.size)} • {veoImageInput.mimeType}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setVeoImageInput(null);
                      setVeoLastFrameInput(null);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span className="text-[11px] text-muted-foreground">Resize mode</span>
                <select
                  value={veoResizeMode}
                  onChange={(event) => setVeoResizeMode(event.target.value as "pad" | "crop")}
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                  disabled={!veoImageInput || veoIsGenerating}
                >
                  <option value="pad">Pad (default)</option>
                  <option value="crop">Crop</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Last frame (optional)</label>
              <input
                type="file"
                accept="image/*"
                disabled={!veoImageInput || veoIsGenerating}
                onChange={handleVeoLastFrameFileChange}
                className="block text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Requires a starting image to morph into.</p>
              {veoLastFrameInput && (
                <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-xs">
                  <div>
                    <p className="font-medium truncate">{veoLastFrameInput.name}</p>
                    <p className="text-muted-foreground">{formatBytes(veoLastFrameInput.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVeoLastFrameInput(null)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Reference images (max 3)</label>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={veoReferenceImages.length >= 3 || veoIsGenerating}
                onChange={handleReferenceImagesChange}
                className="block text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Great for consistent characters or props. Requires 8s duration when used.
              </p>
              {veoReferenceImages.length > 0 && (
                <div className="space-y-1">
                  {veoReferenceImages.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-xs"
                    >
                      <div>
                        <p className="font-medium truncate">{file.name}</p>
                        <p className="text-muted-foreground">{formatBytes(file.size)}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeReferenceImage(index)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Extend Veo video</label>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                disabled={veoIsGenerating}
                onChange={handleVeoVideoFileChange}
                className="block text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Use a Veo-generated MP4 (720p, ≤141s). Extension adds ~7s and requires 8s duration / 720p output.
              </p>
              {veoVideoInput && (
                <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-xs">
                  <div>
                    <p className="font-medium truncate">{veoVideoInput.name}</p>
                    <p className="text-muted-foreground">{formatBytes(veoVideoInput.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVeoVideoInput(null)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Duration</label>
                <select
                  value={veoDuration}
                  onChange={(event) => setVeoDuration(Number(event.target.value))}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  disabled={veoIsGenerating}
                >
                  <option value={4} disabled={durationLockedToEight}>
                    4 seconds
                  </option>
                  <option value={6} disabled={durationLockedToEight}>
                    6 seconds
                  </option>
                  <option value={8}>8 seconds</option>
                </select>
                {durationLockedToEight && (
                  <p className="text-[11px] text-muted-foreground">
                    Reference images, 1080p/4k, or video extensions require full 8s clips.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Aspect Ratio</label>
                <select
                  value={veoAspectRatio}
                  onChange={(event) => setVeoAspectRatio(event.target.value as "16:9" | "9:16")}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  disabled={veoIsGenerating}
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Resolution</label>
                <select
                  value={veoResolution}
                  onChange={(event) => setVeoResolution(event.target.value as "720p" | "1080p" | "4k")}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  disabled={veoIsGenerating}
                >
                  <option value="720p">720p</option>
                  <option value="1080p" disabled={videoExtensionActive}>
                    1080p (8s only)
                  </option>
                  <option value="4k" disabled={videoExtensionActive}>
                    4k (8s only)
                  </option>
                </select>
                {videoExtensionActive && (
                  <p className="text-[11px] text-muted-foreground">Video extensions only support 720p outputs.</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Audio</label>
                <label className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={veoGenerateAudio}
                    onChange={(event) => setVeoGenerateAudio(event.target.checked)}
                    disabled={veoIsGenerating}
                  />
                  Generate background audio
                </label>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Negative prompt (optional)</label>
              <textarea
                value={veoNegativePrompt}
                onChange={(event) => setVeoNegativePrompt(event.target.value)}
                rows={2}
                disabled={veoIsGenerating}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm resize-none"
                placeholder="fog, glitching, cartoon, overexposed"
              />
            </div>
            {veoError && <p className="text-sm text-destructive">{veoError}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={veoIsGenerating}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => void handleVeoGeneration()}
              disabled={veoIsGenerating || !veoPrompt.trim()}
            >
              {veoIsGenerating ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
              {veoIsGenerating ? "Generating..." : "Generate Video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBananaModalOpen} onOpenChange={handleBananaDialogChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gemini Banana Pro Image</DialogTitle>
            <DialogDescription>
              Craft a detailed art direction. Banana Pro supports multi-turn editing once assets are on the canvas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Prompt</label>
              <textarea
                value={bananaPrompt}
                onChange={(event) => setBananaPrompt(event.target.value)}
                rows={4}
                disabled={bananaIsGenerating}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm resize-none"
                placeholder="High-contrast concept art of a spacecraft launch pad at dawn..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Aspect Ratio</label>
                <select
                  value={bananaAspectRatio}
                  onChange={(event) => setBananaAspectRatio(event.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  disabled={bananaIsGenerating}
                >
                  <option value="1:1">1:1</option>
                  <option value="3:2">3:2</option>
                  <option value="2:3">2:3</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Image Size</label>
                <select
                  value={bananaImageSize}
                  onChange={(event) => setBananaImageSize(event.target.value as "1K" | "2K" | "4K")}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  disabled={bananaIsGenerating}
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
            </div>
            <div className="space-y-1 rounded-md border border-border/70 bg-muted/10 p-3">
              <label className="text-xs font-medium text-muted-foreground">Image editing (optional)</label>
              <input
                type="file"
                accept="image/*"
                disabled={bananaIsGenerating}
                onChange={handleBananaSourceChange}
                className="block text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Provide an image to edit. Your prompt will describe how Nano Banana Pro should transform it.
              </p>
              {bananaSourceImage && (
                <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-xs">
                  <div>
                    <p className="font-medium truncate">{bananaSourceImage.name}</p>
                    <p className="text-muted-foreground">{formatBytes(bananaSourceImage.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setBananaSourceImage(null)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
            {bananaError && <p className="text-sm text-destructive">{bananaError}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={bananaIsGenerating}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => void handleBananaGeneration()}
              disabled={bananaIsGenerating || !bananaPrompt.trim()}
            >
              {bananaIsGenerating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {bananaIsGenerating ? "Generating..." : "Generate Image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
