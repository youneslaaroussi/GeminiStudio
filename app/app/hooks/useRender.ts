"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { toast } from "sonner";
import type { Project } from "@/app/types/timeline";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

export type RenderFormat = "mp4" | "webm" | "gif";
export type RenderQuality = "low" | "web" | "social" | "studio";

export interface RenderOptions {
  format: RenderFormat;
  quality: RenderQuality;
  fps?: number;
  range?: [number, number]; // [startSeconds, endSeconds] for partial render
}

export interface RenderJobStatus {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed" | "queued";
  progress: number;
  failedReason?: string;
  downloadUrl?: string;
  outputPath?: string;
  processedOn?: number;
  finishedOn?: number;
}

interface StoredRenderJob {
  jobId: string;
  projectId: string;
  outputPath: string;
  startedAt: number;
  status: RenderJobStatus;
}

const STORAGE_KEY = "gemini-render-jobs";
const POLL_INTERVAL = 2000;
const JOB_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadStoredJobs(): StoredRenderJob[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const jobs = JSON.parse(data) as StoredRenderJob[];
    const now = Date.now();
    return jobs.filter((job) => now - job.startedAt < JOB_EXPIRY_MS);
  } catch {
    return [];
  }
}

function saveStoredJobs(jobs: StoredRenderJob[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Ignore storage errors
  }
}

function updateStoredJob(jobId: string, update: Partial<StoredRenderJob>) {
  const jobs = loadStoredJobs();
  const index = jobs.findIndex((j) => j.jobId === jobId);
  if (index >= 0) {
    jobs[index] = { ...jobs[index], ...update };
    saveStoredJobs(jobs);
  }
}

function addStoredJob(job: StoredRenderJob) {
  const jobs = loadStoredJobs();
  jobs.push(job);
  saveStoredJobs(jobs);
}

function removeStoredJob(jobId: string) {
  const jobs = loadStoredJobs().filter((j) => j.jobId !== jobId);
  saveStoredJobs(jobs);
}

interface RenderStore {
  isRendering: boolean;
  jobStatus: RenderJobStatus | null;
  error: string | null;
  activeJobs: StoredRenderJob[];
  currentJobId: string | null;
  currentOutputPath: string | null;
  pollingInterval: NodeJS.Timeout | null;

  // Actions
  setIsRendering: (value: boolean) => void;
  setJobStatus: (status: RenderJobStatus | null) => void;
  setError: (error: string | null) => void;
  setActiveJobs: (jobs: StoredRenderJob[]) => void;
  setCurrentJob: (jobId: string | null, outputPath: string | null) => void;
  setPollingInterval: (interval: NodeJS.Timeout | null) => void;
  reset: () => void;
  clearJob: (jobId: string) => void;
}

const useRenderStore = create<RenderStore>((set, get) => ({
  isRendering: false,
  jobStatus: null,
  error: null,
  activeJobs: [],
  currentJobId: null,
  currentOutputPath: null,
  pollingInterval: null,

  setIsRendering: (value) => set({ isRendering: value }),
  setJobStatus: (status) => set({ jobStatus: status }),
  setError: (error) => set({ error }),
  setActiveJobs: (jobs) => set({ activeJobs: jobs }),
  setCurrentJob: (jobId, outputPath) => set({ currentJobId: jobId, currentOutputPath: outputPath }),
  setPollingInterval: (interval) => set({ pollingInterval: interval }),

  reset: () => {
    const { pollingInterval } = get();
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    set({
      isRendering: false,
      jobStatus: null,
      error: null,
      currentJobId: null,
      currentOutputPath: null,
      pollingInterval: null,
    });
  },

  clearJob: (jobId) => {
    removeStoredJob(jobId);
    const { currentJobId, reset } = get();
    set({ activeJobs: loadStoredJobs() });
    if (currentJobId === jobId) {
      reset();
    }
  },
}));

async function fetchDownloadUrl(gcsPath: string): Promise<string | null> {
  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch("/api/render/download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ gcsPath }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.downloadUrl || null;
    }
  } catch (err) {
    console.error("Failed to fetch download URL:", err);
  }
  return null;
}

async function downloadInBackground(url: string, filename: string): Promise<void> {
  const toastId = toast.loading("Downloading video...");

  try {
    // Use proxy to avoid CORS issues with GCS
    const proxyUrl = `/api/render/download?url=${encodeURIComponent(url)}`;
    const authHeaders = await getAuthHeaders();
    const response = await fetch(proxyUrl, { headers: authHeaders });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
    toast.success("Download complete!", { id: toastId });
  } catch (err) {
    console.error("Download failed:", err);
    toast.error("Download failed", { id: toastId });
  }
}

function showCompletionToast(downloadUrl: string) {
  toast.success("Render complete!", {
    duration: 10000,
    action: {
      label: "Download",
      onClick: () => {
        const filename = `render-${Date.now()}.mp4`;
        downloadInBackground(downloadUrl, filename);
      },
    },
  });
}

