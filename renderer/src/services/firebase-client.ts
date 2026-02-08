/**
 * Firebase client for the renderer service.
 *
 * Connects to Firebase Realtime Database to fetch project data (Automerge state),
 * decodes it, and returns the Project JSON.
 *
 * The renderer is on a private network — no ownership checks are performed here.
 * Callers (app, langgraph) verify ownership before sending render requests.
 */

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import * as admin from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { logger } from '../logger.js';
import type { RendererConfig } from '../config.js';
import type { Project } from '../types/index.js';

let initialized = false;

/**
 * Initialize Firebase Admin SDK (idempotent).
 */
function initFirebase(config: RendererConfig): void {
  if (initialized) return;

  const keySource = config.firebaseServiceAccountKey;
  if (!keySource) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not configured');
  }

  let credential: admin.Credential;

  // Try as file path first, then as JSON string
  if (existsSync(keySource)) {
    const raw = readFileSync(keySource, 'utf-8');
    const serviceAccount = JSON.parse(raw);
    credential = admin.cert(serviceAccount);
  } else {
    try {
      const serviceAccount = JSON.parse(keySource);
      credential = admin.cert(serviceAccount);
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is neither a valid file path nor valid JSON',
      );
    }
  }

  const databaseURL =
    config.firebaseDatabaseUrl ||
    (config.gcpProjectId
      ? `https://${config.gcpProjectId}-default-rtdb.firebaseio.com`
      : undefined);

  admin.initializeApp({
    credential,
    databaseURL,
  });

  initialized = true;
  logger.info({ databaseURL }, 'Firebase Admin SDK initialized');
}

/**
 * Fetch project data from Firebase Realtime Database and decode from Automerge.
 *
 * Path: users/{userId}/projects/{projectId}/branches/{branchId}
 * The branch contains an `automergeState` field (base64-encoded Automerge document).
 * The Automerge document contains a `projectJSON` field (stringified Project JSON).
 */
export async function fetchBranchProject(
  config: RendererConfig,
  userId: string,
  projectId: string,
  branchId: string,
): Promise<Project> {
  initFirebase(config);

  const branchPath = `users/${userId}/projects/${projectId}/branches/${branchId}`;
  logger.info({ branchPath }, 'Fetching project from Firebase RTDB');

  const db = getDatabase();
  const snapshot = await db.ref(branchPath).get();
  const data = snapshot.val();

  if (!data) {
    throw new Error(
      `Branch not found: ${branchPath}. Project or branch may not exist.`,
    );
  }

  const automergeState = data.automergeState;
  if (!automergeState) {
    throw new Error(
      `No automergeState in branch ${branchPath}. Branch may be empty.`,
    );
  }

  // Decode Automerge state: base64 -> Uint8Array -> Automerge.load() -> extract projectJSON
  logger.info({ branchPath }, 'Decoding Automerge state');

  // Dynamic import to avoid top-level ESM issues with automerge WASM
  const Automerge = await import('@automerge/automerge');

  const binary =
    typeof automergeState === 'string'
      ? base64ToUint8Array(automergeState)
      : new Uint8Array(automergeState);

  const doc = Automerge.load<{ projectJSON?: string }>(binary);

  if (!doc.projectJSON) {
    throw new Error(
      `Automerge document at ${branchPath} has no projectJSON field.`,
    );
  }

  const project: Project = JSON.parse(doc.projectJSON);

  logger.info(
    {
      branchPath,
      projectName: project.name,
      layers: project.layers?.length ?? 0,
      resolution: project.resolution,
    },
    'Project fetched and decoded from Firebase',
  );

  return project;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}
