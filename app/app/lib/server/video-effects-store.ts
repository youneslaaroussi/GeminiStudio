import { promises as fs } from "fs";
import path from "path";
import type { StoredVideoEffectJob, VideoEffectJob } from "@/app/types/video-effects";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "video-effects-jobs.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readVideoEffectJobs(): Promise<StoredVideoEffectJob[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoredVideoEffectJob[];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeVideoEffectJobs(jobs: StoredVideoEffectJob[]) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(jobs, null, 2), "utf8");
}

export async function saveVideoEffectJob(job: StoredVideoEffectJob) {
  const jobs = await readVideoEffectJobs();
  const next = jobs.filter((existing) => existing.id !== job.id);
  next.push(job);
  await writeVideoEffectJobs(next);
  return job;
}

export async function updateVideoEffectJob(
  jobId: string,
  updates: Partial<StoredVideoEffectJob>
) {
  const jobs = await readVideoEffectJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const updated: StoredVideoEffectJob = {
    ...jobs[index],
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };
  jobs[index] = updated;
  await writeVideoEffectJobs(jobs);
  return updated;
}

export async function findVideoEffectJobById(jobId: string) {
  const jobs = await readVideoEffectJobs();
  return jobs.find((job) => job.id === jobId);
}

export async function findVideoEffectJobsByAsset(assetId: string) {
  const jobs = await readVideoEffectJobs();
  return jobs
    .filter((job) => job.assetId === assetId)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export function serializeVideoEffectJob(job: StoredVideoEffectJob): VideoEffectJob {
  const { providerState, ...rest } = job;
  return rest;
}
