/**
 * Firebase Admin SDK initialization for server-side operations.
 *
 * Used for:
 * - Verifying ID tokens from client
 * - Server-side Firestore access
 */

import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let adminApp: App | null = null;

/**
 * Initialize Firebase Admin SDK.
 * Uses service account credentials from environment variable.
 */
export async function initAdmin(): Promise<App> {
  if (adminApp) {
    return adminApp;
  }

  const apps = getApps();
  if (apps.length > 0) {
    adminApp = apps[0];
    return adminApp;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    // Try parsing as JSON first
    try {
      const credentials = JSON.parse(serviceAccountKey);
      adminApp = initializeApp({
        credential: cert(credentials),
      });
    } catch {
      // If not JSON, treat as file path
      const fs = await import("fs");
      const path = await import("path");

      const keyPath = path.resolve(serviceAccountKey);
      if (fs.existsSync(keyPath)) {
        const credentials = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
        adminApp = initializeApp({
          credential: cert(credentials),
        });
      } else {
        throw new Error(`Service account key file not found: ${keyPath}`);
      }
    }
  } else {
    // Use application default credentials
    adminApp = initializeApp();
  }

  return adminApp;
}

/**
 * Get admin Firestore instance.
 */
export async function getAdminFirestore() {
  await initAdmin();
  return getFirestore();
}

/**
 * Get admin Auth instance.
 */
export async function getAdminAuth() {
  await initAdmin();
  return getAuth();
}

/**
 * Verify that a user owns a specific project.
 * Returns true if the project exists under the user's collection.
 */
export async function verifyProjectOwnership(
  userId: string,
  projectId: string
): Promise<boolean> {
  const db = await getAdminFirestore();
  const projectRef = db.doc(`users/${userId}/projects/${projectId}`);
  const projectDoc = await projectRef.get();
  return projectDoc.exists;
}
