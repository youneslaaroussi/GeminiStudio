"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Upload, Check, Loader2, Film } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";
import type { Project } from "@/app/types/timeline";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { cn } from "@/lib/utils";
import { HistoryControls } from "./HistoryControls";
import { RenderDialog } from "./RenderDialog";
import { useRender } from "@/app/hooks/useRender";
import { captureThumbnail } from "@/app/lib/utils/thumbnail";

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

export function TopBar({ previewCanvas }: TopBarProps) {
  const router = useRouter();
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const projectId = useProjectStore((s) => s.projectId);
  const updateListProject = useProjectsListStore((s) => s.updateProject);
  const [isBusy, setIsBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);

  const { isRendering, jobStatus } = useRender();

  const handleHome = useCallback(() => {
    router.push('/');
  }, [router]);

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

      // Update projects list with thumbnail
      if (thumbnail && projectId) {
        updateListProject(projectId, {
          name: project.name,
          thumbnail,
        });
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
            onValueCommit={(val) =>
              updateProjectSettings({ name: val || "Untitled Project" })
            }
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
