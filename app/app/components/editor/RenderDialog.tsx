"use client";

import { useState, useCallback, useEffect } from "react";
import { Film, Download, Loader2, AlertCircle, CheckCircle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Project } from "@/app/types/timeline";
import { useRender, type RenderFormat, type RenderQuality } from "@/app/hooks/useRender";
import { useProjectStore } from "@/app/lib/store/project-store";

interface RenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  projectId: string;
}

const FORMAT_OPTIONS: { value: RenderFormat; label: string }[] = [
  { value: "mp4", label: "MP4 (H.264)" },
  { value: "webm", label: "WebM (VP9)" },
  { value: "gif", label: "GIF (Animated)" },
];

const QUALITY_OPTIONS: { value: RenderQuality; label: string; description: string }[] = [
  { value: "low", label: "Low", description: "Fastest, smaller file" },
  { value: "web", label: "Web", description: "Balanced quality" },
  { value: "social", label: "Social", description: "Good for social media" },
  { value: "studio", label: "Studio", description: "Highest quality" },
];

export function RenderDialog({
  open,
  onOpenChange,
  project,
  projectId,
}: RenderDialogProps) {
  const [format, setFormat] = useState<RenderFormat>("mp4");
  const [quality, setQuality] = useState<RenderQuality>("web");

  const {
    isRendering,
    jobStatus,
    error,
    startRender,
    reset,
    activeJobs,
    resumeJob,
    clearJob,
  } = useRender();

  const saveProject = useProjectStore((state) => state.saveProject);

  // Reset form when dialog closes (but keep job status)
  useEffect(() => {
    if (!open && !isRendering) {
      const timeout = setTimeout(() => {
        setFormat("mp4");
        setQuality("web");
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open, isRendering]);

  const handleStartRender = useCallback(async () => {
    // Autosave project before rendering
    saveProject();
    await startRender(project, projectId, { format, quality });
  }, [startRender, project, projectId, format, quality, saveProject]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleNewRender = useCallback(() => {
    reset();
  }, [reset]);

  const isCompleted = jobStatus?.state === "completed";
  const isFailed = jobStatus?.state === "failed";
  const progress = jobStatus?.progress ?? 0;
  const showForm = !isRendering && !isCompleted && !isFailed && !jobStatus;

  // Filter active jobs for current project
  const projectJobs = activeJobs.filter((j) => j.projectId === projectId);
  const hasInProgressJobs = projectJobs.some(
    (j) => j.status.state !== "completed" && j.status.state !== "failed"
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-5" />
            Render Video
          </DialogTitle>
        </DialogHeader>

        {/* Previous render jobs for this project */}
        {showForm && projectJobs.length > 0 && (
          <div className="space-y-2 border-b border-border pb-4 mb-4">
            <p className="text-sm font-medium">Previous Renders</p>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {projectJobs.map((job) => (
                <div
                  key={job.jobId}
                  className="flex items-center justify-between rounded-md bg-muted/50 p-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {job.status.state === "completed" ? (
                        <CheckCircle className="size-4 text-green-500 shrink-0" />
                      ) : job.status.state === "failed" ? (
                        <AlertCircle className="size-4 text-destructive shrink-0" />
                      ) : (
                        <Loader2 className="size-4 animate-spin shrink-0" />
                      )}
                      <span className="truncate">
                        {job.status.state === "completed"
                          ? "Ready"
                          : job.status.state === "failed"
                          ? "Failed"
                          : `${job.status.progress}%`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resumeJob(job)}
                    >
                      {job.status.state === "completed" ? "Download" : "View"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => clearJob(job.jobId)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showForm && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="format" className="text-sm font-medium">Format</label>
              <select
                id="format"
                value={format}
                onChange={(e) => setFormat(e.target.value as RenderFormat)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="quality" className="text-sm font-medium">Quality</label>
              <select
                id="quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as RenderQuality)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {QUALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} - {opt.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <p className="font-medium">Output Settings</p>
              <p className="text-muted-foreground">
                {project.resolution.width} x {project.resolution.height} @ {project.fps} fps
              </p>
            </div>
          </div>
        )}

        {isRendering && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">
                Rendering... {progress}%
              </p>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              You can close this dialog. The render will continue in the background.
            </p>
          </div>
        )}

        {isCompleted && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="size-12 text-green-500" />
              <p className="text-lg font-medium">Render Complete!</p>
              <p className="text-sm text-muted-foreground">
                Your video is ready to download.
              </p>
            </div>
            {jobStatus?.downloadUrl ? (
              <Button asChild className="w-full">
                <a href={jobStatus.downloadUrl} download>
                  <Download className="size-4 mr-2" />
                  Download Video
                </a>
              </Button>
            ) : (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="size-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Generating download link...</span>
              </div>
            )}
          </div>
        )}

        {(isFailed || error) && !isCompleted && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="size-12 text-destructive" />
              <p className="text-lg font-medium">Render Failed</p>
              <p className="text-sm text-muted-foreground text-center">
                {error || jobStatus?.failedReason || "An unknown error occurred"}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={handleNewRender}>
              Try Again
            </Button>
          </div>
        )}

        <DialogFooter>
          {showForm && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleStartRender} disabled={hasInProgressJobs}>
                <Film className="size-4 mr-2" />
                Start Render
              </Button>
            </>
          )}
          {(isRendering || isCompleted) && (
            <>
              {isCompleted && (
                <Button variant="outline" onClick={handleNewRender}>
                  New Render
                </Button>
              )}
              <Button variant="outline" onClick={() => handleClose(false)}>
                {isRendering ? "Continue in Background" : "Close"}
              </Button>
            </>
          )}
          {isFailed && !isCompleted && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
