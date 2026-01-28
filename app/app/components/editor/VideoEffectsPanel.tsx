'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Sparkles, RefreshCw, PauseCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { VideoClip } from "@/app/types/timeline";
import {
  videoEffectDefinitions,
  getVideoEffectDefinition,
} from "@/app/lib/video-effects/definitions";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useVideoEffectsStore } from "@/app/lib/store/video-effects-store";
import type { ToolFieldDefinition } from "@/app/lib/tools/types";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

interface VideoEffectsPanelProps {
  clip: VideoClip;
}

const EMPTY_JOB_IDS: string[] = [];

type FieldValue = string | number | boolean | Record<string, unknown>;

function coerceFieldValue(field: ToolFieldDefinition, rawValue: string): FieldValue {
  if (field.type === "number") {
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (field.type === "json") {
    try {
      return JSON.parse(rawValue);
    } catch {
      return {};
    }
  }
  if (field.type === "select") {
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
  }
  return rawValue;
}

function formatFieldValue(field: ToolFieldDefinition, value: FieldValue | undefined) {
  if (value === undefined) return "";
  if (field.type === "json") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

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

export function VideoEffectsPanel({ clip }: VideoEffectsPanelProps) {
  const asset = useAssetsStore(
    useCallback(
      (state) =>
        clip.assetId ? state.assets.find((item) => item.id === clip.assetId) : undefined,
      [clip.assetId]
    )
  );
  const [selectedEffectId, setSelectedEffectId] = useState(
    videoEffectDefinitions[0]?.id ?? ""
  );
  const selectedEffect = useMemo(
    () => getVideoEffectDefinition(selectedEffectId),
    [selectedEffectId]
  );
  const [formValues, setFormValues] = useState<Record<string, FieldValue>>(
    () => selectedEffect?.defaultValues ?? {}
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const upsertJob = useVideoEffectsStore((state) => state.upsertJob);
  const upsertJobs = useVideoEffectsStore((state) => state.upsertJobs);
  const jobsMap = useVideoEffectsStore((state) => state.jobs);
  const jobIds = useVideoEffectsStore(
    useCallback(
      (state) => {
        if (!asset?.id) return EMPTY_JOB_IDS;
        return state.jobsByAsset[asset.id] ?? EMPTY_JOB_IDS;
      },
      [asset?.id]
    )
  );
  const jobs = useMemo(
    () => jobIds.map((id) => jobsMap[id]).filter(Boolean),
    [jobIds, jobsMap]
  );
  const pollersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!selectedEffect) return;
    setFormValues(selectedEffect.defaultValues as Record<string, FieldValue>);
  }, [selectedEffect]);

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
              toast.success("Video effect completed", {
                description: payload.job.effectLabel,
              });
            } else {
              toast.error("Video effect failed", {
                description: payload.job.error ?? "Please try again.",
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to poll video effect job", error);
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
    if (!asset?.id) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(
          `/api/video-effects?assetId=${asset.id}`,
          { signal: controller.signal, headers: authHeaders }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: VideoEffectJob[] };
        if (!cancelled && payload.jobs) {
          upsertJobs(payload.jobs);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load video effect jobs", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [asset?.id, upsertJobs]);

  const handleInputChange = useCallback(
    (field: ToolFieldDefinition, rawValue: string) => {
      setFormValues((prev) => ({
        ...prev,
        [field.name]: coerceFieldValue(field, rawValue),
      }));
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!asset || !selectedEffect || isSubmitting) return;
    try {
      setIsSubmitting(true);
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/video-effects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          assetId: asset.id,
          effectId: selectedEffect.id,
          params: formValues,
        }),
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
      toast.success("Video effect started", {
        description: selectedEffect.label,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to start video effect", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }, [asset, selectedEffect, isSubmitting, formValues, upsertJob, ensurePolling]);

  if (!asset) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        Link this clip to an uploaded asset to run video effects.
      </div>
    );
  }

  if (!selectedEffect) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        No video effects available.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-amber-400" />
        <div>
          <p className="text-xs font-semibold text-foreground">Video Effects</p>
          <p className="text-xs text-muted-foreground">
            Run AI-powered treatments on “{asset.name}”.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Effect
          </label>
          <select
            value={selectedEffectId}
            onChange={(event) => setSelectedEffectId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {videoEffectDefinitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.label}
              </option>
            ))}
          </select>
          {selectedEffect.description && (
            <p className="text-[10px] text-muted-foreground">
              {selectedEffect.description}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {selectedEffect.fields.map((field) => {
            const value = formValues[field.name];
            const commonProps = {
              id: field.name,
              name: field.name,
              className:
                "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs",
              value: formatFieldValue(field, value),
              onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                handleInputChange(field, event.target.value),
            };

            return (
              <div key={field.name} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {field.label}
                </label>
                {field.type === "textarea" ? (
                  <textarea
                    {...commonProps}
                    rows={3}
                    placeholder={field.placeholder}
                  />
                ) : field.type === "select" ? (
                  <select {...commonProps}>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...commonProps}
                    type={field.type === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                  />
                )}
                {field.description && (
                  <p className="text-[10px] text-muted-foreground">
                    {field.description}
                  </p>
                )}
              </div>
            );
          })}
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

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Recent runs</p>
          {jobs.length === 0 && (
            <span className="text-[10px] text-muted-foreground">
              No jobs yet
            </span>
          )}
        </div>
        {jobs.length > 0 && (
          <div className="mt-2 space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-md border border-border bg-background/80 p-3 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <JobStatusIcon status={job.status} />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {job.effectLabel ?? job.effectId}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {job.resultAssetUrl && (
                    <a
                      href={job.resultAssetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-medium text-primary hover:underline"
                    >
                      View
                    </a>
                  )}
                </div>
                {job.error && (
                  <p className="mt-2 text-[10px] text-red-400">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
