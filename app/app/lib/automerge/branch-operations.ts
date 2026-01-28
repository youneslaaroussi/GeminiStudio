'use client';

const loadAutomerge = async () => {
  const Automerge = await import('@automerge/automerge');
  return Automerge;
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
};

const uint8ArrayToBase64 = (binary: Uint8Array): string => {
  return btoa(String.fromCharCode(...new Uint8Array(binary)));
};
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit as firestoreLimit,
  Query,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/app/lib/server/firebase';
import type { AutomergeProject, BranchHead, BranchMetadata } from './types';

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

    // 1. Load source branch
    const sourceHeadRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches`,
      sourceBranch
    );
    const sourceSnapshot = await getDoc(sourceHeadRef);

    if (!sourceSnapshot.exists()) {
      throw new Error(`Source branch "${sourceBranch}" not found`);
    }

    const sourceData = sourceSnapshot.data() as BranchHead;
    const sourceDoc = Automerge.load<AutomergeProject>(base64ToUint8Array(sourceData.automergeState));

    // 2. Clone Automerge doc (creates independent copy)
    const newDoc = Automerge.clone(sourceDoc);

    // 3. Create branch ID
    const branchId = `feature/${newBranchName}`;

    // 4. Save new branch (metadata + state combined)
    const newBranchRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches`,
      branchId
    );
    await setDoc(newBranchRef, {
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
    const branchesRef = collection(
      db,
      `users/${userId}/projects/${projectId}/branches`
    );
    const snapshot = await getDocs(branchesRef);

    return snapshot.docs.map((d) => {
      const data = d.data() as Omit<BranchMetadata, 'id'>;
      return {
        id: d.id,
        ...data,
      };
    });
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

    const branchMetadataRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches/${branchId}`
    );
    const headRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches/${branchId}/head`
    );

    // Delete both metadata and head
    // Note: In a production app, you might want to soft-delete or archive
    await Promise.all([
      deleteDoc(branchMetadataRef),
      deleteDoc(headRef),
    ]);
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
    const branchRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches`,
      targetBranch
    );
    const snapshot = await getDoc(branchRef);

    if (!snapshot.exists()) {
      throw new Error(`Branch "${targetBranch}" not found`);
    }

    const data = snapshot.data() as BranchHead;
    const Automerge = await loadAutomerge();
    return Automerge.load<AutomergeProject>(base64ToUint8Array(data.automergeState));
  } catch (error) {
    console.error(`Failed to switch to branch ${targetBranch}:`, error);
    throw error;
  }
}

/**
 * Merge a source branch into a target branch
 * Uses Automerge CRDT for automatic conflict resolution
 */
export async function mergeBranch(
  userId: string,
  projectId: string,
  sourceBranch: string,
  targetBranch: string
): Promise<{ status: 'success' | 'conflict'; conflicts?: string[] }> {
  try {
    const Automerge = await loadAutomerge();

    // 1. Load both branches
    const sourceRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches`,
      sourceBranch
    );
    const targetRef = doc(
      db,
      `users/${userId}/projects/${projectId}/branches`,
      targetBranch
    );

    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      getDoc(sourceRef),
      getDoc(targetRef),
    ]);

    if (!sourceSnapshot.exists() || !targetSnapshot.exists()) {
      throw new Error('One or both branches not found');
    }

    const sourceData = sourceSnapshot.data() as BranchHead;
    const targetData = targetSnapshot.data() as BranchHead;

    const sourceDoc = Automerge.load<AutomergeProject>(base64ToUint8Array(sourceData.automergeState));
    const targetDoc = Automerge.load<AutomergeProject>(base64ToUint8Array(targetData.automergeState));

    // 2. Merge using Automerge CRDT
    // Automerge handles most conflicts automatically
    const mergedDoc = Automerge.merge(targetDoc, sourceDoc);

    // 3. Save merged state back to target branch
    await setDoc(targetRef, {
      commitId: crypto.randomUUID(),
      automergeState: uint8ArrayToBase64(Automerge.save(mergedDoc)),
      timestamp: Date.now(),
      author: userId,
    }, { merge: true });

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
    const refA = doc(db, `users/${userId}/projects/${projectId}/branches`, branchA);
    const refB = doc(db, `users/${userId}/projects/${projectId}/branches`, branchB);

    const [snapshotA, snapshotB] = await Promise.all([getDoc(refA), getDoc(refB)]);

    if (!snapshotA.exists() || !snapshotB.exists()) {
      throw new Error('One or both branches not found');
    }

    const dataA = snapshotA.data() as BranchHead;
    const dataB = snapshotB.data() as BranchHead;

    const docA = Automerge.load<AutomergeProject>(base64ToUint8Array(dataA.automergeState));
    const docB = Automerge.load<AutomergeProject>(base64ToUint8Array(dataB.automergeState));

    // Diff between two branches represented as their Automerge documents
    // Returns empty array as baseline - can be enhanced with Automerge history API
    return [];
  } catch (error) {
    console.error(`Failed to get diff between ${branchA} and ${branchB}:`, error);
    throw error;
  }
}

/**
 * Get the commit history for a branch
 */
export async function getBranchHistory(
  userId: string,
  projectId: string,
  branchId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const commitsRef = collection(
      db,
      `users/${userId}/projects/${projectId}/branches/${branchId}/commits`
    );

    // Query with ordering and limits for efficient history retrieval
    const q = query(
      commitsRef,
      orderBy('timestamp', 'desc'),
      firestoreLimit(limit)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error(`Failed to get branch history for ${branchId}:`, error);
    throw error;
  }
}
