'use client';

import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/app/lib/server/firebase';
import { saveToCacheIDB, loadFromCacheIDB, type AutomergeDoc } from './indexeddb-cache';
import type { AutomergeProject, BranchHead } from './types';

const loadAutomerge = async () => {
  return import('@automerge/automerge');
};

function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split('').map((c) => c.charCodeAt(0)));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function toBytes(v: string | Uint8Array): Uint8Array {
  return typeof v === 'string' ? base64ToUint8Array(v) : v;
}

/**
 * Represents a single undoable/redoable change
 */
type UndoRedoChange = {
  snapshot: any;
  description?: string;
  timestamp: number;
};

/**
 * Debounce helper
 */
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

/**
 * ProjectSyncManager handles offline/online sync between Automerge, IndexedDB, and Firestore
 */
export class ProjectSyncManager {
  private automergeDoc: any = null;
  private automerge: any = null;
  private unsubscribe?: () => void;
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private lastRemoteTimestamp: number = 0;

  // Undo/redo stacks
  private undoStack: UndoRedoChange[] = [];
  private redoStack: UndoRedoChange[] = [];

  constructor(
    private userId: string,
    private projectId: string,
    private branchId: string,
    private onUpdate: (doc: any) => void,
    private onFirebaseSync?: () => void
  ) {
    this.debouncedSyncToFirestore = debounce(this.syncToFirestore.bind(this), 1000);
  }

  /**
   * Ensure Automerge is loaded before use
   */
  private async ensureAutomerge() {
    if (!this.automerge) {
      this.automerge = await loadAutomerge();
    }
    return this.automerge;
  }

  /**
   * Initialize sync manager - load from cache, fetch from Firestore, setup listeners
   */
  async initialize(): Promise<void> {
    try {
      // Ensure Automerge is loaded
      const Automerge = await this.ensureAutomerge();

      // 1. Load from IndexedDB cache (offline-first)
      const cached = await loadFromCacheIDB(this.projectId, this.branchId);
      if (cached) {
        this.automergeDoc = cached;
        this.onUpdate(cached);
      }

      // 2. Sync with Firestore if online
      if (this.isOnline) {
        await this.syncWithFirestore();
      }

      // 3. If still no document, create an empty one
      if (!this.automergeDoc) {
        this.automergeDoc = Automerge.from({});
      }

      // 4. Setup real-time Firestore listener
      this.setupFirestoreListener();

      // 5. Setup network handlers
      this.setupNetworkHandlers();
    } catch (error) {
      console.error(`Failed to initialize sync manager (${this.projectId}/${this.branchId}):`, error);
      throw error;
    }
  }

  /**
   * Fetch latest state from Firestore and merge with local
   */
  private async syncWithFirestore(): Promise<void> {
    try {
      const branchRef = doc(
        db,
        `users/${this.userId}/projects/${this.projectId}/branches`,
        this.branchId
      );
      const snapshot = await getDoc(branchRef);

      if (snapshot.exists()) {
        const data = snapshot.data() as BranchHead;
        const binary = toBytes(data.automergeState);
        const load = (A: typeof this.automerge, d: Uint8Array) =>
          (A as { load<T>(x: Uint8Array): T }).load<AutomergeProject>(d);
        const remoteDoc = load(this.automerge!, binary);
        this.lastRemoteTimestamp = data.timestamp;

        if (this.automergeDoc) {
          // Merge local + remote using CRDT
          this.automergeDoc = this.automerge.merge(this.automergeDoc, remoteDoc);
        } else {
          this.automergeDoc = remoteDoc;
        }

        // Save merged state to cache
        await saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
        this.onUpdate(this.automergeDoc);
      }
    } catch (error) {
      console.error(`Failed to sync with Firestore (${this.projectId}/${this.branchId}):`, error);
    }
  }

