'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, RefreshCw, PauseCircle, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { ImageClip } from "@/app/types/timeline";
import {
  imageEffectDefinitions,
  getVideoEffectDefinition,
} from "@/app/lib/video-effects/definitions";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useVideoEffectsStore } from "@/app/lib/store/video-effects-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ImageEffectsPanelProps {
  clip: ImageClip;
}

const EMPTY_JOB_IDS: string[] = [];

function JobStatusIcon({ status }: { status: VideoEffectJob["status"] }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-4 text-emerald-400" />;
  }
  if (status === "error") {
    return <XCircle className="size-4 text-red-400" />;
  }
  if (status === "running") {
    return <RefreshCw className="size-4 animate-spin text-blue-400" />;
  }
  return <PauseCircle className="size-4 text-muted-foreground" />;
}

/**
 * Resolve the lookup key for jobs: assetId if clip has one, otherwise "url:" + src for imageUrl-based jobs.
 */
function getJobsLookupKey(clip: ImageClip, assetUrl: string | undefined): string | null {
  if (clip.assetId) return clip.assetId;
  if (clip.src) return `url:${clip.src.slice(0, 80)}`;
  return null;
}

export function ImageEffectsPanel({ clip }: ImageEffectsPanelProps) {
  const asset = useAssetsStore(
    useCallback(
      (state) =>
        clip.assetId ? state.assets.find((item) => item.id === clip.assetId) : undefined,
      [clip.assetId]
    )
  );
  const projectId = useProjectStore((state) => state.projectId);
  const [selectedEffectId, setSelectedEffectId] = useState(
    imageEffectDefinitions[0]?.id ?? ""
  );
  const selectedEffect = useMemo(
    () => getVideoEffectDefinition(selectedEffectId),
    [selectedEffectId]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const upsertJob = useVideoEffectsStore((state) => state.upsertJob);
  const upsertJobs = useVideoEffectsStore((state) => state.upsertJobs);
  const jobsMap = useVideoEffectsStore((state) => state.jobs);
  const lookupKey = getJobsLookupKey(clip, asset?.signedUrl ?? asset?.url);
  const jobIds = useVideoEffectsStore(
    useCallback(
      (state) => {
        if (!lookupKey) return EMPTY_JOB_IDS;
        return state.jobsByAsset[lookupKey] ?? EMPTY_JOB_IDS;
      },
      [lookupKey]
    )
  );
  const jobs = useMemo(
    () => jobIds.map((id) => jobsMap[id]).filter(Boolean),
    [jobIds, jobsMap]
  );
  const pollersRef = useRef<Map<string, number>>(new Map());
  const updateClip = useProjectStore((state) => state.updateClip);

  const stopPolling = useCallback((jobId: string) => {
    const handle = pollersRef.current.get(jobId);
    if (handle) {
      window.clearInterval(handle);
      pollersRef.current.delete(jobId);
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`/api/video-effects/${jobId}`, { headers: authHeaders });
        if (!response.ok) {
          if (response.status === 404) {
            stopPolling(jobId);
          }
          return;
        }
        const payload = (await response.json()) as { job?: VideoEffectJob };
        if (payload.job) {
          upsertJob(payload.job);
          if (
            payload.job.status === "completed" ||
            payload.job.status === "error"
          ) {
            stopPolling(jobId);
            if (payload.job.status === "completed") {
              toast.success("Image effect completed", {
                description: payload.job.effectLabel,
              });
            } else {
              toast.error("Image effect failed", {
                description: payload.job.error ?? "Please try again.",
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to poll image effect job", error);
      }
    },
    [stopPolling, upsertJob]
  );

  const ensurePolling = useCallback(
    (job: VideoEffectJob) => {
      if (job.status === "completed" || job.status === "error") {
        stopPolling(job.id);
        return;
      }
      if (pollersRef.current.has(job.id)) return;
      void pollJob(job.id);
      const handle = window.setInterval(() => {
        void pollJob(job.id);
      }, 5000);
      pollersRef.current.set(job.id, handle);
    },
    [pollJob, stopPolling]
  );

  useEffect(() => {
    jobs.forEach((job) => ensurePolling(job));
  }, [jobs, ensurePolling]);

  useEffect(() => {
    return () => {
      pollersRef.current.forEach((handle) => window.clearInterval(handle));
      pollersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!lookupKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const params = clip.assetId ? `assetId=${lookupKey}` : `imageUrl=${encodeURIComponent(clip.src)}`;
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(
          `/api/video-effects?${params}`,
          { signal: controller.signal, headers: authHeaders }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: VideoEffectJob[] };
        if (!cancelled && payload.jobs) {
          upsertJobs(payload.jobs);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load image effect jobs", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lookupKey, clip.assetId, clip.src, upsertJobs]);

  const handleSubmit = useCallback(async () => {
    if (!selectedEffect || isSubmitting || !projectId) return;
    const hasAsset = !!clip.assetId && !!asset;
    const hasImageUrl = !!clip.src;
    if (!hasAsset && !hasImageUrl) {
      toast.error("Image source required", {
        description: "Link to an asset or provide a source URL.",
      });
      return;
    }
    try {
      setIsSubmitting(true);
      const authHeaders = await getAuthHeaders();
      const body: Record<string, unknown> = {
        effectId: selectedEffect.id,
        projectId,
        params: {},
      };
      if (hasAsset) {
        body.assetId = asset!.id;
      } else {
        body.imageUrl = clip.src;
        body.assetName = clip.name || "image";
      }
      const response = await fetch("/api/video-effects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Unable to start effect");
      }

      const payload = (await response.json()) as { job: VideoEffectJob };
      upsertJob(payload.job);
      ensurePolling(payload.job);
      toast.success("Image effect started", {
        description: selectedEffect.label,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to start image effect", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }, [clip, asset, selectedEffect, isSubmitting, projectId, upsertJob, ensurePolling]);

  const handleApply = useCallback(
    (job: VideoEffectJob) => {
      if (!job.resultAssetId) {
        toast.error("Cannot apply", { description: "Result not ready." });
        return;
      }
      // Use playback path (resolved to signed GCS URL by usePlaybackResolvedLayers)
      const playbackSrc = `/api/assets/${job.resultAssetId}/playback?projectId=${encodeURIComponent(projectId ?? "")}`;
      updateClip(clip.id, {
        src: playbackSrc,
        assetId: job.resultAssetId,
      });
      toast.success("Applied!", {
        description: "Clip updated with processed image.",
      });
    },
    [clip.id, projectId, updateClip]
  );

  const displayName = asset?.name ?? clip.name ?? "image";

  if (!selectedEffect) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        No image effects available.
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-amber-400" />
          <span className="text-sm font-medium">AI Image Effects</span>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-4 rounded-lg border border-border bg-muted/10 p-4">
          <p className="text-xs text-muted-foreground">
            Run AI-powered treatments on &quot;{displayName}&quot;.
          </p>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Effect
              </label>
              <select
                value={selectedEffectId}
                onChange={(e) => setSelectedEffectId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                {imageEffectDefinitions.map((def) => (
                  <option key={def.id} value={def.id}>
                    {def.label}
                  </option>
                ))}
              </select>
              {selectedEffect.description && (
                <p className="text-[10px] text-muted-foreground">
                  {selectedEffect.description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Starting…" : "Run Effect"}
            </button>
          </div>

          {/* Recent Runs */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              History
            </p>
            {jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-2">
                No effects run yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="group flex items-center gap-3 rounded-lg bg-background/60 px-3 py-2.5 hover:bg-background/80 transition-colors"
                  >
                    <JobStatusIcon status={job.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {job.effectLabel ?? job.effectId}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {job.resultAssetUrl && (
                      <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                        <a
                          href={job.resultAssetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Preview
                        </a>
                        {job.status === "completed" && (
                          <>
                            <span className="text-border">·</span>
                            <button
                              type="button"
                              onClick={() => handleApply(job)}
                              className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                            >
                              Apply
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {job.error && (
                      <p className="text-[10px] text-red-400 truncate max-w-[120px]" title={job.error}>
                        {job.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
