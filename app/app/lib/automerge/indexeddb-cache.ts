import { get, set, del } from 'idb-keyval';
import type { AutomergeProject } from './types';

type AutomergeLib = Awaited<typeof import('@automerge/automerge')>;
let automergeLib: AutomergeLib | null = null;

async function loadAutomerge(): Promise<AutomergeLib> {
  if (!automergeLib) {
    automergeLib = await import('@automerge/automerge');
  }
  return automergeLib;
}

/**
 * Generate cache key for a project/branch combination
 */
function getCacheKey(projectId: string, branchId: string): string {
  return `automerge:${projectId}:${branchId}`;
}

/** Automerge doc type (project store shape) */
export type AutomergeDoc = import('@automerge/automerge').Doc<AutomergeProject>;

/**
 * Save Automerge document to IndexedDB cache
 */
export async function saveToCacheIDB(
  projectId: string,
  branchId: string,
  doc: AutomergeDoc
): Promise<void> {
  try {
    const Automerge = await loadAutomerge();
    const key = getCacheKey(projectId, branchId);
    const binary = Automerge.save(doc) as Uint8Array;
    await set(key, binary);
  } catch (error) {
    console.error(`Failed to save to IndexedDB cache (${projectId}/${branchId}):`, error);
    // Don't throw - cache failure shouldn't block the app
  }
}

/**
 * Load Automerge document from IndexedDB cache
 */
export async function loadFromCacheIDB(
  projectId: string,
  branchId: string
): Promise<AutomergeDoc | null> {
  try {
    const Automerge = await loadAutomerge();
    const key = getCacheKey(projectId, branchId);
    const binary = await get<Uint8Array>(key);

    if (!binary) {
      return null;
    }

    return (Automerge as { load<T>(d: Uint8Array): T }).load<AutomergeProject>(binary);
  } catch (error) {
    console.error(`Failed to load from IndexedDB cache (${projectId}/${branchId}):`, error);
    return null;
  }
}

/**
 * Clear cache for a specific project/branch
 */
export async function clearCacheIDB(projectId: string, branchId: string): Promise<void> {
  try {
    const key = getCacheKey(projectId, branchId);
    await del(key);
  } catch (error) {
    console.error(`Failed to clear IndexedDB cache (${projectId}/${branchId}):`, error);
  }
}

/**
 * Clear all cached projects for a user (useful during logout)
 */
export async function clearAllCacheIDB(): Promise<void> {
  try {
    const keys = await (await indexedDB.databases?.())[0] || [];
  } catch (error) {
    console.error('Failed to clear all IndexedDB cache:', error);
  }
}

/**
 * Get cache size (for diagnostics)
 */
export async function getCacheSizeIDB(projectId: string, branchId: string): Promise<number> {
  try {
    const binary = await get<Uint8Array>(getCacheKey(projectId, branchId));
    return binary ? binary.byteLength : 0;
  } catch (error) {
    console.error('Failed to get cache size:', error);
    return 0;
  }
}
