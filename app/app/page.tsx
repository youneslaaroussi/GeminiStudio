"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Trash2, FolderOpen, FileJson, LogOut, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProjectsListStore, ProjectMetadata } from "@/app/lib/store/projects-list-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { cn } from "@/lib/utils";

export default function ProjectsPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const projects = useProjectsListStore((s) => s.projects);
  const addProject = useProjectsListStore((s) => s.addProject);
  const removeProject = useProjectsListStore((s) => s.removeProject);
  const importProject = useProjectsListStore((s) => s.importProject);
  const loadProjects = useProjectsListStore((s) => s.loadProjects);
  const setUserId = useProjectsListStore((s) => s.setUserId);
  const [isClient, setIsClient] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    setIsClient(true);
    if (user) {
      setUserId(user.uid);
      loadProjects(user.uid);
    }
  }, [user, loadProjects, setUserId]);

  const handleNewProject = async () => {
    if (!user) return;
    const id = crypto.randomUUID();
    const metadata: ProjectMetadata = {
      id,
      name: "New Project",
      lastModified: Date.now(),
    };
    await addProject(metadata, user.uid);
    router.push(`/editor/${id}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const id = await importProject(file, user.uid);
      router.push(`/editor/${id}`);
    } catch (err) {
      console.error("Import failed", err);
      alert("Failed to import project");
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setProjectToDelete(id);
  };

  const confirmDelete = async () => {
    if (projectToDelete) {
      await removeProject(projectToDelete);
      setProjectToDelete(null);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/auth/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (!isClient || loading) return <div className="flex h-screen items-center justify-center bg-[#141417] text-white">Loading...</div>;

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0f0f12] text-foreground px-8 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-4">
            <img src="/gemini-logo.png" alt="Gemini" className="size-10" />
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">Gemini Studio</h1>
              <p className="text-sm text-slate-400">Logged in as {user?.email}</p>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-100 rounded cursor-pointer text-xs font-medium border border-slate-700 hover:bg-slate-700 transition-colors">
              <Upload className="size-4" />
              Import
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
            <button
              onClick={handleNewProject}
              className="px-4 py-2 bg-white text-black rounded font-medium text-xs hover:bg-slate-100 transition-colors"
            >
              <Plus className="size-4 inline mr-2" />
              New Project
            </button>
            <button
              onClick={() => router.push("/settings")}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-100 rounded text-xs font-medium border border-slate-700 hover:bg-slate-700 transition-colors"
            >
              <Settings className="size-4" />
              Settings
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-100 rounded text-xs font-medium border border-slate-700 hover:bg-red-900 hover:border-red-700 hover:text-red-200 transition-colors"
            >
              <LogOut className="size-4" />
              Logout
            </button>
          </div>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => router.push(`/editor/${project.id}`)}
              className="group text-left cursor-pointer"
            >
              <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                {/* Thumbnail area */}
                <div className="relative flex items-center justify-center bg-slate-950 aspect-video overflow-hidden">
                  {project.thumbnail ? (
                    <img
                      src={project.thumbnail}
                      alt={project.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center">
                      <FolderOpen className="size-10 text-slate-600" />
                    </div>
                  )}
                </div>

                {/* Info section */}
                <div className="px-4 py-3 border-t border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate text-sm">{project.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(project.lastModified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteClick(e, project.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      title="Delete Project"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full py-12 text-center border border-dashed border-slate-700 rounded-lg bg-slate-950/30">
              <FileJson className="size-8 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm mb-4">No projects yet</p>
              <button
                onClick={handleNewProject}
                className="px-4 py-2 bg-white text-black rounded font-medium text-xs hover:bg-slate-100 transition-colors inline-flex items-center gap-2"
              >
                <Plus className="size-4" />
                Create New Project
              </button>
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        <Dialog open={projectToDelete !== null} onOpenChange={(open) => !open && setProjectToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Project</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this project? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setProjectToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
