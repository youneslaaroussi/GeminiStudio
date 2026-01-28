import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/app/lib/server/firebase';

export interface ProjectMetadata {
  id: string;
  name: string;
  lastModified: number;
  thumbnail?: string; // Optional data URI or url
}

interface ProjectsListStore {
  projects: ProjectMetadata[];
  userId: string | null;
  setUserId: (userId: string | null) => void;
  addProject: (project: ProjectMetadata, userId?: string) => Promise<void>;
  updateProject: (id: string, updates: Partial<ProjectMetadata>, userId?: string) => Promise<void>;
  removeProject: (id: string) => void;
  importProject: (file: File, userId?: string) => Promise<string>; // Returns new project ID
  loadProjects: (userId: string) => Promise<void>; // Load from Firestore
}

export const useProjectsListStore = create<ProjectsListStore>()(
  persist(
    (set, get) => ({
      projects: [],
      userId: null,

      setUserId: (userId) =>
        set({ userId }),

      addProject: async (project, userIdParam) => {
        set((state) => ({
          projects: [project, ...state.projects].sort((a, b) => b.lastModified - a.lastModified),
        }));

        // Use passed userId or fall back to store state
        const currentUserId = userIdParam ?? get().userId;
        console.log('[PROJECTS] addProject called, userId:', currentUserId, 'project:', project.id);

        if (!currentUserId) {
          console.error('[PROJECTS] Cannot save to Firestore: userId is null');
          return;
        }

        try {
          const projectRef = doc(db, `users/${currentUserId}/projects/${project.id}`);
          await setDoc(projectRef, {
            name: project.name,
            currentBranch: 'main',
            lastModified: project.lastModified,
            owner: currentUserId,
            collaborators: [],
            isPublic: false,
            ...(project.thumbnail !== undefined && { thumbnail: project.thumbnail }),
          });
          console.log('[PROJECTS] Saved new project to Firestore:', project.id);
        } catch (error) {
          console.error('[PROJECTS] Failed to save project to Firestore:', error);
        }
      },

      updateProject: async (id, updates, userIdParam) => {
        const lastModified = Date.now();

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, lastModified } : p
          ).sort((a, b) => b.lastModified - a.lastModified),
        }));

        // Sync to Firestore
        const currentUserId = userIdParam ?? get().userId;
        if (!currentUserId) {
          console.error('[PROJECTS] Cannot update Firestore: userId is null');
          return;
        }

        try {
          const projectRef = doc(db, `users/${currentUserId}/projects/${id}`);
          // Build update object, excluding undefined values
          const firestoreUpdates: Record<string, unknown> = { lastModified };
          if (updates.name !== undefined) firestoreUpdates.name = updates.name;
          if (updates.thumbnail !== undefined) firestoreUpdates.thumbnail = updates.thumbnail;

          await updateDoc(projectRef, firestoreUpdates);
          console.log('[PROJECTS] Updated project in Firestore:', id);
        } catch (error) {
          console.error('[PROJECTS] Failed to update project in Firestore:', error);
        }
      },

      removeProject: async (id) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
        }));

        // Clean up from localStorage and Firestore
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`gemini-project-${id}`);
        }

        const currentUserId = get().userId;
        if (currentUserId) {
          try {
            const projectRef = doc(db, `users/${currentUserId}/projects/${id}`);
            await deleteDoc(projectRef);
            console.log('[PROJECTS] Deleted project from Firestore:', id);
          } catch (error) {
            console.error('[PROJECTS] Failed to delete project from Firestore:', error);
          }
        }
      },

      importProject: async (file, userIdParam) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const content = e.target?.result as string;
              const data = JSON.parse(content);

              // Basic validation
              if (!data.resolution || !data.layers) {
                throw new Error("Invalid project file");
              }

              const id = crypto.randomUUID();
              const metadata: ProjectMetadata = {
                id,
                name: data.name || file.name.replace('.gemini.json', ''),
                lastModified: Date.now(),
              };

              // Save actual project data
              localStorage.setItem(`gemini-project-${id}`, JSON.stringify(data));

              // Add to list with userId
              await get().addProject(metadata, userIdParam);
              resolve(id);
            } catch (err) {
              reject(err);
            }
          };
          reader.readAsText(file);
        });
      },

      loadProjects: async (userId) => {
        try {
          // Get all projects in the user's subcollection - no need for where clause
          // since the path already scopes to this user
          const projectsRef = collection(db, `users/${userId}/projects`);
          const snapshot = await getDocs(projectsRef);

          const projects = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              name: data.name || 'Untitled Project',
              lastModified: data.lastModified || Date.now(),
              thumbnail: data.thumbnail,
            } as ProjectMetadata;
          }).sort((a, b) => b.lastModified - a.lastModified);

          set({ projects });
          console.log('[PROJECTS] Loaded', projects.length, 'projects from Firestore');
        } catch (error) {
          console.error('[PROJECTS] Failed to load projects from Firestore:', error);
        }
      },
    }),
    {
      name: 'gemini-projects-list',
      partialize: (state) => ({ projects: state.projects }), // Don't persist userId
    }
  )
);
