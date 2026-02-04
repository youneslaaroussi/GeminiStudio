'use client';

import { doc, setDoc } from 'firebase/firestore';
import { ref, set } from 'firebase/database';
import { db, dbRealtime } from '@/app/lib/server/firebase';
import { projectToAutomerge } from '@/app/lib/automerge/adapter';
import type { Project } from '@/app/types/timeline';
import type { ProjectMetadata } from '@/app/lib/automerge/types';

const loadAutomerge = async () => {
  const Automerge = await import('@automerge/automerge');
  return Automerge;
};

const uint8ArrayToBase64 = (binary: Uint8Array): string => {
  return btoa(String.fromCharCode(...new Uint8Array(binary)));
};

const MIGRATION_KEY = 'gemini-migration-completed';
const PROJECTS_LIST_KEY = 'gemini-projects-list';
const PROJECT_DATA_PREFIX = 'gemini-project-';

export interface MigrationProgress {
  total: number;
  completed: number;
  failed: number;
  currentProject?: string;
}

/**
 * Check if migration has already been completed
 */
export function isMigrationCompleted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(MIGRATION_KEY) === 'true';
}

/**
 * Migrate all localStorage projects to Firestore
 */
export async function migrateLocalStorageProjects(
  userId: string,
  onProgress?: (progress: MigrationProgress) => void
): Promise<{ success: number; failed: number }> {
  // Check if already migrated
  if (isMigrationCompleted()) {
    console.log('Migration already completed');
    return { success: 0, failed: 0 };
  }

  if (typeof window === 'undefined') {
    console.warn('Migration can only run in browser');
    return { success: 0, failed: 0 };
  }

  try {
    // Load projects list from localStorage
    const projectsList = localStorage.getItem(PROJECTS_LIST_KEY);
    if (!projectsList) {
      console.log('No projects to migrate');
      localStorage.setItem(MIGRATION_KEY, 'true');
      return { success: 0, failed: 0 };
    }

    const projects = JSON.parse(projectsList);
    let successCount = 0;
    let failCount = 0;

    const progress: MigrationProgress = {
      total: projects.length,
      completed: 0,
      failed: 0,
    };

    // Migrate each project
    for (const project of projects) {
      progress.currentProject = project.name;
      onProgress?.(progress);

      try {
        // Load project data from localStorage
        const projectData = localStorage.getItem(`${PROJECT_DATA_PREFIX}${project.id}`);
        if (!projectData) {
          console.warn(`Project ${project.id} data not found in localStorage`);
          failCount++;
          progress.failed++;
          progress.completed++;
          continue;
        }

        const projectJson: Project = JSON.parse(projectData);

        // Convert to Automerge document
        const Automerge = await loadAutomerge();
        const automergeProject = projectToAutomerge(projectJson, 'main');
        const automergeDoc = Automerge.from(automergeProject as any);

        // 1. Save project metadata to Firestore
        const projectMetadataRef = doc(db, `users/${userId}/projects/${project.id}`);
        await setDoc(projectMetadataRef, {
          name: project.name,
          currentBranch: 'main',
          lastModified: project.lastModified || Date.now(),
          owner: userId,
          collaborators: [],
          isPublic: false,
        });

        // 2. Create main branch in Realtime Database (metadata + state combined)
        const branchRef = ref(dbRealtime, `users/${userId}/projects/${project.id}/branches/main`);
        await set(branchRef, {
          name: 'main',
          createdAt: Date.now(),
          createdBy: userId,
          isProtected: false,
          commitId: crypto.randomUUID(),
          automergeState: uint8ArrayToBase64(Automerge.save(automergeDoc)),
          timestamp: Date.now(),
          author: userId,
        });

        successCount++;
        progress.completed++;
      } catch (error) {
        console.error(`Failed to migrate project ${project.id}:`, error);
        failCount++;
        progress.failed++;
        progress.completed++;
      }

      onProgress?.(progress);
    }

    // Mark migration as complete
    localStorage.setItem(MIGRATION_KEY, 'true');

    console.log(`Migration completed: ${successCount} successful, ${failCount} failed`);

    return { success: successCount, failed: failCount };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

/**
 * Reset migration flag (for testing/debugging)
 */
export function resetMigration(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MIGRATION_KEY);
  }
}

/**
 * Check if there are localStorage projects to migrate
 */
export function hasLocalStorageProjects(): boolean {
  if (typeof window === 'undefined') return false;

  const projectsList = localStorage.getItem(PROJECTS_LIST_KEY);
  if (!projectsList) return false;

  try {
    const projects = JSON.parse(projectsList);
    return Array.isArray(projects) && projects.length > 0;
  } catch {
    return false;
  }
}
