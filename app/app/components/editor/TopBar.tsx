"use client";

import { useCallback, useMemo, useState } from "react";
import { Save, Upload } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { Project } from "@/app/types/timeline";
import { EditableInput } from "@/app/components/ui/EditableInput";

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

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const [isBusy, setIsBusy] = useState(false);

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

  const handleSave = useCallback(async () => {
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
      console.error("Failed to save project", error);
      alert("Failed to save project. Check console for details.");
    } finally {
      setIsBusy(false);
    }
  }, [payload, defaultFilename]);

  const parseAndLoadProject = useCallback(
    (raw: string) => {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.project) {
        throw new Error("Invalid project file format");
      }
      setProject(parsed.project as Project);
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
    <div className="flex items-center justify-between border-b border-border bg-card/80 px-4 py-2 backdrop-blur">
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
          onClick={handleSave}
          disabled={isBusy}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="size-4" />
          Save
        </button>
      </div>
    </div>
  );
}
