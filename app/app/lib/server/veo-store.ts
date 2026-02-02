import { getAdminFirestore } from "@/app/lib/server/firebase-admin";
import type { StoredVeoJob, VeoJob } from "@/app/types/veo";

const COLLECTION_NAME = "veoJobs";

/**
 * Recursively remove undefined values from an object so it can be written to Firestore.
 * Firestore does not accept undefined; optional fields must be omitted instead.
 */
function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore) as T;
  }
  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value);
      }
    }
    return sanitized as T;
  }
  return obj;
}

export async function readVeoJobs(): Promise<StoredVeoJob[]> {
  const db = await getAdminFirestore();
  const snapshot = await db.collection(COLLECTION_NAME).get();
  return snapshot.docs.map((doc) => doc.data() as StoredVeoJob);
}

export async function saveVeoJob(job: StoredVeoJob): Promise<StoredVeoJob> {
  const db = await getAdminFirestore();
  const sanitized = sanitizeForFirestore(job) as StoredVeoJob;
  await db.collection(COLLECTION_NAME).doc(job.id).set(sanitized);
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

  const sanitized = sanitizeForFirestore(updated) as StoredVeoJob;
  await docRef.set(sanitized);
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
