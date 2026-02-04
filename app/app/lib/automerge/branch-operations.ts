'use client';

const loadAutomerge = async () => {
  const Automerge = await import('@automerge/automerge');
  return Automerge;
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  return new Uint8Array(atob(base64).split('').map((c) => c.charCodeAt(0)));
};

const uint8ArrayToBase64 = (binary: Uint8Array): string => {
  return btoa(String.fromCharCode(...new Uint8Array(binary)));
};

import { ref, get, set, remove } from 'firebase/database';
import { dbRealtime } from '@/app/lib/server/firebase';
import type { AutomergeProject, BranchHead, BranchMetadata } from './types';

function branchPath(userId: string, projectId: string, branchId: string): string {
  return `users/${userId}/projects/${projectId}/branches/${branchId}`;
}

function branchesPath(userId: string, projectId: string): string {
  return `users/${userId}/projects/${projectId}/branches`;
}

/**
 * Create a new branch from an existing branch
 */
export async function createBranch(
  userId: string,
  projectId: string,
  sourceBranch: string,
  newBranchName: string
): Promise<string> {
  try {
    const Automerge = await loadAutomerge();

    const sourceRef = ref(dbRealtime, branchPath(userId, projectId, sourceBranch));
    const sourceSnapshot = await get(sourceRef);
    const sourceData = sourceSnapshot.val() as BranchHead | null;

    if (!sourceData?.automergeState) {
      throw new Error(`Source branch "${sourceBranch}" not found`);
    }

    const raw =
      typeof sourceData.automergeState === 'string'
        ? base64ToUint8Array(sourceData.automergeState)
        : sourceData.automergeState;
    const sourceDoc = (Automerge as { load<T>(d: Uint8Array): T }).load<AutomergeProject>(raw);

    const newDoc = Automerge.clone(sourceDoc);

    const safeName = newBranchName.replace(/\//g, '_').replace(/\s+/g, '_').trim() || 'unnamed';
    const branchId = `feature_${safeName}`;

    const newBranchRef = ref(dbRealtime, branchPath(userId, projectId, branchId));
    await set(newBranchRef, {
      name: newBranchName,
      createdAt: Date.now(),
      createdBy: userId,
      parentBranch: sourceBranch,
      parentCommit: sourceData.commitId,
      isProtected: false,
      commitId: crypto.randomUUID(),
      automergeState: uint8ArrayToBase64(Automerge.save(newDoc)),
      timestamp: Date.now(),
      author: userId,
    });

    return branchId;
  } catch (error) {
    console.error(`Failed to create branch:`, error);
    throw error;
  }
}

/**
 * List all branches for a project
 */
export async function listBranches(
  userId: string,
  projectId: string
): Promise<Array<BranchMetadata & { id: string }>> {
  try {
    console.log('[listBranches] userId:', userId);
    console.log('[listBranches] projectId:', projectId);
    const branchesRef = ref(dbRealtime, branchesPath(userId, projectId));
    const snapshot = await get(branchesRef);
    const val = snapshot.val() as Record<string, Omit<BranchMetadata, 'id'>> | null;

    console.log('[listBranches] val:', val);

    if (!val || typeof val !== 'object') {
      return [];
    }

    return Object.entries(val).map(([id, data]) => ({
      id,
      ...data,
    }));
  } catch (error) {
    console.error('Failed to list branches:', error);
    throw error;
  }
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  userId: string,
  projectId: string,
  branchId: string
): Promise<void> {
  try {
    if (branchId === 'main') {
      throw new Error('Cannot delete main branch');
    }

    const branchRef = ref(dbRealtime, branchPath(userId, projectId, branchId));
    await remove(branchRef);
  } catch (error) {
    console.error(`Failed to delete branch ${branchId}:`, error);
    throw error;
  }
}

/**
 * Switch to a different branch (loads its state)
 */
export async function switchBranch(
  userId: string,
  projectId: string,
  targetBranch: string
): Promise<any> {
  try {
    const Automerge = await loadAutomerge();
    const branchRef = ref(dbRealtime, branchPath(userId, projectId, targetBranch));
    const snapshot = await get(branchRef);
    const data = snapshot.val() as BranchHead | null;

    if (!data?.automergeState) {
      throw new Error(`Branch "${targetBranch}" not found`);
    }

    const raw =
      typeof data.automergeState === 'string'
        ? base64ToUint8Array(data.automergeState)
        : data.automergeState;
    return (Automerge as { load<T>(d: Uint8Array): T }).load<AutomergeProject>(raw);
  } catch (error) {
    console.error(`Failed to switch to branch ${targetBranch}:`, error);
    throw error;
  }
}

/**
 * Merge a source branch into a target branch
 */
export async function mergeBranch(
  userId: string,
  projectId: string,
  sourceBranch: string,
  targetBranch: string
): Promise<{ status: 'success' | 'conflict'; conflicts?: string[] }> {
  try {
    const Automerge = await loadAutomerge();

    const sourceRef = ref(dbRealtime, branchPath(userId, projectId, sourceBranch));
    const targetRef = ref(dbRealtime, branchPath(userId, projectId, targetBranch));

    const [sourceSnapshot, targetSnapshot] = await Promise.all([get(sourceRef), get(targetRef)]);
    const sourceData = sourceSnapshot.val() as BranchHead | null;
    const targetData = targetSnapshot.val() as BranchHead | null;

    if (!sourceData?.automergeState || !targetData?.automergeState) {
      throw new Error('One or both branches not found');
    }

    const toBytes = (v: string | Uint8Array) =>
      typeof v === 'string' ? base64ToUint8Array(v) : v;
    const load = (A: typeof Automerge, d: string | Uint8Array) =>
      (A as { load<T>(x: Uint8Array): T }).load<AutomergeProject>(toBytes(d));

    const sourceDoc = load(Automerge, sourceData.automergeState);
    const targetDoc = load(Automerge, targetData.automergeState);

    const mergedDoc = Automerge.merge(targetDoc, sourceDoc);

    await set(targetRef, {
      ...targetData,
      commitId: crypto.randomUUID(),
      automergeState: uint8ArrayToBase64(Automerge.save(mergedDoc)),
      timestamp: Date.now(),
      author: userId,
    });

    return { status: 'success' };
  } catch (error) {
    console.error(`Failed to merge ${sourceBranch} into ${targetBranch}:`, error);
    throw error;
  }
}

/**
 * Get the diff between two branches
 */
export async function getBranchDiff(
  userId: string,
  projectId: string,
  branchA: string,
  branchB: string
): Promise<any> {
  try {
    const Automerge = await loadAutomerge();
    const refA = ref(dbRealtime, branchPath(userId, projectId, branchA));
    const refB = ref(dbRealtime, branchPath(userId, projectId, branchB));

    const [snapshotA, snapshotB] = await Promise.all([get(refA), get(refB)]);
    const dataA = snapshotA.val() as BranchHead | null;
    const dataB = snapshotB.val() as BranchHead | null;

    if (!dataA?.automergeState || !dataB?.automergeState) {
      throw new Error('One or both branches not found');
    }

    const toBytes = (v: string | Uint8Array) =>
      typeof v === 'string' ? base64ToUint8Array(v) : v;
    const load = (A: typeof Automerge, d: string | Uint8Array) =>
      (A as { load<T>(x: Uint8Array): T }).load<AutomergeProject>(toBytes(d));

    load(Automerge, dataA.automergeState);
    load(Automerge, dataB.automergeState);

    return [];
  } catch (error) {
    console.error(`Failed to get diff between ${branchA} and ${branchB}:`, error);
    throw error;
  }
}

/**
 * Get the commit history for a branch (RTDB: commits under branch node, sort in memory)
 */
export async function getBranchHistory(
  userId: string,
  projectId: string,
  branchId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const commitsRef = ref(dbRealtime, `${branchPath(userId, projectId, branchId)}/commits`);
    const snapshot = await get(commitsRef);
    const val = snapshot.val() as Record<string, { timestamp?: number; [k: string]: unknown }> | null;

    if (!val || typeof val !== 'object') {
      return [];
    }

    const entries = Object.entries(val).map(([id, data]) => ({ id, ...data }));
    entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return entries.slice(0, limit);
  } catch (error) {
    console.error(`Failed to get branch history for ${branchId}:`, error);
    throw error;
  }
}
