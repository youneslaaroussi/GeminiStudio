import { promises as fs } from "fs";
import path from "path";
import type { StoredVeoJob, VeoJob } from "@/app/types/veo";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "veo-jobs.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readVeoJobs(): Promise<StoredVeoJob[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoredVeoJob[];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeVeoJobs(jobs: StoredVeoJob[]) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(jobs, null, 2), "utf8");
}

export async function saveVeoJob(job: StoredVeoJob) {
  const jobs = await readVeoJobs();
  const next = jobs.filter((existing) => existing.id !== job.id);
  next.push(job);
  await writeVeoJobs(next);
  return job;
}

export async function updateVeoJob(
  jobId: string,
  updates: Partial<StoredVeoJob>
) {
  const jobs = await readVeoJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const updated: StoredVeoJob = {
    ...jobs[index],
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };
  jobs[index] = updated;
  await writeVeoJobs(jobs);
  return updated;
}

export async function findVeoJobById(jobId: string) {
  const jobs = await readVeoJobs();
  return jobs.find((job) => job.id === jobId);
}

export async function findVeoJobsByProject(projectId: string) {
  const jobs = await readVeoJobs();
  return jobs
    .filter((job) => job.params.projectId === projectId)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export function serializeVeoJob(job: StoredVeoJob): VeoJob {
  const { operationName, ...rest } = job;
  return rest;
}
