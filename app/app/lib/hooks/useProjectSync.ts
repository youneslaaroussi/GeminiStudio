'use client';

import { useEffect, useCallback } from 'react';
import { useProjectStore } from '@/app/lib/store/project-store';
import { useAuth } from './useAuth'; // You'll need to create this or use your existing auth

/**
 * Hook to initialize project sync when loading a project
 * Call this when you mount the editor page with a projectId
 */
export function useProjectSync(projectId: string | null, branchId: string = 'main') {
  const { initializeSync } = useProjectStore();
  const { user } = useAuth(); // Get current user

  useEffect(() => {
    if (!projectId || !user?.uid) {
      return;
    }

    // Initialize sync with Firestore
    initializeSync(user.uid, projectId, branchId).catch((error) => {
      console.error('Failed to initialize project sync:', error);
    });

    // Cleanup on unmount
    return () => {
      const { syncManager } = useProjectStore.getState();
      syncManager?.destroy();
    };
  }, [projectId, branchId, user?.uid, initializeSync]);
}

/**
 * Hook to monitor online/offline status and update store
 */
export function useOnlineStatus() {
  const { syncManager } = useProjectStore();

  useEffect(() => {
    const handleOnline = () => {
      // Sync manager handles this internally
      console.log('Back online');
    };

    const handleOffline = () => {
      console.log('Gone offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return syncManager?.getIsOnline() ?? true;
}

/**
 * Hook for saving project (manual save)
 */
export function useSaveProject() {
  const { forceSyncToFirestore } = useProjectStore();

  return useCallback(async () => {
    try {
      await forceSyncToFirestore();
      console.log('Project saved to Firestore');
    } catch (error) {
      console.error('Failed to save project:', error);
      throw error;
    }
  }, [forceSyncToFirestore]);
}
