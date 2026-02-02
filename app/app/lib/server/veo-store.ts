import { getAdminFirestore } from "@/app/lib/server/firebase-admin";
import type { StoredVeoJob, VeoJob } from "@/app/types/veo";

const COLLECTION_NAME = "veoJobs";

export async function readVeoJobs(): Promise<StoredVeoJob[]> {
  const db = await getAdminFirestore();
  const snapshot = await db.collection(COLLECTION_NAME).get();
  return snapshot.docs.map((doc) => doc.data() as StoredVeoJob);
}

export async function saveVeoJob(job: StoredVeoJob): Promise<StoredVeoJob> {
  const db = await getAdminFirestore();
  await db.collection(COLLECTION_NAME).doc(job.id).set(job);
  return job;
}

export async function updateVeoJob(
  jobId: string,
  updates: Partial<StoredVeoJob>
): Promise<StoredVeoJob | null> {
  const db = await getAdminFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(jobId);
  const doc = await docRef.get();

  if (!doc.exists) return null;

  const current = doc.data() as StoredVeoJob;
  const updated: StoredVeoJob = {
    ...current,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  await docRef.set(updated);
  return updated;
}

export async function findVeoJobById(jobId: string): Promise<StoredVeoJob | undefined> {
  const db = await getAdminFirestore();
  const doc = await db.collection(COLLECTION_NAME).doc(jobId).get();
  if (!doc.exists) return undefined;
  return doc.data() as StoredVeoJob;
}

export async function findVeoJobsByProject(projectId: string): Promise<StoredVeoJob[]> {
  const db = await getAdminFirestore();
  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where("params.projectId", "==", projectId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as StoredVeoJob);
}

export function serializeVeoJob(job: StoredVeoJob): VeoJob {
  const { operationName, ...rest } = job;
  return rest;
}
