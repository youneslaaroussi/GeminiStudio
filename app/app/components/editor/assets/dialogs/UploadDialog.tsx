"use client";

import { useState, useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Trash2, File as FileIcon, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { RemoteAsset } from "@/app/types/assets";
import { createId, formatBytes } from "../utils";

interface QueuedFile {
  id: string;
  file: File;
}

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFiles?: File[];
  projectId: string | null;
  onUploadComplete: (assets: RemoteAsset[]) => void;
}

export function UploadDialog({
  open,
  onOpenChange,
  initialFiles,
  projectId,
  onUploadComplete,
}: UploadDialogProps) {
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>(() =>
    (initialFiles ?? []).map((file) => ({ id: createId(), file }))
  );
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setQueuedFiles((prev) => {
      const existing = new Set(
        prev.map((item) => `${item.file.name}-${item.file.size}`)
      );
      const additions = acceptedFiles
        .filter((file) => !existing.has(`${file.name}-${file.size}`))
        .map((file) => ({ id: createId(), file }));
      return [...prev, ...additions];
    });
    setError(null);
  }, []);

  const dropzone = useDropzone({
    onDrop: handleDrop,
    multiple: true,
  });

  const handleRemove = useCallback((id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const totalSize = useMemo(
    () => queuedFiles.reduce((sum, item) => sum + item.file.size, 0),
    [queuedFiles]
  );

  const handleUpload = useCallback(async () => {
    if (!queuedFiles.length || isUploading || !projectId) return;
    setIsUploading(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("projectId", projectId);
    queuedFiles.forEach((item) => formData.append("files", item.file));

    try {
      const result = await new Promise<{ assets: RemoteAsset[] }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/assets");
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("Invalid response"));
              }
            } else {
              reject(new Error("Upload failed"));
            }
          };
          xhr.send(formData);
        }
      );

      onUploadComplete(result.assets);
      setQueuedFiles([]);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  }, [queuedFiles, isUploading, projectId, onUploadComplete, onOpenChange]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isUploading) {
        setQueuedFiles([]);
        setError(null);
      }
      onOpenChange(nextOpen);
    },
    [isUploading, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Assets</DialogTitle>
        </DialogHeader>

        <div
          {...dropzone.getRootProps()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        >
          <input {...dropzone.getInputProps()} />
          <Upload className="size-6 text-primary" />
          <p className="text-sm font-medium">
            {dropzone.isDragActive ? "Drop files here" : "Drop files to upload"}
          </p>
          <p className="text-xs text-muted-foreground">or click to browse</p>
        </div>

        {queuedFiles.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {queuedFiles.length} file{queuedFiles.length !== 1 && "s"}
              </span>
              <span className="text-muted-foreground">
                {formatBytes(totalSize)}
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {queuedFiles.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 text-sm"
                >
                  <FileIcon className="size-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{item.file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatBytes(item.file.size)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => handleRemove(item.id)}
                    disabled={isUploading}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isUploading && (
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Uploading... {progress}%
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={queuedFiles.length === 0 || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="size-4 mr-2" />
                Upload {queuedFiles.length > 0 && `(${queuedFiles.length})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
