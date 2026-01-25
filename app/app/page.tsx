"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Trash2, FolderOpen, FileJson } from "lucide-react";
import { useProjectsListStore, ProjectMetadata } from "@/app/lib/store/projects-list-store";
import { cn } from "@/lib/utils";

export default function ProjectsPage() {
  const router = useRouter();
  const projects = useProjectsListStore((s) => s.projects);
  const addProject = useProjectsListStore((s) => s.addProject);
  const removeProject = useProjectsListStore((s) => s.removeProject);
  const importProject = useProjectsListStore((s) => s.importProject);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleNewProject = () => {
    const id = crypto.randomUUID();
    const metadata: ProjectMetadata = {
      id,
      name: "New Project",
      lastModified: Date.now(),
    };
    addProject(metadata);
    router.push(`/editor/${id}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const id = await importProject(file);
      router.push(`/editor/${id}`);
    } catch (err) {
      console.error("Import failed", err);
      alert("Failed to import project");
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      removeProject(id);
    }
  };

  if (!isClient) return <div className="flex h-screen items-center justify-center bg-[#141417] text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#141417] text-foreground p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Gemini Studio</h1>
            <p className="text-muted-foreground">Manage your video projects</p>
          </div>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md cursor-pointer transition-colors text-sm font-medium">
              <Upload className="size-4" />
              Import
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
            <button
              onClick={handleNewProject}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors text-sm font-medium shadow-sm"
            >
              <Plus className="size-4" />
              New Project
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => router.push(`/editor/${project.id}`)}
              className="group relative aspect-video bg-card hover:bg-accent/50 border border-border rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex-1 flex items-center justify-center">
                <FolderOpen className="size-12 text-muted-foreground/20 group-hover:text-primary/50 transition-colors" />
              </div>
              
              <div className="mt-4">
                <h3 className="font-medium text-white truncate pr-8">{project.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Last edited {new Date(project.lastModified).toLocaleDateString()}
                </p>
              </div>

              <button
                onClick={(e) => handleDelete(e, project.id)}
                className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                title="Delete Project"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full py-12 text-center border border-dashed border-border/50 rounded-xl">
              <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
