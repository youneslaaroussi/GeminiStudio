'use client';

import { useCallback, useState, useEffect } from 'react';
import * as branchOps from '@/app/lib/automerge/branch-operations';
import type { BranchMetadata } from '@/app/lib/automerge/types';
import { useAuth } from './useAuth';

/**
 * Hook for managing branches
 */
export function useBranches(projectId: string | null) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Array<BranchMetadata & { id: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all branches
  const loadBranches = useCallback(async () => {
    if (!projectId || !user?.uid) return;

    setLoading(true);
    setError(null);
    try {
      const result = await branchOps.listBranches(user.uid, projectId);
      setBranches(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [projectId, user?.uid]);

  // Load branches on mount
  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

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
