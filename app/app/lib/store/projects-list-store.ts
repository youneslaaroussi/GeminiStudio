import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProjectMetadata {
  id: string;
  name: string;
  lastModified: number;
  thumbnail?: string; // Optional data URI or url
}

interface ProjectsListStore {
  projects: ProjectMetadata[];
  addProject: (project: ProjectMetadata) => void;
  updateProject: (id: string, updates: Partial<ProjectMetadata>) => void;
  removeProject: (id: string) => void;
  importProject: (file: File) => Promise<string>; // Returns new project ID
}

export const useProjectsListStore = create<ProjectsListStore>()(
  persist(
    (set, get) => ({
      projects: [],
      
      addProject: (project) =>
        set((state) => ({
          projects: [project, ...state.projects].sort((a, b) => b.lastModified - a.lastModified),
        })),

      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, lastModified: Date.now() } : p
          ).sort((a, b) => b.lastModified - a.lastModified),
        })),

      removeProject: (id) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
        }));
        // Clean up project data
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`gemini-project-${id}`);
        }
      },

      importProject: async (file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
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
              
              // Add to list
              get().addProject(metadata);
              resolve(id);
            } catch (err) {
              reject(err);
            }
          };
          reader.readAsText(file);
        });
      },
    }),
    {
      name: 'gemini-projects-list',
    }
  )
);
