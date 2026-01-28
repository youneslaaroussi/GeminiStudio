import type { Project } from '@/app/types/timeline';

/**
 * AutomergeProject extends Project with additional metadata
 * needed for version control and branching
 */
export interface AutomergeProject extends Omit<Project, 'transcriptions' | 'transitions'> {
  // Keep transcriptions and transitions as they are for Automerge compatibility
  transcriptions: Record<string, any>;
  transitions: Record<string, any>;

  // Metadata for version control
  _meta: {
    branchId: string;
    commitId: string;
    lastSyncedAt: number;
  };
}

/**
 * Project metadata stored in Firestore
 */
export interface ProjectMetadata {
  id: string;
  name: string;
  currentBranch: string;
  lastModified: number;
  thumbnail?: string;
  owner: string;
  collaborators: string[];
  isPublic: boolean;
}

/**
 * Branch metadata stored in Firestore
 */
export interface BranchMetadata {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  parentBranch?: string;
  parentCommit?: string;
  isProtected: boolean;
}

/**
 * Head state of a branch - stores latest Automerge state
 */
export interface BranchHead {
  commitId: string;
  automergeState: Uint8Array; // Binary Automerge state
  timestamp: number;
  author: string;
}

/**
 * Commit object stored in Firestore
 */
export interface Commit {
  id: string;
  message: string;
  author: string;
  timestamp: number;
  changes: Uint8Array; // Automerge changes
  parentCommitId?: string;
  snapshot?: Uint8Array; // Periodic full snapshots for faster loading
}
