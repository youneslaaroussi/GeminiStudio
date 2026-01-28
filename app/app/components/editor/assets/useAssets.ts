"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { RemoteAsset } from "@/app/types/assets";
import { DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";
import type { PipelineStepState } from "@/app/types/pipeline";
import type { TranscriptionSegment } from "@/app/types/transcription";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { toast } from "sonner";
import { extractAudioFromVideo } from "@/app/lib/audio/extract-audio";

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

export function useAssets() {
  const [assets, setAssets] = useState<RemoteAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineStates, setPipelineStates] = useState<
    Record<string, PipelineStepState[]>
  >({});
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>(
    {}
  );

  const publishAssets = useAssetsStore((state) => state.setAssets);
  const upsertAssetMetadata = useAssetsStore((state) => state.upsertMetadata);
  const metadata = useAssetsStore((state) => state.metadata);
  const projectId = useProjectStore((s) => s.projectId);
  const transcriptions = useProjectStore(
    (s) => s.project.transcriptions ?? {}
  );
  const upsertProjectTranscription = useProjectStore(
    (s) => s.upsertProjectTranscription
  );

  const assetsRef = useRef<RemoteAsset[]>([]);
  const pollingJobsRef = useRef(new Set<string>());

  const fetchPipelineStates = useCallback(async () => {
    try {
      const response = await fetch("/api/assets/pipeline");
      if (!response.ok) throw new Error("Failed to load pipeline states");
      const data = (await response.json()) as {
        pipelines?: Array<{ assetId: string; steps: PipelineStepState[] }>;
      };
      const map = Object.fromEntries(
        (data.pipelines ?? []).map((p) => [p.assetId, p.steps])
      );
      setPipelineStates(map);
    } catch (err) {
      console.error("Failed to fetch pipeline states", err);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL("/api/assets", window.location.origin);
      url.searchParams.set("projectId", projectId);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error("Failed to load assets");
      const data = (await response.json()) as { assets: RemoteAsset[] };
      setAssets(data.assets ?? []);
      void fetchPipelineStates();
    } catch (err) {
      console.error(err);
      setError("Could not load assets");
    } finally {
      setIsLoading(false);
    }
  }, [fetchPipelineStates, projectId]);

  const addAssets = useCallback((newAssets: RemoteAsset[]) => {
    setAssets((prev) => [...newAssets, ...prev]);
  }, []);

  const deleteAsset = useCallback(
    async (assetId: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/assets/${assetId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to delete asset");
        }
        setAssets((prev) => prev.filter((a) => a.id !== assetId));
        toast.success("Asset deleted");
        return true;
      } catch (err) {
        console.error("Failed to delete asset", err);
        toast.error("Failed to delete asset", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
        return false;
      }
    },
    []
  );

  const getPipelineStep = useCallback(
    (assetId: string, stepId: string) =>
      pipelineStates[assetId]?.find((step) => step.id === stepId),
    [pipelineStates]
  );

  const resolveAssetDuration = useCallback(
    (asset: RemoteAsset) =>
      assetDurations[asset.id] ?? DEFAULT_ASSET_DURATIONS[asset.type] ?? 5,
    [assetDurations]
  );

  // Poll transcription job
  const pollTranscriptionJob = useCallback(
    async (assetId: string, jobId: string) => {
      const pollKey = `${assetId}:${jobId}`;
      if (pollingJobsRef.current.has(pollKey)) return;
      pollingJobsRef.current.add(pollKey);

      const wait = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      try {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (attempt > 0) await wait(4000);
          const response = await fetch(`/api/transcriptions/${jobId}`);
          const payload = (await response.json()) as {
            job?: ApiTranscriptionJob;
            error?: string;
          };
          if (!response.ok || !payload.job) {
            throw new Error(
              payload.error || "Failed to fetch transcription status"
            );
          }

          const assetSnapshot = assetsRef.current.find(
            (entry) => entry.id === assetId
          );
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
            toast.success("Transcription ready", {
              description: assetSnapshot?.name
                ? `"${assetSnapshot.name}" transcript is ready.`
                : undefined,
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

        toast.error("Transcription timed out");
        void fetchPipelineStates();
      } catch (err) {
        console.error("Polling transcription failed", err);
        toast.error("Unable to poll transcription");
        void fetchPipelineStates();
      } finally {
        pollingJobsRef.current.delete(pollKey);
      }
    },
    [upsertProjectTranscription, fetchPipelineStates]
  );

  // Start transcription
  const startTranscription = useCallback(
    async (asset: RemoteAsset) => {
      if (asset.type !== "audio" && asset.type !== "video") {
        toast.error("Only audio or video assets can be transcribed.");
        return;
      }

      const existingStep = getPipelineStep(asset.id, "transcription");
      const existingJobId =
        typeof existingStep?.metadata?.jobId === "string"
          ? (existingStep.metadata.jobId as string)
          : null;
      if (
        existingJobId &&
        (existingStep?.status === "waiting" ||
          existingStep?.status === "running")
      ) {
        toast.info("Transcription already running");
        void pollTranscriptionJob(asset.id, existingJobId);
        return;
      }

      try {
        let paramOverrides: Record<string, unknown> = {};

        // For video files, extract audio first since Speech-to-Text doesn't support MP4/AAC
        if (asset.type === "video") {
          const extractToastId = toast.loading("Extracting audio from video...", {
            description: "This may take a moment.",
          });

          try {
            const audioBlob = await extractAudioFromVideo(asset.url, (progress) => {
              toast.loading(`Extracting audio... ${Math.round(progress * 100)}%`, {
                id: extractToastId,
              });
            });

            toast.loading("Uploading extracted audio...", { id: extractToastId });

            // Upload the extracted audio
            const formData = new FormData();
            formData.append("audio", audioBlob, `${asset.name}.wav`);
            formData.append("assetId", asset.id);

            const uploadResponse = await fetch("/api/transcriptions/audio", {
              method: "POST",
              body: formData,
            });

            if (!uploadResponse.ok) {
              const uploadError = (await uploadResponse.json()) as { error?: string };
              throw new Error(uploadError.error || "Failed to upload extracted audio");
            }

            const { gcsUri: audioGcsUri } = (await uploadResponse.json()) as { gcsUri: string };
            paramOverrides = { audioGcsUri };

            toast.dismiss(extractToastId);
          } catch (extractErr) {
            toast.dismiss(extractToastId);
            throw new Error(
              `Audio extraction failed: ${extractErr instanceof Error ? extractErr.message : "Unknown error"}`
            );
          }
        }

        const response = await fetch(`/api/assets/${asset.id}/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: "transcription", paramOverrides }),
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
        const step = payload.pipeline.steps.find(
          (s) => s.id === "transcription"
        );
        const jobId =
          typeof step?.metadata?.jobId === "string"
            ? (step.metadata.jobId as string)
            : null;

        if (
          jobId &&
          (step?.status === "waiting" || step?.status === "running")
        ) {
          toast.success("Transcription started", {
            description: `We'll notify you when "${asset.name}" is ready.`,
          });
          void pollTranscriptionJob(asset.id, jobId);
        } else if (step?.status === "succeeded") {
          toast.success("Transcription ready");
        }
      } catch (err) {
        console.error("Transcription request failed", err);
        toast.error("Unable to start transcription", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [getPipelineStep, pollTranscriptionJob]
  );

  // Initial fetch
  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Publish to global store
  useEffect(() => {
    publishAssets(assets);
    assetsRef.current = assets;
  }, [assets, publishAssets]);

  // Sync transcription from pipeline states
  useEffect(() => {
    Object.entries(pipelineStates).forEach(([assetId, steps]) => {
      const transcriptionStep = steps.find((step) => step.id === "transcription");
      if (
        transcriptionStep?.status === "succeeded" &&
        typeof transcriptionStep.metadata?.transcript === "string"
      ) {
        const assetSnapshot = assetsRef.current.find(
          (entry) => entry.id === assetId
        );
        if (!assetSnapshot) return;
        upsertProjectTranscription({
          assetId,
          assetName: assetSnapshot.name,
          assetUrl: assetSnapshot.url,
          status: "completed",
          jobId: (transcriptionStep.metadata.jobId as string) || undefined,
          transcript: transcriptionStep.metadata.transcript as string,
          languageCodes:
            (transcriptionStep.metadata.languageCodes as string[]) ?? ["en-US"],
          createdAt: transcriptionStep.startedAt ?? new Date().toISOString(),
          updatedAt: transcriptionStep.updatedAt,
          segments: Array.isArray(transcriptionStep.metadata.segments)
            ? (transcriptionStep.metadata.segments as TranscriptionSegment[])
            : [],
        });
      }
    });
  }, [pipelineStates, upsertProjectTranscription]);

  // Auto-poll running transcriptions
  useEffect(() => {
    Object.entries(pipelineStates).forEach(([assetId, steps]) => {
      const transcriptionStep = steps.find((step) => step.id === "transcription");
      const jobId = transcriptionStep?.metadata?.jobId;
      if (
        typeof jobId === "string" &&
        (transcriptionStep?.status === "waiting" ||
          transcriptionStep?.status === "running")
      ) {
        void pollTranscriptionJob(assetId, jobId);
      }
    });
  }, [pipelineStates, pollTranscriptionJob]);

  // Poll pipeline states when there are running/queued steps
  useEffect(() => {
    const hasRunningSteps = Object.values(pipelineStates).some((steps) =>
      steps.some((step) => step.status === "running" || step.status === "queued")
    );

    if (!hasRunningSteps) return;

    const interval = setInterval(() => {
      void fetchPipelineStates();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [pipelineStates, fetchPipelineStates]);

  // Persist metadata to server
  const persistMetadataToServer = useCallback(
    async (assetId: string, update: { width?: number; height?: number; duration?: number }) => {
      try {
        await fetch(`/api/assets/${assetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
      } catch (err) {
        console.error("Failed to persist asset metadata", err);
      }
    },
    []
  );

  // Load asset durations and dimensions
  useEffect(() => {
    let cancelled = false;
    const mediaElements: Array<HTMLMediaElement | HTMLImageElement> = [];

    // Filter to assets that need metadata extraction
    const assetsMissingMetadata = assets.filter((asset) => {
      // Skip if we already have local duration cached
      if (assetDurations[asset.id] != null) return false;
      // If asset already has duration from server, just cache it locally
      if (asset.duration != null) {
        setAssetDurations((prev) => ({ ...prev, [asset.id]: asset.duration! }));
        if (asset.width && asset.height) {
          upsertAssetMetadata(asset.id, {
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
          });
        }
        return false;
      }
      return true;
    });

    assetsMissingMetadata.forEach((asset) => {
      const defaultDuration =
        DEFAULT_ASSET_DURATIONS[asset.type] ?? DEFAULT_ASSET_DURATIONS.other;

      // Check if server already has dimensions (just missing duration/local cache)
      const hasServerDimensions = asset.width != null && asset.height != null;

      if (asset.type === "image") {
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: defaultDuration };
        });
        upsertAssetMetadata(asset.id, { duration: defaultDuration });

        // If server already has dimensions, skip client extraction
        if (hasServerDimensions) {
          upsertAssetMetadata(asset.id, {
            width: asset.width,
            height: asset.height,
          });
          return;
        }

        const img = new Image();
        img.src = asset.url;
        img.onload = () => {
          if (cancelled) return;
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          upsertAssetMetadata(asset.id, {
            duration: defaultDuration,
            width,
            height,
          });
          // Persist to server
          void persistMetadataToServer(asset.id, { width, height, duration: defaultDuration });
          img.remove();
        };
        img.onerror = () => img.remove();
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

        const width =
          asset.type === "video" && media instanceof HTMLVideoElement
            ? media.videoWidth || undefined
            : undefined;
        const height =
          asset.type === "video" && media instanceof HTMLVideoElement
            ? media.videoHeight || undefined
            : undefined;

        upsertAssetMetadata(asset.id, { duration, width, height });

        // Persist to server if we extracted new dimensions
        if (!hasServerDimensions && (width || height || duration !== defaultDuration)) {
          void persistMetadataToServer(asset.id, { width, height, duration });
        }

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
  }, [assets, assetDurations, upsertAssetMetadata, persistMetadataToServer]);

  return {
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
    refreshPipelineStates: fetchPipelineStates,
  };
}
