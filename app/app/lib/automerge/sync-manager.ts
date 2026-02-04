'use client';

import { ref, get, set, onValue } from 'firebase/database';
import { dbRealtime } from '@/app/lib/server/firebase';
import { saveToCacheIDB, loadFromCacheIDB, type AutomergeDoc } from './indexeddb-cache';
import type { AutomergeProject, BranchHead } from './types';

function branchPath(userId: string, projectId: string, branchId: string): string {
  return `users/${userId}/projects/${projectId}/branches/${branchId}`;
}

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
 * ProjectSyncManager handles offline/online sync between Automerge, IndexedDB, and Realtime Database
 */
/** Debounce delay before syncing to RTDB (reduces write/read volume). */
const SYNC_DEBOUNCE_MS = 3000;

/** Minimum ms between RTDB writes (throttle). */
const MIN_WRITE_INTERVAL_MS = 2000;

/** Ignore snapshot events that are from our own write within this window (ms). */
const OWN_WRITE_WINDOW_MS = 2000;

export class ProjectSyncManager {
  private automergeDoc: any = null;
  private automerge: any = null;
  private unsubscribe?: () => void;
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private lastRemoteTimestamp: number = 0;
  /** Timestamp when we last wrote to RTDB (used to skip re-processing our own snapshot). */
  private lastSyncToRTDBTimestamp: number = 0;

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
    this.debouncedSyncToRTDB = debounce(this.syncToRTDB.bind(this), SYNC_DEBOUNCE_MS);
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

      // 2. Sync with Realtime Database if online (non-blocking: don't block init on RTDB read)
      if (this.isOnline) {
        this.syncWithRTDB().catch((err) =>
          console.error(`[SYNC] Background RTDB fetch failed (${this.projectId}/${this.branchId}):`, err)
        );
      }

      // 3. If still no document, create an empty one
      if (!this.automergeDoc) {
        this.automergeDoc = Automerge.from({});
      }

      // 4. Setup real-time RTDB listener
      this.setupRTDBListener();

      // 5. Setup network handlers
      this.setupNetworkHandlers();
    } catch (error) {
      console.error(`Failed to initialize sync manager (${this.projectId}/${this.branchId}):`, error);
      throw error;
    }
  }

  /**
   * Fetch latest state from Realtime Database and merge with local
   */
  private async syncWithRTDB(): Promise<void> {
    try {
      const branchRef = ref(dbRealtime, branchPath(this.userId, this.projectId, this.branchId));
      const snapshot = await get(branchRef);
      const data = snapshot.val() as BranchHead | null;

      if (data?.automergeState) {
        const binary = toBytes(data.automergeState);
        const AM = this.automerge!;
        const load = (A: typeof AM, d: Uint8Array) =>
          (A as { load<T>(x: Uint8Array): T }).load<AutomergeProject>(d);
        const remoteDoc = load(AM, binary);
        const ts = typeof data.timestamp === 'number' ? data.timestamp : 0;
        this.lastRemoteTimestamp = ts;

        if (this.automergeDoc) {
          this.automergeDoc = this.automerge.merge(this.automergeDoc, remoteDoc);
        } else {
          this.automergeDoc = remoteDoc;
        }

        await saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
        this.onUpdate(this.automergeDoc);
      }
    } catch (error) {
      console.error(`Failed to sync with RTDB (${this.projectId}/${this.branchId}):`, error);
    }
  }

  /**
   * Setup real-time Realtime Database listener for collaborative editing
   */
  private setupRTDBListener(): void {
    const branchRef = ref(dbRealtime, branchPath(this.userId, this.projectId, this.branchId));

    this.unsubscribe = onValue(branchRef, (snapshot) => {
      const data = snapshot.val() as BranchHead | null;
      if (!data?.automergeState) return;

      const ts = typeof data.timestamp === 'number' ? data.timestamp : 0;
      const now = Date.now();
      if (now - this.lastSyncToRTDBTimestamp < OWN_WRITE_WINDOW_MS && Math.abs(ts - this.lastSyncToRTDBTimestamp) < OWN_WRITE_WINDOW_MS) {
        return;
      }
      if (ts <= this.lastRemoteTimestamp) return;

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

        this.lastRemoteTimestamp = ts;
        this.onUpdate(this.automergeDoc);
        saveToCacheIDB(this.projectId, this.branchId, this.automergeDoc);
      } catch (error) {
        console.error('Failed to merge remote changes:', error);
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

      this.debouncedSyncToRTDB();
    } catch (error) {
      console.error('Failed to apply change:', error);
      throw error;
    }
  }

  /**
   * Debounced RTDB sync (defined in constructor)
   */
  private debouncedSyncToRTDB: () => void;

  /**
   * Save current state to Realtime Database
   */
  private async syncToRTDB(): Promise<void> {
    if (!this.isOnline || !this.automergeDoc) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastSyncToRTDBTimestamp;
    if (this.lastSyncToRTDBTimestamp > 0 && elapsed < MIN_WRITE_INTERVAL_MS) {
      this.debouncedSyncToRTDB();
      return;
    }

    try {
      const branchRef = ref(dbRealtime, branchPath(this.userId, this.projectId, this.branchId));

      const Automerge = await this.ensureAutomerge();
      const binary = Automerge.save(this.automergeDoc) as Uint8Array;
      const base64 = uint8ArrayToBase64(binary);
      const timestamp = Date.now();
      this.lastSyncToRTDBTimestamp = timestamp;
      await set(branchRef, {
        commitId: crypto.randomUUID(),
        automergeState: base64,
        timestamp,
        author: this.userId,
      });

      console.log('[FIREBASE-SYNC] Successfully synced to RTDB');
      this.onFirebaseSync?.();
    } catch (error) {
      console.error('[FIREBASE-SYNC] Failed to sync to RTDB:', error);
    }
  }

  /**
   * Setup network online/offline handlers
   */
  private setupNetworkHandlers(): void {
    const handleOnline = async () => {
      this.isOnline = true;
      await this.syncWithRTDB();
      this.debouncedSyncToRTDB();
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
   * Force an immediate RTDB sync (useful for critical saves)
   */
  async forceSyncToFirestore(): Promise<void> {
    await this.syncToRTDB();
  }

  /**
   * Fetch latest project state from RTDB and update local state (source of truth refresh)
   */
  async refreshFromFirestore(): Promise<void> {
    await this.syncWithRTDB();
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
      this.debouncedSyncToRTDB();

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
      this.debouncedSyncToRTDB();

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
