import type { Project } from '@/app/types/timeline';
import type { AutomergeProject } from './types';

/**
 * Convert a regular Project to an Automerge-compatible project
 */
export function projectToAutomerge(project: Project, branchId: string = 'main'): AutomergeProject {
  return {
    ...project,
    transcriptions: project.transcriptions ?? {},
    transitions: project.transitions ?? {},
    _meta: {
      branchId,
      commitId: crypto.randomUUID(),
      lastSyncedAt: Date.now(),
    },
  };
}

/**
 * Convert an Automerge project back to a regular Project
 * (strips out Automerge metadata)
 */
export function automergeToProject(doc: AutomergeProject): Project {
  const { _meta, ...rest } = doc;
  return rest as Project;
}

/**
 * Validate that an object has the required AutomergeProject structure
 */
export function isValidAutomergeProject(obj: any): obj is AutomergeProject {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.name === 'string' &&
    typeof obj.fps === 'number' &&
    Array.isArray(obj.layers) &&
    typeof obj._meta === 'object' &&
    typeof obj._meta.branchId === 'string' &&
    typeof obj._meta.commitId === 'string' &&
    typeof obj._meta.lastSyncedAt === 'number'
  );
}
