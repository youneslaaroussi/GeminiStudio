"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Upload, Check, Loader2, Film, LogOut, Plus, RefreshCw, Settings, CreditCard, Keyboard, Command } from "lucide-react";
import { FiEdit2 } from "react-icons/fi";
import { LayoutSelector, type EditorLayoutPreset } from "./LayoutSelector";
import { BranchSelector } from "./BranchSelector";
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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ShortcutsModal } from "./ShortcutsModal";

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
  renderDialogOpen?: boolean;
  onRenderDialogOpenChange?: (open: boolean) => void;
  shortcutsModalOpen?: boolean;
  onShortcutsModalOpenChange?: (open: boolean) => void;
  onLoadReady?: (handler: () => void) => void;
  onExportReady?: (handler: () => void) => void;
  onRefreshReady?: (handler: () => void) => void;
  onOpenCommandMenu?: () => void;
  currentLayout?: EditorLayoutPreset;
  onLayoutChange?: (layout: EditorLayoutPreset) => void;
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

export function TopBar({ previewCanvas, renderDialogOpen: renderDialogOpenProp, onRenderDialogOpenChange, shortcutsModalOpen: shortcutsModalOpenProp, onShortcutsModalOpenChange, onLoadReady, onExportReady, onRefreshReady, onOpenCommandMenu, currentLayout = "agentic", onLayoutChange }: TopBarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { credits, refresh, loading: creditsLoading } = useCredits(user?.uid);
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const projectId = useProjectStore((s) => s.projectId);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const refreshProjectFromFirebase = useProjectStore((s) => s.refreshProjectFromFirebase);
  const updateListProject = useProjectsListStore((s) => s.updateProject);
  const [isBusy, setIsBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const [renderDialogOpenLocal, setRenderDialogOpenLocal] = useState(false);
  const [shortcutsModalOpenLocal, setShortcutsModalOpenLocal] = useState(false);

  const shortcutsModalOpen = shortcutsModalOpenProp ?? shortcutsModalOpenLocal;
  const setShortcutsModalOpen = onShortcutsModalOpenChange ?? setShortcutsModalOpenLocal;

  const renderDialogOpen = renderDialogOpenProp ?? renderDialogOpenLocal;
  const setRenderDialogOpen = onRenderDialogOpenChange ?? setRenderDialogOpenLocal;

  const { isRendering, jobStatus } = useRender();

  const handleHome = useCallback(() => {
    router.push('/app');
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
    router.push('/settings/billing');
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
    } finally {
      setIsBusy(false);
    }
  }, [payload, defaultFilename]);

  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return;

    try {
      // Capture thumbnail if canvas is available
      let thumbnail: string | null = null;
      if (previewCanvas) {
        thumbnail = await captureThumbnail(previewCanvas);
      }

      // Save project (this now manages saveStatus internally)
      useProjectStore.getState().saveProject();

      // Update projects list with thumbnail and name
      if (projectId && user?.uid) {
        await updateListProject(projectId, {
          name: project.name,
          ...(thumbnail && { thumbnail }),
        }, user.uid);
      }

      console.log("Project saved locally");
    } catch (error) {
      console.error("Failed to save project:", error);
    }
  }, [saveStatus, previewCanvas, projectId, project.name, updateListProject, user?.uid]);


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
    } finally {
      setIsBusy(false);
    }
  }, [parseAndLoadProject]);

  useEffect(() => {
    onLoadReady?.(handleLoad);
  }, [onLoadReady, handleLoad]);

  useEffect(() => {
    onExportReady?.(handleExport);
  }, [onExportReady, handleExport]);

  const handleRefreshFromFirebase = useCallback(async () => {
    if (!projectId || refreshBusy) return;
    setRefreshBusy(true);
    const minDuration = 600; // minimum animation duration for intentionality
    const startTime = Date.now();
    try {
      await refreshProjectFromFirebase();
    } catch (error) {
      console.error('Failed to refresh project from Firebase', error);
    } finally {
      const elapsed = Date.now() - startTime;
      const remaining = minDuration - elapsed;
      if (remaining > 0) {
        setTimeout(() => setRefreshBusy(false), remaining);
      } else {
        setRefreshBusy(false);
      }
    }
  }, [projectId, refreshBusy, refreshProjectFromFirebase]);

  useEffect(() => {
    onRefreshReady?.(handleRefreshFromFirebase);
  }, [onRefreshReady, handleRefreshFromFirebase]);

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
          {projectId && (
            <>
              <BranchSelector projectId={projectId} />
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleRefreshFromFirebase}
                      disabled={refreshBusy}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      aria-label="Refresh project from Firebase"
                    >
                      <RefreshCw className={cn("size-4", refreshBusy && "animate-spin")} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Refresh from Firebase (⌥⇧R)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        <div className="flex items-baseline gap-2">
          <div className="flex items-center gap-1.5 border-b border-muted-foreground/50 focus-within:border-muted-foreground pb-0.5 -mb-px transition-colors">
            <FiEdit2 className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
            <EditableInput
              value={project.name}
              onValueCommit={(val) => {
                const newName = val || "Untitled Project";
                updateProjectSettings({ name: newName });
                if (projectId && user?.uid) {
                  updateListProject(projectId, { name: newName }, user.uid);
                }
              }}
              className="text-sm font-medium text-foreground bg-transparent border-0 outline-none focus:font-bold rounded px-0 py-0 min-w-[120px] placeholder:text-muted-foreground"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {project.resolution.width}×{project.resolution.height} @ {project.fps}
            fps
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleLoad}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                <Upload className="size-4" />
                Load
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Load project (Ctrl+O / ⌘O)</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleExport}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                <Upload className="size-4 rotate-180" />
                Export
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Export project (Ctrl+E / ⌘E)</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Save project (Ctrl+S / ⌘S)</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Render video (Ctrl+Shift+R / ⌘⇧R)</p>
            </TooltipContent>
          </Tooltip>
          {onOpenCommandMenu && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenCommandMenu}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Command menu"
                >
                  <Command className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Command menu (Ctrl+K / ⌘K)</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShortcutsModalOpen(true)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Keyboard shortcuts (Ctrl+/ / ⌘/)</p>
            </TooltipContent>
          </Tooltip>
          {onLayoutChange && (
            <LayoutSelector currentLayout={currentLayout} onLayoutChange={onLayoutChange} />
          )}
        </TooltipProvider>

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
            <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
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

      <ShortcutsModal
        open={shortcutsModalOpen}
        onOpenChange={setShortcutsModalOpen}
      />
    </>
  );
}