async function pollJobStatus(jobId: string) {
  const store = useRenderStore.getState();

  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`/api/render/${jobId}`, { headers: authHeaders });

    if (response.status === 404) {
      if (store.currentOutputPath) {
        const downloadUrl = await fetchDownloadUrl(store.currentOutputPath);
        cancelPolling();
        const completedStatus: RenderJobStatus = {
          jobId,
          state: "completed",
          progress: 100,
          outputPath: store.currentOutputPath,
          downloadUrl: downloadUrl || undefined,
        };
        store.setJobStatus(completedStatus);
        store.setIsRendering(false);
        updateStoredJob(jobId, { status: completedStatus });
        store.setActiveJobs(loadStoredJobs());
        if (downloadUrl) {
          showCompletionToast(downloadUrl);
        }
        return;
      }
      throw new Error("Job not found");
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch job status: ${response.status}`);
    }

    const status = (await response.json()) as RenderJobStatus;
    const fullStatus: RenderJobStatus = {
      ...status,
      outputPath: store.currentOutputPath || status.outputPath,
    };

    store.setJobStatus(fullStatus);
    updateStoredJob(jobId, { status: fullStatus });

    if (status.state === "completed") {
      let finalDownloadUrl = status.downloadUrl;
      if (!finalDownloadUrl && store.currentOutputPath) {
        finalDownloadUrl = await fetchDownloadUrl(store.currentOutputPath) || undefined;
        if (finalDownloadUrl) {
          const updatedStatus = { ...fullStatus, downloadUrl: finalDownloadUrl };
          store.setJobStatus(updatedStatus);
          updateStoredJob(jobId, { status: updatedStatus });
        }
      }
      cancelPolling();
      store.setIsRendering(false);
      store.setActiveJobs(loadStoredJobs());
      if (finalDownloadUrl) {
        showCompletionToast(finalDownloadUrl);
      }
    } else if (status.state === "failed") {
      cancelPolling();
      store.setIsRendering(false);
      store.setActiveJobs(loadStoredJobs());
      store.setError(status.failedReason || "Render failed");
      toast.error("Render failed", {
        description: status.failedReason || "An unknown error occurred",
      });
    }
  } catch (err) {
    console.error("Failed to poll job status:", err);
    store.setError(err instanceof Error ? err.message : "Failed to get job status");
    cancelPolling();
    store.setIsRendering(false);
  }
}

function cancelPolling() {
  const store = useRenderStore.getState();
  if (store.pollingInterval) {
    clearInterval(store.pollingInterval);
    store.setPollingInterval(null);
  }
}

function startPolling(jobId: string) {
  cancelPolling();
  const interval = setInterval(() => {
    pollJobStatus(jobId);
  }, POLL_INTERVAL);
  useRenderStore.getState().setPollingInterval(interval);
  pollJobStatus(jobId);
}

export interface UseRenderReturn {
  isRendering: boolean;
  jobStatus: RenderJobStatus | null;
  error: string | null;
  startRender: (project: Project, projectId: string, options: RenderOptions) => Promise<void>;
  cancelPolling: () => void;
  reset: () => void;
  activeJobs: StoredRenderJob[];
  resumeJob: (job: StoredRenderJob) => void;
  clearJob: (jobId: string) => void;
}

export function useRender(): UseRenderReturn {
  const router = useRouter();
  const store = useRenderStore();

  // Load stored jobs on mount
  useEffect(() => {
    store.setActiveJobs(loadStoredJobs());
  }, []);

  const resumeJob = (job: StoredRenderJob) => {
    store.setCurrentJob(job.jobId, job.outputPath);
    store.setJobStatus(job.status);
    store.setError(null);

    if (job.status.state !== "completed" && job.status.state !== "failed") {
      store.setIsRendering(true);
      startPolling(job.jobId);
    } else {
      store.setIsRendering(false);
      if (job.status.state === "completed" && !job.status.downloadUrl && job.outputPath) {
        fetchDownloadUrl(job.outputPath).then((downloadUrl) => {
          if (downloadUrl) {
            const updatedStatus = { ...job.status, downloadUrl };
            store.setJobStatus(updatedStatus);
            updateStoredJob(job.jobId, { status: updatedStatus });
            store.setActiveJobs(loadStoredJobs());
          }
        });
      }
    }
  };

  const startRender = async (project: Project, projectId: string, options: RenderOptions) => {
    store.setIsRendering(true);
    store.setError(null);
    store.setJobStatus(null);
    cancelPolling();

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ project, projectId, output: options }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string; required?: number };
        if (response.status === 402) {
          const msg = data.error ?? "Insufficient credits";
          store.setError(msg);
          store.setIsRendering(false);
          toast.error(msg, {
            description:
              data.required != null
                ? `This render requires ${data.required} R‑Credits. Add credits to continue.`
                : "Add credits in Settings to continue.",
            action: {
              label: "Add credits",
              onClick: () => router.push("/settings?billing=fill"),
            },
          });
          return;
        }
        throw new Error(data.error || `Render request failed: ${response.status}`);
      }

      const data = (await response.json()) as { jobId: string; status: string; outputPath?: string };
      store.setCurrentJob(data.jobId, data.outputPath || null);

      const initialStatus: RenderJobStatus = {
        jobId: data.jobId,
        state: "queued",
        progress: 0,
        outputPath: data.outputPath,
      };
      store.setJobStatus(initialStatus);

      addStoredJob({
        jobId: data.jobId,
        projectId,
        outputPath: data.outputPath || "",
        startedAt: Date.now(),
        status: initialStatus,
      });
      store.setActiveJobs(loadStoredJobs());

      startPolling(data.jobId);
    } catch (err) {
      console.error("Failed to start render:", err);
      store.setError(err instanceof Error ? err.message : "Failed to start render");
      store.setIsRendering(false);
    }
  };

  return {
    isRendering: store.isRendering,
    jobStatus: store.jobStatus,
    error: store.error,
    startRender,
    cancelPolling,
    reset: store.reset,
    activeJobs: store.activeJobs,
    resumeJob,
    clearJob: store.clearJob,
  };
}
