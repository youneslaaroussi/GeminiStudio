import { create } from "zustand";
import type { VideoEffectJob } from "@/app/types/video-effects";

interface VideoEffectsState {
  jobs: Record<string, VideoEffectJob>;
  jobsByAsset: Record<string, string[]>;
  upsertJob: (job: VideoEffectJob) => void;
  upsertJobs: (jobs: VideoEffectJob[]) => void;
  removeJob: (jobId: string) => void;
  getJobsForAsset: (assetId: string) => VideoEffectJob[];
}

export const useVideoEffectsStore = create<VideoEffectsState>((set, get) => ({
  jobs: {},
  jobsByAsset: {},
  upsertJob: (job) =>
    set((state) => {
      const nextJobs = { ...state.jobs, [job.id]: job };
      const jobIds = state.jobsByAsset[job.assetId] ?? [];
      const hasJob = jobIds.includes(job.id);
      const nextJobsByAsset = {
        ...state.jobsByAsset,
        [job.assetId]: hasJob ? jobIds : [job.id, ...jobIds],
      };
      return {
        jobs: nextJobs,
        jobsByAsset: nextJobsByAsset,
      };
    }),
  upsertJobs: (jobs) =>
    set((state) => {
      const nextJobs = { ...state.jobs };
      const nextJobsByAsset = { ...state.jobsByAsset };

      for (const job of jobs) {
        nextJobs[job.id] = job;
        const jobIds = nextJobsByAsset[job.assetId] ?? [];
        if (!jobIds.includes(job.id)) {
          nextJobsByAsset[job.assetId] = [job.id, ...jobIds];
        }
      }

      return {
        jobs: nextJobs,
        jobsByAsset: nextJobsByAsset,
      };
    }),
  removeJob: (jobId) =>
    set((state) => {
      if (!(jobId in state.jobs)) return state;
      const job = state.jobs[jobId];
      const nextJobs = { ...state.jobs };
      delete nextJobs[jobId];

      const assetIds = Object.keys(state.jobsByAsset);
      const nextJobsByAsset = assetIds.reduce<Record<string, string[]>>(
        (acc, assetId) => {
          const ids = state.jobsByAsset[assetId].filter((id) => id !== jobId);
          if (ids.length > 0) {
            acc[assetId] = ids;
          }
          return acc;
        },
        {}
      );

      return {
        jobs: nextJobs,
        jobsByAsset: nextJobsByAsset,
      };
    }),
  getJobsForAsset: (assetId) => {
    const state = get();
    const jobIds = state.jobsByAsset[assetId] ?? [];
    return jobIds.map((jobId) => state.jobs[jobId]).filter(Boolean);
  },
}));
