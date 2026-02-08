"use client";

/**
 * IndexedDB cache for compiled scene JavaScript.
 * Keyed by projectId + hash of all component code.
 * Allows instant preview load from cache while recompiling in the background.
 */

const DB_NAME = "gemini-studio-scene-cache";
const STORE_NAME = "compiled-scenes";
const DB_VERSION = 1;

export interface CachedScene {
  /** The compiled JS string */
  js: string;
  /** Hash of the component code that was compiled */
  codeHash: string;
  /** When this entry was cached */
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Compute a simple hash string from component code map.
 * Uses a fast non-cryptographic hash for cache keying.
 */
export function computeCodeHash(componentFiles: Record<string, string>): string {
  const entries = Object.entries(componentFiles).sort(([a], [b]) => a.localeCompare(b));
  const combined = entries.map(([k, v]) => `${k}:${v}`).join("\n---\n");
  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) + hash + combined.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Build the cache key from projectId and code hash.
 */
function cacheKey(projectId: string, codeHash: string): string {
  return `${projectId}:${codeHash}`;
}

/**
 * Get a cached compiled scene, if available.
 */
export async function getCachedScene(
  projectId: string,
  codeHash: string
): Promise<CachedScene | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const key = cacheKey(projectId, codeHash);
    return await new Promise<CachedScene | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value && typeof value.js === "string") {
          resolve(value as CachedScene);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Store a compiled scene in cache.
 */
export async function setCachedScene(
  projectId: string,
  codeHash: string,
  js: string
): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const key = cacheKey(projectId, codeHash);
    const entry: CachedScene = {
      js,
      codeHash,
      cachedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Silently fail -- cache is best-effort
  }
}

/**
 * Delete all cached scenes for a project (e.g., on project deletion).
 */
export async function clearProjectCache(projectId: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (typeof cursor.key === "string" && cursor.key.startsWith(`${projectId}:`)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Silently fail
  }
}
