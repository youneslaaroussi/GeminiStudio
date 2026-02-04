'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import * as branchOps from '@/app/lib/automerge/branch-operations';
import type { BranchMetadata } from '@/app/lib/automerge/types';
import { useAuth } from './useAuth';

/** Default main branch entry (always present even if RTDB hasn't loaded) */
const makeMainBranch = (userId: string): BranchMetadata & { id: string } => ({
  id: 'main',
  name: 'main',
  createdAt: 0,
  createdBy: userId,
  isProtected: true,
});

/**
 * Hook for managing branches
 * 
 * Offline-first: Always shows main branch immediately, fetches from RTDB in background.
 */
export function useBranches(projectId: string | null) {
  const { user } = useAuth();
  // Start with main branch so UI is never stuck on loading
  const [branches, setBranches] = useState<Array<BranchMetadata & { id: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Initialize with main branch immediately when we have user
  useEffect(() => {
    if (user?.uid && !initializedRef.current) {
      setBranches([makeMainBranch(user.uid)]);
      initializedRef.current = true;
    }
  }, [user?.uid]);

  // Load branches from RTDB (non-blocking background fetch)
  const loadBranches = useCallback(async () => {
    if (!projectId || !user?.uid) {
      return;
    }

    setError(null);
    try {
      const result = await branchOps.listBranches(user.uid, projectId);
      const hasMain = result.some((b) => b.id === 'main');
      const list = hasMain
        ? result
        : [makeMainBranch(user.uid), ...result];
      setBranches(list);
    } catch (err) {
      console.error('[useBranches] Failed to load branches:', err);
      setError(err instanceof Error ? err.message : 'Failed to load branches');
      // Keep showing main branch on error
    }
  }, [projectId, user?.uid]);

  // Fetch branches in background when we have project and user
  useEffect(() => {
    if (!projectId || !user?.uid) {
      return;
    }
    // Fire and forget - don't block UI
    loadBranches();
  }, [projectId, user?.uid, loadBranches]);

  // Create a new branch
  const createBranch = useCallback(
    async (sourceBranch: string, newBranchName: string) => {
      if (!projectId || !user?.uid) return;

      try {
        const branchId = await branchOps.createBranch(
          user.uid,
          projectId,
          sourceBranch,
          newBranchName
        );
        await loadBranches();
        return branchId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create branch';
        setError(message);
        throw err;
      }
    },
    [projectId, user?.uid, loadBranches]
  );

  // Delete a branch
  const deleteBranch = useCallback(
    async (branchId: string) => {
      if (!projectId || !user?.uid) return;

      try {
        await branchOps.deleteBranch(user.uid, projectId, branchId);
        await loadBranches();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete branch';
        setError(message);
        throw err;
      }
    },
    [projectId, user?.uid, loadBranches]
  );

  // Switch to a branch
  const switchBranch = useCallback(
    async (targetBranch: string) => {
      if (!projectId || !user?.uid) return;

      try {
        const doc = await branchOps.switchBranch(user.uid, projectId, targetBranch);
        return doc;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to switch branch';
        setError(message);
        throw err;
      }
    },
    [projectId, user?.uid]
  );

  // Merge branches
  const mergeBranch = useCallback(
    async (sourceBranch: string, targetBranch: string) => {
      if (!projectId || !user?.uid) return;

      try {
        const result = await branchOps.mergeBranch(user.uid, projectId, sourceBranch, targetBranch);
        await loadBranches();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to merge branches';
        setError(message);
        throw err;
      }
    },
    [projectId, user?.uid, loadBranches]
  );

  return {
    branches,
    loading,
    error,
    createBranch,
    deleteBranch,
    switchBranch,
    mergeBranch,
    reloadBranches: loadBranches,
  };
}
