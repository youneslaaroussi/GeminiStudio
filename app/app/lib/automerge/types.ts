import type { Project } from '@/app/types/timeline';

/**
 * AutomergeProject extends Project with additional metadata
 * needed for version control and branching
 */
export interface AutomergeProject extends Omit<Project, 'transcriptions' | 'transitions'> {
  transcriptions: Record<string, any>;
  transitions: Record<string, any>;
  _meta: {
    branchId: string;
    commitId: string;
    lastSyncedAt: number;
  };
  /** Serialized project JSON used by sync / Firebase format */
  projectJSON?: string;
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
  /** Base64 string (Firestore) or binary */
  automergeState: string | Uint8Array;
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
