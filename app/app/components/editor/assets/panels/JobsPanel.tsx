"use client";

import { useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Pause,
  RefreshCw,
  ListTodo,
  Video,
  Image,
  Music,
  Volume2,
  Upload,
  FileText,
  Scan,
  Users,
  Smile,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PipelineStepState } from "@/app/types/pipeline";
import type { RemoteAsset } from "@/app/types/assets";
import type { VeoJob } from "@/app/types/veo";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { cn } from "@/lib/utils";

interface JobsPanelProps {
  assets: RemoteAsset[];
  pipelineStates: Record<string, PipelineStepState[]>;
  veoJobs: VeoJob[];
  videoEffectJobs?: VideoEffectJob[];
  onRefresh: () => void;
  isLoading: boolean;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  metadata: FileText,
  upload: Upload,
  "cloud-upload": Upload,
  "shot-detection": Scan,
  "label-detection": Scan,
  "person-detection": Users,
  transcription: FileText,
  "face-detection": Smile,
  "gemini-analysis": Sparkles,
  video: Video,
  image: Image,
  music: Music,
  tts: Volume2,
};

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; animate?: boolean }> = {
  idle: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
  queued: { icon: Clock, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  running: { icon: Loader2, color: "text-blue-500", bg: "bg-blue-500/10", animate: true },
  waiting: { icon: Pause, color: "text-orange-500", bg: "bg-orange-500/10" },
  succeeded: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
  failed: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
};

interface JobItemProps {
  assetName: string;
  step: PipelineStepState;
}

function JobItem({ assetName, step }: JobItemProps) {
  const config = STATUS_CONFIG[step.status];
  const StepIcon = STEP_ICONS[step.id] ?? ListTodo;
  const StatusIcon = config.icon;

  return (
    <div className={cn("rounded-md border border-border p-2.5 space-y-1.5", config.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StepIcon className="size-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{step.label}</p>
            <p className="text-[11px] text-muted-foreground truncate">{assetName}</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1", config.color)}>
          <StatusIcon className={cn("size-3.5", config.animate && "animate-spin")} />
          <span className="text-[11px] capitalize">{step.status}</span>
        </div>
      </div>
      {step.progress !== undefined && step.status === "running" && (
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${Math.round(step.progress * 100)}%` }}
          />
        </div>
      )}
      {step.error && (
        <p className="text-[11px] text-red-500 truncate">{step.error}</p>
      )}
    </div>
  );
}

const VEO_STATUS_MAP: Record<string, keyof typeof STATUS_CONFIG> = {
  pending: "queued",
  running: "running",
  completed: "succeeded",
  error: "failed",
};

interface VeoJobItemProps {
  job: VeoJob;
}

function VeoJobItem({ job }: VeoJobItemProps) {
  const statusKey = VEO_STATUS_MAP[job.status] ?? "idle";
  const config = STATUS_CONFIG[statusKey];
  const StatusIcon = config.icon;

  const promptPreview = job.params.prompt.length > 40
    ? job.params.prompt.slice(0, 40) + "..."
    : job.params.prompt;

  return (
    <div className={cn("rounded-md border border-border p-2.5 space-y-1.5", config.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Video className="size-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">Veo Video Generation</p>
            <p className="text-[11px] text-muted-foreground truncate">{promptPreview}</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1", config.color)}>
          <StatusIcon className={cn("size-3.5", config.animate && "animate-spin")} />
          <span className="text-[11px] capitalize">{job.status}</span>
        </div>
      </div>
      <div className="flex gap-2 text-[10px] text-muted-foreground">
        <span>{job.params.resolution}</span>
        <span>{job.params.durationSeconds}s</span>
        <span>{job.params.aspectRatio}</span>
      </div>
      {job.error && (
        <p className="text-[11px] text-red-500 truncate">{job.error}</p>
      )}
    </div>
  );
}

const VIDEO_EFFECT_STATUS_MAP: Record<string, keyof typeof STATUS_CONFIG> = {
  pending: "queued",
  running: "running",
  completed: "succeeded",
  error: "failed",
};

interface VideoEffectJobItemProps {
  job: VideoEffectJob;
}

function VideoEffectJobItem({ job }: VideoEffectJobItemProps) {
  const statusKey = VIDEO_EFFECT_STATUS_MAP[job.status] ?? "idle";
  const config = STATUS_CONFIG[statusKey];
  const StatusIcon = config.icon;
  const label = job.effectLabel ?? job.effectId;

  return (
    <div className={cn("rounded-md border border-border p-2.5 space-y-1.5", config.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Wand2 className="size-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{label}</p>
            <p className="text-[11px] text-muted-foreground truncate">{job.assetName}</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1", config.color)}>
          <StatusIcon className={cn("size-3.5", config.animate && "animate-spin")} />
          <span className="text-[11px] capitalize">{job.status}</span>
        </div>
      </div>
      {job.error && (
        <p className="text-[11px] text-red-500 truncate">{job.error}</p>
      )}
    </div>
  );
}

export function JobsPanel({ assets, pipelineStates, veoJobs, videoEffectJobs = [], onRefresh, isLoading }: JobsPanelProps) {
  const {
    runningJobs,
    recentJobs,
    runningVeoJobs,
    recentVeoJobs,
    runningVideoEffectJobs,
    recentVideoEffectJobs,
  } = useMemo(() => {
    const running: Array<{ assetName: string; step: PipelineStepState }> = [];
    const recent: Array<{ assetName: string; step: PipelineStepState }> = [];

    Object.entries(pipelineStates).forEach(([assetId, steps]) => {
      const asset = assets.find((a) => a.id === assetId);
      const assetName = asset?.name || "Unknown Asset";

      steps.forEach((step) => {
        const item = { assetName, step };
        if (step.status === "running" || step.status === "queued" || step.status === "waiting") {
          running.push(item);
        } else if (step.status === "succeeded" || step.status === "failed") {
          recent.push(item);
        }
      });
    });

    // Sort running by status priority
    running.sort((a, b) => {
      const priority = { running: 0, waiting: 1, queued: 2 };
      return (priority[a.step.status as keyof typeof priority] ?? 3) -
        (priority[b.step.status as keyof typeof priority] ?? 3);
    });

    // Sort recent by updatedAt descending
    recent.sort((a, b) =>
      new Date(b.step.updatedAt).getTime() - new Date(a.step.updatedAt).getTime()
    );

    // Split Veo jobs into running and recent
    const runningVeo = veoJobs.filter((j) => j.status === "pending" || j.status === "running");
    const recentVeo = veoJobs
      .filter((j) => j.status === "completed" || j.status === "error")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    // Split video effect jobs into running and recent
    const runningVideoEffect = videoEffectJobs.filter(
      (j) => j.status === "pending" || j.status === "running"
    );
    const recentVideoEffect = videoEffectJobs
      .filter((j) => j.status === "completed" || j.status === "error")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    return {
      runningJobs: running,
      recentJobs: recent.slice(0, 10),
      runningVeoJobs: runningVeo,
      recentVeoJobs: recentVeo,
      runningVideoEffectJobs: runningVideoEffect,
      recentVideoEffectJobs: recentVideoEffect,
    };
  }, [assets, pipelineStates, veoJobs, videoEffectJobs]);

  const hasAnyJobs =
    runningJobs.length > 0 ||
    recentJobs.length > 0 ||
    runningVeoJobs.length > 0 ||
    recentVeoJobs.length > 0 ||
    runningVideoEffectJobs.length > 0 ||
    recentVideoEffectJobs.length > 0;
  const activeCount =
    runningJobs.length + runningVeoJobs.length + runningVideoEffectJobs.length;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ListTodo className="size-4" />
            Jobs
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
          </Button>
        </div>

        {!hasAnyJobs ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="size-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <ListTodo className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No active jobs</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Jobs will appear here when you generate<br />content or process assets.
            </p>
          </div>
        ) : (
          <>
            {/* Running Jobs */}
            {(runningJobs.length > 0 || runningVeoJobs.length > 0 || runningVideoEffectJobs.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Play className="size-3 text-blue-500" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Active ({activeCount})
                  </span>
                </div>
                <div className="space-y-1.5">
                  {runningVeoJobs.map((job) => (
                    <VeoJobItem key={job.id} job={job} />
                  ))}
                  {runningVideoEffectJobs.map((job) => (
                    <VideoEffectJobItem key={job.id} job={job} />
                  ))}
                  {runningJobs.map((job, i) => (
                    <JobItem
                      key={`${job.step.id}-${i}`}
                      assetName={job.assetName}
                      step={job.step}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Jobs */}
            {(recentJobs.length > 0 ||
              recentVeoJobs.length > 0 ||
              recentVideoEffectJobs.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Recent
                  </span>
                </div>
                <div className="space-y-1.5">
                  {recentVeoJobs.map((job) => (
                    <VeoJobItem key={job.id} job={job} />
                  ))}
                  {recentVideoEffectJobs.map((job) => (
                    <VideoEffectJobItem key={job.id} job={job} />
                  ))}
                  {recentJobs.map((job, i) => (
                    <JobItem
                      key={`${job.step.id}-${i}`}
                      assetName={job.assetName}
                      step={job.step}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