  /**
   * Setup real-time Firestore listener for collaborative editing
   */
  private setupFirestoreListener(): void {
    const branchRef = doc(
      db,
      `users/${this.userId}/projects/${this.projectId}/branches`,
      this.branchId
    );

    this.unsubscribe = onSnapshot(branchRef, (snapshot) => {
      // Skip updates that we just wrote
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }

      if (snapshot.exists()) {
        const data = snapshot.data() as BranchHead;

        // Only merge if this is newer than what we've seen
        if (data.timestamp > this.lastRemoteTimestamp) {
          try {
            const binary = toBytes(data.automergeState);
            const AM = this.automerge!;
            const load = (A: typeof AM, d: Uint8Array) =>
              (A as { load<T>(x: Uint8Array): T }).load<AutomergeProject>(d);
            const remoteDoc = load(AM, binary);

            if (this.automergeDoc) {
              this.automergeDoc = AM.merge(this.automergeDoc, remoteDoc);
            } else {
              this.automergeDoc = remoteDoc;
            }

            this.lastRemoteTimestamp = data.timestamp;
            this.onUpdate(this.automergeDoc);
            saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
          } catch (error) {
            console.error('Failed to merge remote changes:', error);
          }
        }
      }
    });
  }

  /**
   * Apply a local change to the Automerge document
   */
  async applyChange(changeFn: (doc: AutomergeProject) => void, description?: string): Promise<void> {
    if (!this.automergeDoc) {
      throw new Error('Sync manager not initialized');
    }

    try {
      const Automerge = await this.ensureAutomerge();

      // Store snapshot before change
      const snapshotBefore = Automerge.clone(this.automergeDoc);

      // Apply change
      this.automergeDoc = Automerge.change(this.automergeDoc, (doc: AutomergeProject) => {
        changeFn(doc);
      });

      if (this.automergeDoc !== snapshotBefore) {
        console.log('[UNDO] Change tracked. Stack size:', this.undoStack.length + 1);
        this.undoStack.push({
          snapshot: snapshotBefore,
          description,
          timestamp: Date.now(),
        });

        // Clear redo stack on new change
        this.redoStack = [];
      }

      // Save to IndexedDB immediately (offline support)
      await saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);

      // Notify subscribers
      this.onUpdate(this.automergeDoc);

      // Debounced sync to Firestore
      this.debouncedSyncToFirestore();
    } catch (error) {
      console.error('Failed to apply change:', error);
      throw error;
    }
  }

  /**
   * Debounced Firestore sync (defined in constructor)
   */
  private debouncedSyncToFirestore: () => void;

  /**
   * Save current state to Firestore
   */
  private async syncToFirestore(): Promise<void> {
    if (!this.isOnline || !this.automergeDoc) {
      return;
    }

    try {
      const branchRef = doc(
        db,
        `users/${this.userId}/projects/${this.projectId}/branches`,
        this.branchId
      );

      const Automerge = await this.ensureAutomerge();
      const binary = Automerge.save(this.automergeDoc) as Uint8Array;
      const base64 = uint8ArrayToBase64(binary);
      await setDoc(branchRef, {
        commitId: crypto.randomUUID(),
        automergeState: base64,
        timestamp: Date.now(),
        author: this.userId,
      }, { merge: true });

      console.log('[FIREBASE-SYNC] Successfully synced to Firestore');
      this.onFirebaseSync?.();
    } catch (error) {
      console.error('[FIREBASE-SYNC] Failed to sync to Firestore:', error);
    }
  }

  /**
   * Setup network online/offline handlers
   */
  private setupNetworkHandlers(): void {
    const handleOnline = async () => {
      this.isOnline = true;
      // Sync any pending changes
      await this.syncWithFirestore();
      this.debouncedSyncToFirestore();
    };

    const handleOffline = () => {
      this.isOnline = false;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Store cleanup functions for destroy()
    this._cleanupOnline = () => window.removeEventListener('online', handleOnline);
    this._cleanupOffline = () => window.removeEventListener('offline', handleOffline);
  }

  private _cleanupOnline?: () => void;
  private _cleanupOffline?: () => void;

  /**
   * Get current Automerge document
   */
  getDocument(): AutomergeDoc | null {
    return this.automergeDoc;
  }

  /**
   * Check if currently online
   */
  getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Force an immediate Firestore sync (useful for critical saves)
   */
  async forceSyncToFirestore(): Promise<void> {
    await this.syncToFirestore();
  }

  /**
   * Undo last change
   */
  async undo(): Promise<void> {
    if (!this.automergeDoc) {
      throw new Error('Sync manager not initialized');
    }

    if (this.undoStack.length === 0) {
      console.warn('No changes to undo');
      return;
    }

    try {
      const change = this.undoStack.pop();
      if (!change) return;

      this.redoStack.push({
        snapshot: this.automergeDoc,
        description: change.description,
        timestamp: change.timestamp,
      });

      this.automergeDoc = change.snapshot;
      this.onUpdate(this.automergeDoc);

      await saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
      this.debouncedSyncToFirestore();

      console.log('[UNDO] Undo completed. Stack size:', this.undoStack.length);
    } catch (error) {
      console.error('Failed to undo:', error);
    }
  }

  /**
   * Redo last undone change
   */
  async redo(): Promise<void> {
    if (!this.automergeDoc) {
      throw new Error('Sync manager not initialized');
    }

    if (this.redoStack.length === 0) {
      console.warn('No changes to redo');
      return;
    }

    try {
      const change = this.redoStack.pop();
      if (!change) return;

      this.undoStack.push({
        snapshot: this.automergeDoc,
        description: change.description,
        timestamp: change.timestamp,
      });

      this.automergeDoc = change.snapshot;
      this.onUpdate(this.automergeDoc);

      await saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
      this.debouncedSyncToFirestore();

      console.log('[REDO] Redo completed. Stack size:', this.redoStack.length);
    } catch (error) {
      console.error('Failed to redo:', error);
    }
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Cleanup sync manager
   */
  destroy(): void {
    this.unsubscribe?.();
    this._cleanupOnline?.();
    this._cleanupOffline?.();
  }
}
