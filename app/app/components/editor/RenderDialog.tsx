"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Film,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle,
  X,
  Scissors,
  Sparkles,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Project } from "@/app/types/timeline";
import { useRender, type RenderFormat, type RenderQuality } from "@/app/hooks/useRender";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";
import { getCreditsForAction } from "@/app/lib/credits-config";

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

const FPS_OPTIONS = [24, 25, 30, 60] as const;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function parseTime(timeStr: string): number | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const mins = parseInt(match[1], 10);
  const secs = parseInt(match[2], 10);
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

function getTimelineDuration(project: Project): number {
  let maxEnd = 0;
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      const speed = clip.speed || 1;
      const end = clip.start + clip.duration / Math.max(speed, 0.0001);
      maxEnd = Math.max(maxEnd, end);
    }
  }
  return maxEnd;
}

function sanitizeDownloadFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ").trim() || "render";
}

export function RenderDialog({
  open,
  onOpenChange,
  project,
  projectId,
}: RenderDialogProps) {
  const [format, setFormat] = useState<RenderFormat>("mp4");
  const [quality, setQuality] = useState<RenderQuality>("web");
  const [fps, setFps] = useState<number>(() =>
    FPS_OPTIONS.includes(project.fps as (typeof FPS_OPTIONS)[number]) ? project.fps : 30
  );
  const [useRange, setUseRange] = useState(false);
  const [rangeStartStr, setRangeStartStr] = useState("00:00");
  const [rangeEndStr, setRangeEndStr] = useState("00:00");

  const timelineDuration = useMemo(() => getTimelineDuration(project), [project]);

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
  const { events: analytics } = useAnalytics();
  const saveProject = useProjectStore((state) => state.saveProject);
  const renderCredits = useMemo(() => getCreditsForAction("render"), []);

  useEffect(() => {
    if (!open && !isRendering) {
      const timeout = setTimeout(() => {
        setFormat("mp4");
        setQuality("web");
        setFps(FPS_OPTIONS.includes(project.fps as (typeof FPS_OPTIONS)[number]) ? project.fps : 30);
        setUseRange(false);
        setRangeStartStr("00:00");
        setRangeEndStr(formatTime(timelineDuration));
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open, isRendering, timelineDuration, project.fps]);

  useEffect(() => {
    if (open) {
      setRangeEndStr(formatTime(timelineDuration));
      setFps(
        FPS_OPTIONS.includes(project.fps as (typeof FPS_OPTIONS)[number]) ? project.fps : 30
      );
    }
  }, [open, timelineDuration, project.fps]);

  const handleStartRender = useCallback(async () => {
    saveProject();
    analytics.renderStarted({ project_id: projectId, format, quality });

    const options: {
      format: RenderFormat;
      quality: RenderQuality;
      fps?: number;
      range?: [number, number];
    } = { format, quality, fps };
    if (useRange) {
      const start = parseTime(rangeStartStr);
      const end = parseTime(rangeEndStr);
      if (start !== null && end !== null && end > start) {
        options.range = [start, end];
      }
    }

    await startRender(project, projectId, options);
  }, [startRender, project, projectId, format, quality, fps, useRange, rangeStartStr, rangeEndStr, saveProject, analytics]);

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

  const projectJobs = activeJobs.filter((j) => j.projectId === projectId);
  const hasInProgressJobs = projectJobs.some(
    (j) => j.status.state !== "completed" && j.status.state !== "failed"
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header */}
        <div className="border-b border-border/80 bg-muted/30 px-6 py-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Film className="size-5" />
              </div>
              <div className="-space-y-1.5">
                <span className="block text-left">Export video</span>
                <span className="text-sm font-normal text-muted-foreground">
                  Choose format and quality, then render
                </span>
              </div>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Previous renders */}
          {showForm && projectJobs.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent exports
              </p>
              <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-1.5">
                {projectJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {job.status.state === "completed" ? (
                        <CheckCircle className="size-4 text-emerald-500 shrink-0" />
                      ) : job.status.state === "failed" ? (
                        <AlertCircle className="size-4 text-destructive shrink-0" />
                      ) : (
                        <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                      )}
                      <span className="truncate text-muted-foreground">
                        {job.status.state === "completed"
                          ? "Ready"
                          : job.status.state === "failed"
                            ? "Failed"
                            : `${job.status.progress}%`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => resumeJob(job)}
                      >
                        {job.status.state === "completed" ? "Download" : "View"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => clearJob(job.jobId)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form */}
          {showForm && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="format">Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as RenderFormat)}>
                    <SelectTrigger id="format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quality">Quality</Label>
                  <Select value={quality} onValueChange={(v) => setQuality(v as RenderQuality)}>
                    <SelectTrigger id="quality" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label} — {opt.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fps">Frame rate</Label>
                <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
                  <SelectTrigger id="fps" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FPS_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} fps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-3">
                  <div className="flex items-center gap-2.5">
                    <Scissors className="size-4 text-muted-foreground" />
                    <div>
                      <Label htmlFor="useRange" className="text-sm font-medium cursor-pointer">
                        Render a time range
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Export only part of the timeline
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="useRange"
                    checked={useRange}
                    onCheckedChange={setUseRange}
                  />
                </div>
                {useRange && (
                  <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-muted/10 px-3 py-2.5">
                    <Clock className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        type="text"
                        value={rangeStartStr}
                        onChange={(e) => setRangeStartStr(e.target.value)}
                        placeholder="00:00"
                        className="w-20 h-8 text-center font-mono text-sm"
                      />
                      <span className="text-muted-foreground text-sm">to</span>
                      <Input
                        type="text"
                        value={rangeEndStr}
                        onChange={(e) => setRangeEndStr(e.target.value)}
                        placeholder="00:00"
                        className="w-20 h-8 text-center font-mono text-sm"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      max {formatTime(timelineDuration)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Output</span>
                <span className="text-sm font-medium tabular-nums">
                  {project.resolution.width} × {project.resolution.height}
                  <span className="text-muted-foreground font-normal"> @ {fps} fps</span>
                </span>
              </div>

              <div className="flex items-center justify-center gap-1.5 py-1">
                <Sparkles className="size-3.5 text-amber-500" />
                <span className="text-xs text-muted-foreground">
                  This export uses{" "}
                  <span className="font-semibold tabular-nums text-foreground">{renderCredits}</span>{" "}
                  R‑Credits
                </span>
              </div>
            </div>
          )}

          {/* In progress */}
          {isRendering && (
            <div className="space-y-6 py-2">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="size-14 rounded-full border-2 border-primary/20 flex items-center justify-center">
                    <Loader2 className="size-7 animate-spin text-primary" />
                  </div>
                </div>
                <div className="text-center space-y-1">
                  <p className="font-medium">Exporting...</p>
                  <p className="text-sm text-muted-foreground">
                    You can close this and keep working. We’ll notify you when it’s ready.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-center text-sm font-medium tabular-nums text-muted-foreground">
                  {progress}%
                </p>
              </div>
            </div>
          )}

          {/* Success */}
          {isCompleted && (
            <div className="space-y-6 py-2">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="size-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle className="size-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-semibold">Export complete</p>
                  <p className="text-sm text-muted-foreground">
                    Your video is ready to download.
                  </p>
                </div>
              </div>
              {jobStatus?.downloadUrl ? (
                <Button asChild className="w-full h-11 text-base" size="lg">
                  <a
                    href={`/api/render/download?${new URLSearchParams({
                      url: jobStatus.downloadUrl,
                      filename: `${sanitizeDownloadFilename(project.name)}.${format}`,
                    }).toString()}`}
                    download={`${sanitizeDownloadFilename(project.name)}.${format}`}
                  >
                    <Download className="size-5 mr-2" />
                    Download video
                  </a>
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Preparing download link...</span>
                </div>
              )}
            </div>
          )}

          {/* Failed */}
          {(isFailed || error) && !isCompleted && (
            <div className="space-y-5 py-2">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="size-14 rounded-full bg-destructive/15 flex items-center justify-center">
                  <AlertCircle className="size-8 text-destructive" />
                </div>
                <div className="space-y-1 min-w-0 w-full">
                  <p className="text-lg font-semibold">Export failed</p>
                  <div className="max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-3 text-left">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                      {error || jobStatus?.failedReason || "An unknown error occurred"}
                    </p>
                  </div>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={handleNewRender}>
                Try again
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-border/80 bg-muted/20 px-6 py-4 flex-row gap-2 sm:gap-2">
          {showForm && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button onClick={handleStartRender} disabled={hasInProgressJobs} className="flex-1 sm:flex-none">
                <Film className="size-4 mr-2" />
                Start export
              </Button>
            </>
          )}
          {(isRendering || isCompleted) && (
            <>
              {isCompleted && (
                <Button variant="outline" onClick={handleNewRender}>
                  New export
                </Button>
              )}
              <Button variant="outline" onClick={() => handleClose(false)}>
                {isRendering ? "Continue in background" : "Close"}
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
