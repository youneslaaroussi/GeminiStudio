"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Upload, Check, Loader2, Film, LogOut, Plus, RefreshCw, Settings, CreditCard } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useCredits } from "@/app/lib/hooks/useCredits";
import type { Project } from "@/app/types/timeline";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { cn } from "@/lib/utils";
import { HistoryControls } from "./HistoryControls";
import { RenderDialog } from "./RenderDialog";
import { useRender } from "@/app/hooks/useRender";
import { captureThumbnail } from "@/app/lib/utils/thumbnail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const supportsFileSystemAccess =
  typeof window !== "undefined" && "showSaveFilePicker" in window;

type FileSystemWindow = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  };

const FILE_TYPES = [
  {
    description: "Gemini Studio Project",
    accept: { "application/json": [".gemini.json", ".json"] },
  },
];

async function downloadFallback(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string) {
  return name.replace(/[<>:"/\\|?*]+/g, "_") || "project";
}

interface TopBarProps {
  previewCanvas?: HTMLCanvasElement | null;
}

function userInitials(user: { displayName?: string | null; email?: string | null }): string {
  if (user.displayName) {
    const parts = user.displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    if (parts[0]!.length) return parts[0]!.slice(0, 2).toUpperCase();
  }
  const e = (user.email ?? "").trim();
  if (e) return e.slice(0, 2).toUpperCase();
  return "?";
}

export function TopBar({ previewCanvas }: TopBarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { credits, refresh, loading: creditsLoading } = useCredits(user?.uid);
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const projectId = useProjectStore((s) => s.projectId);
  const updateListProject = useProjectsListStore((s) => s.updateProject);
  const [isBusy, setIsBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [avatarImgError, setAvatarImgError] = useState(false);

  const { isRendering, jobStatus } = useRender();

  const handleHome = useCallback(() => {
    router.push('/');
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      router.push('/auth/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, [logout, router]);

  const handleAddCredits = useCallback(() => {
    router.push('/settings?billing=fill');
  }, [router]);

  const handleRefreshCredits = useCallback(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setAvatarImgError(false);
  }, [user?.photoURL]);

  const payload = useMemo(
    () =>
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          project,
        },
        null,
        2
      ),
    [project]
  );

  const defaultFilename = `${sanitizeFilename(project.name)}.gemini.json`;

  const handleExport = useCallback(async () => {
    setIsBusy(true);
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (supportsFileSystemAccess) {
        const fsWindow = window as FileSystemWindow;
        if (fsWindow.showSaveFilePicker) {
          const handle = await fsWindow.showSaveFilePicker({
          suggestedName: defaultFilename,
          types: FILE_TYPES,
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        } else {
          await downloadFallback(blob, defaultFilename);
        }
      } else {
        await downloadFallback(blob, defaultFilename);
      }
    } catch (error) {
      console.error("Failed to export project", error);
      alert("Failed to export project. Check console for details.");
    } finally {
      setIsBusy(false);
    }
  }, [payload, defaultFilename]);

  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return;
    setSaveStatus('saving');
    // Add a small artificial delay so the user sees the spinner
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      // Capture thumbnail if canvas is available
      let thumbnail: string | null = null;
      if (previewCanvas) {
        thumbnail = await captureThumbnail(previewCanvas);
      }

      // Save project
      const save = useProjectStore.getState().saveProject;
      save();

      // Update projects list with thumbnail and name
      if (projectId) {
        const userId = useProjectsListStore.getState().userId;
        await updateListProject(projectId, {
          name: project.name,
          ...(thumbnail && { thumbnail }),
        }, userId ?? undefined);
      }

      console.log("Project saved locally");
      setSaveStatus('saved');

      // Reset to idle after 2 seconds
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error("Failed to save project:", error);
      setSaveStatus('idle'); // Or error state if we had one
    }
  }, [saveStatus, previewCanvas, projectId, project.name, updateListProject]);


  const parseAndLoadProject = useCallback(
    (raw: string) => {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.project) {
        throw new Error("Invalid project file format");
      }
      setProject(parsed.project as Project, { markSaved: true });
    },
    [setProject]
  );

  const handleLoad = useCallback(async () => {
    setIsBusy(true);
    try {
      if (supportsFileSystemAccess) {
        const fsWindow = window as FileSystemWindow;
        if (fsWindow.showOpenFilePicker) {
          const [handle] = await fsWindow.showOpenFilePicker({
          multiple: false,
          types: FILE_TYPES,
        });
        const file = await handle.getFile();
        const text = await file.text();
        parseAndLoadProject(text);
        } else {
          throw new Error("File System Access API unavailable");
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".gemini.json,.json,application/json";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
              reject(new Error("No file selected"));
              return;
            }
            try {
              const text = await file.text();
              parseAndLoadProject(text);
              resolve();
            } catch (error) {
              reject(error);
            }
          };
          input.click();
        });
      }
    } catch (error) {
      console.error("Failed to load project", error);
      alert("Failed to load project. Check console for details.");
    } finally {
      setIsBusy(false);
    }
  }, [parseAndLoadProject]);

  return (
    <>
      {/* Background Render Progress Bar */}
      {isRendering && (
        <div className="w-full h-1 bg-slate-800">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${jobStatus?.progress ?? 0}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-b border-border bg-card/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleHome}
            className="rounded-md p-1 hover:bg-accent transition-colors"
            title="Back to projects"
          >
            <img src="/gemini-logo.png" alt="Gemini" className="size-6" />
          </button>
          <HistoryControls />
        <div className="flex items-baseline gap-2">
          <EditableInput
            value={project.name}
            onValueCommit={(val) => {
              const newName = val || "Untitled Project";
              updateProjectSettings({ name: newName });
              // Also update projects list metadata to keep in sync
              if (projectId) {
                const userId = useProjectsListStore.getState().userId;
                updateListProject(projectId, { name: newName }, userId ?? undefined);
              }
            }}
            className="text-sm font-semibold text-foreground bg-transparent border border-transparent focus:border-border rounded px-1 py-0.5 min-w-[120px]"
          />
          <span className="text-xs text-muted-foreground">
            {project.resolution.width}×{project.resolution.height} @ {project.fps}
            fps
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleLoad}
          disabled={isBusy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          <Upload className="size-4" />
          Load
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={isBusy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          <Upload className="size-4 rotate-180" />
          Export
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isBusy || saveStatus === 'saving'}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-primary-foreground transition-all duration-200",
            saveStatus === 'saved'
              ? "bg-green-600 hover:bg-green-700"
              : "bg-primary hover:bg-primary/90",
            (isBusy || saveStatus === 'saving') && "opacity-50 cursor-not-allowed"
          )}
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saveStatus === 'saved' ? (
            <Check className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saveStatus === 'saved' ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setRenderDialogOpen(true)}
          disabled={isBusy}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            isRendering
              ? "bg-blue-600/80 hover:bg-blue-600 text-white cursor-pointer"
              : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          )}
        >
          <Film className="size-4" />
          {isRendering ? `Rendering... ${jobStatus?.progress ?? 0}%` : "Render"}
        </button>

        <div className="inline-flex items-center rounded-md border border-border bg-muted/30 overflow-hidden">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-r border-border">
            <CreditCard className="size-3.5 text-muted-foreground" />
            <span className="font-medium tabular-nums">{credits}</span>
            <span className="text-muted-foreground">R‑Credits</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-none border-r border-border gap-1 px-2 text-xs"
            onClick={handleAddCredits}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            onClick={handleRefreshCredits}
            disabled={creditsLoading}
            title="Refresh credits"
          >
            <RefreshCw className={cn("size-3.5", creditsLoading && "animate-spin")} />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="User menu"
            >
              <Avatar className="size-8 border border-border">
                {user?.photoURL && !avatarImgError ? (
                  <AvatarImage
                    src={user.photoURL}
                    alt={user.displayName ?? ""}
                    onError={() => setAvatarImgError(true)}
                  />
                ) : null}
                <AvatarFallback className="text-xs">{user ? userInitials(user) : "?"}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium truncate">{user?.email ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {credits} R‑Credits
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleAddCredits}>
              <Plus className="size-4" />
              Add credits
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRefreshCredits} disabled={creditsLoading}>
              <RefreshCw className={cn("size-4", creditsLoading && "animate-spin")} />
              Refresh credits
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} variant="destructive">
              <LogOut className="size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      {projectId && (
        <RenderDialog
          open={renderDialogOpen}
          onOpenChange={setRenderDialogOpen}
          project={project}
          projectId={projectId}
        />
      )}
    </>
  );
}
