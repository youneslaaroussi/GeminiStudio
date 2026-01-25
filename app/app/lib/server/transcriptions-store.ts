import { promises as fs } from "fs";
import path from "path";
import type { TranscriptionSegment, TranscriptionStatus } from "@/app/types/transcription";

export interface StoredTranscriptionJob {
  id: string;
  assetId: string;
  assetName: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  gcsUri: string;
  operationName?: string;
  status: TranscriptionStatus;
  transcript?: string;
  error?: string;
  languageCodes: string[];
  createdAt: string;
  updatedAt: string;
  segments?: TranscriptionSegment[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "transcriptions.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readTranscriptionJobs(): Promise<StoredTranscriptionJob[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoredTranscriptionJob[];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeTranscriptionJobs(jobs: StoredTranscriptionJob[]) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(jobs, null, 2), "utf8");
}

export async function saveTranscriptionJob(job: StoredTranscriptionJob) {
  const jobs = await readTranscriptionJobs();
  const next = jobs.filter((existing) => existing.id !== job.id);
  next.push(job);
  await writeTranscriptionJobs(next);
  return job;
}

export async function updateTranscriptionJob(
  jobId: string,
  updates: Partial<StoredTranscriptionJob>
) {
  const jobs = await readTranscriptionJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const updated: StoredTranscriptionJob = {
    ...jobs[index],
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };
  jobs[index] = updated;
  await writeTranscriptionJobs(jobs);
  return updated;
}

export async function findTranscriptionJobById(jobId: string) {
  const jobs = await readTranscriptionJobs();
  return jobs.find((job) => job.id === jobId);
}

export async function findLatestJobForAsset(assetId: string) {
  const jobs = await readTranscriptionJobs();
  return jobs
    .filter((job) => job.assetId === assetId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export function serializeJob(job: StoredTranscriptionJob) {
  return {
    id: job.id,
    assetId: job.assetId,
    assetName: job.assetName,
    assetUrl: job.assetUrl,
    status: job.status,
    transcript: job.transcript,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    languageCodes: job.languageCodes,
    segments: job.segments,
  };
}
