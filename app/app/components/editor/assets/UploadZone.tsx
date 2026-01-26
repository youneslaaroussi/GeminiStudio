"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  compact?: boolean;
}

export function UploadZone({ onFilesSelected, compact }: UploadZoneProps) {
  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
    },
    [onFilesSelected]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    multiple: true,
  });

  if (compact) {
    return (
      <div
        {...getRootProps()}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed border-border p-3 cursor-pointer transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "hover:border-primary/50 hover:bg-muted/30"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="size-4 text-primary" />
        <span className="text-sm text-muted-foreground">
          {isDragActive ? "Drop files here" : "Drop files or click to upload"}
        </span>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer transition-colors text-center",
        isDragActive
          ? "border-primary bg-primary/5"
          : "hover:border-primary/50 hover:bg-muted/30"
      )}
    >
      <input {...getInputProps()} />
      <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Upload className="size-5 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">
          {isDragActive ? "Drop files here" : "Drop files to upload"}
        </p>
        <p className="text-xs text-muted-foreground">
          or click to browse
        </p>
      </div>
    </div>
  );
}
