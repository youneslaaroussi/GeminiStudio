"use client";

import { useCallback, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RemoteAsset } from "@/app/types/assets";
import type { PipelineStepState } from "@/app/types/pipeline";
import type { ProjectTranscription } from "@/app/types/transcription";
import { toast } from "sonner";
import { formatBytes, STEP_STATUS_STYLES, STEP_DOT_STYLES } from "../utils";
import { cn } from "@/lib/utils";

interface AssetDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: RemoteAsset | null;
  pipelineSteps: PipelineStepState[];
  transcription?: ProjectTranscription;
}

export function AssetDetailsDialog({
  open,
  onOpenChange,
  asset,
  pipelineSteps,
  transcription,
}: AssetDetailsDialogProps) {
  const copyToClipboard = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  }, []);

  const uploadMetadata = useMemo(() => {
    const metadata = pipelineSteps.find(
      (step) => step.id === "cloud-upload"
    )?.metadata;
    if (!metadata) return undefined;
    return {
      gcsUri: metadata["gcsUri"] as string | undefined,
      signedUrl: metadata["signedUrl"] as string | undefined,
      bucket: metadata["bucket"] as string | undefined,
      objectName: metadata["objectName"] as string | undefined,
    };
  }, [pipelineSteps]);

  if (!asset) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asset Details</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-8 text-center">
            No asset selected.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Asset Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* General Info */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold">General</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <InfoCard label="Name" value={asset.name} />
              <InfoCard label="Type" value={asset.type} capitalize />
              <InfoCard
                label="Uploaded"
                value={new Date(asset.uploadedAt).toLocaleString()}
              />
              <InfoCard label="Size" value={formatBytes(asset.size)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <CopyableCard
                label="Asset ID"
                value={asset.id}
                onCopy={() => copyToClipboard(asset.id, "Asset ID")}
              />
              <CopyableCard
                label="URL"
                value={asset.url}
                onCopy={() => copyToClipboard(asset.url, "URL")}
              />
            </div>
          </section>

          {/* Cloud Storage */}
          {uploadMetadata?.gcsUri && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Cloud Storage</h4>
                {uploadMetadata.signedUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={uploadMetadata.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="size-3.5 mr-1.5" />
                      Open
                    </a>
                  </Button>
                )}
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
                {uploadMetadata.gcsUri && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">GCS URI</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                      {uploadMetadata.gcsUri}
                    </code>
                  </div>
                )}
                {uploadMetadata.bucket && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Bucket</span>
                    <span>{uploadMetadata.bucket}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Pipeline Steps */}
          {pipelineSteps.length > 0 && (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Pipeline</h4>
              <div className="space-y-2">
                {pipelineSteps.map((step) => (
                  <PipelineStepCard key={step.id} step={step} />
                ))}
              </div>
            </section>
          )}

          {/* Transcription */}
          {transcription && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Transcription</h4>
                <span className="text-xs text-muted-foreground capitalize">
                  {transcription.status}
                </span>
              </div>
              {transcription.transcript ? (
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">
                      Full transcript
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() =>
                        copyToClipboard(transcription.transcript!, "Transcript")
                      }
                    >
                      <Copy className="size-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <p className="text-sm max-h-32 overflow-y-auto whitespace-pre-wrap bg-muted/30 rounded p-2">
                    {transcription.transcript}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {transcription.status === "processing"
                    ? "Processing..."
                    : transcription.error || "No transcript available."}
                </p>
              )}
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-medium truncate",
          capitalize && "capitalize"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CopyableCard({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px]"
          onClick={onCopy}
        >
          Copy
        </Button>
      </div>
      <p className="text-xs font-mono truncate">{value}</p>
    </div>
  );
}

function PipelineStepCard({ step }: { step: PipelineStepState }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = step.metadata && Object.keys(step.metadata).length > 0;

  const detailsSummary = useMemo(() => {
    if (!step.metadata) return null;
    switch (step.id) {
      case "metadata":
        return step.metadata.duration
          ? `Duration: ${Number(step.metadata.duration).toFixed(2)}s`
          : null;
      case "cloud-upload":
        return step.metadata.bucket ? `Bucket: ${step.metadata.bucket}` : null;
      case "shot-detection": {
        const shotCount = step.metadata.shotCount as number | undefined;
        const shots = step.metadata.shots as unknown[] | undefined;
        const count = shotCount ?? shots?.length ?? 0;
        return count > 0 ? `${count} shots detected` : null;
      }
      case "face-detection": {
        const faces = step.metadata.faces as unknown[] | undefined;
        return faces?.length ? `${faces.length} face(s) detected` : null;
      }
      case "transcription": {
        const segments = step.metadata.segments as unknown[] | undefined;
        const transcript = step.metadata.transcript as string | undefined;
        if (segments?.length) return `${segments.length} words`;
        if (transcript) return `${transcript.split(" ").length} words`;
        return null;
      }
      default:
        return null;
    }
  }, [step.id, step.metadata]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-3 p-3 w-full text-left hover:bg-muted/30 transition-colors"
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
      >
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span
          className={cn(
            "size-2 rounded-full shrink-0",
            STEP_DOT_STYLES[step.status]
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{step.label}</p>
          {step.error ? (
            <p className="text-xs text-destructive truncate">{step.error}</p>
          ) : detailsSummary ? (
            <p className="text-xs text-muted-foreground">{detailsSummary}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full capitalize",
            STEP_STATUS_STYLES[step.status]
          )}
        >
          {step.status === "running" && (
            <Loader2 className="size-3 animate-spin inline mr-1" />
          )}
          {step.status}
        </span>
      </button>
      {expanded && step.metadata && (
        <div className="border-t border-border bg-muted/20 p-3 overflow-hidden">
          <PipelineStepDetails stepId={step.id} metadata={step.metadata} />
        </div>
      )}
    </div>
  );
}

function PipelineStepDetails({
  stepId,
  metadata,
}: {
  stepId: string;
  metadata: Record<string, unknown>;
}) {
  switch (stepId) {
    case "metadata":
      return (
        <div className="grid gap-2 text-xs">
          {metadata.duration && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span>{Number(metadata.duration).toFixed(2)}s</span>
            </div>
          )}
          {metadata.width && metadata.height && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dimensions</span>
              <span>{metadata.width} × {metadata.height}</span>
            </div>
          )}
          {metadata.mimeType && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">MIME Type</span>
              <span>{String(metadata.mimeType)}</span>
            </div>
          )}
        </div>
      );

    case "cloud-upload":
      return (
        <div className="grid gap-2 text-xs min-w-0">
          {metadata.gcsUri && (
            <div className="flex justify-between gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">GCS URI</span>
              <code className="truncate bg-muted px-1 rounded min-w-0">
                {String(metadata.gcsUri)}
              </code>
            </div>
          )}
          {metadata.bucket && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bucket</span>
              <span className="truncate">{String(metadata.bucket)}</span>
            </div>
          )}
          {metadata.objectName && (
            <div className="flex justify-between gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">Object</span>
              <span className="truncate min-w-0">{String(metadata.objectName)}</span>
            </div>
          )}
        </div>
      );

    case "shot-detection": {
      const shots = metadata.shots as Array<{ start: number; end: number; duration: number }> | undefined;
      if (!shots?.length) return <p className="text-xs text-muted-foreground">No shots detected</p>;
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{shots.length} shot(s) detected</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {shots.map((shot, i) => (
              <div key={i} className="flex justify-between text-xs bg-muted/30 rounded px-2 py-1">
                <span>Shot {i + 1}</span>
                <span className="text-muted-foreground">
                  {(shot.start ?? 0).toFixed(2)}s – {(shot.end ?? 0).toFixed(2)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "face-detection": {
      const faces = metadata.faces as Array<{ trackId?: number; thumbnail?: string }> | undefined;
      if (!faces?.length) return <p className="text-xs text-muted-foreground">No faces detected</p>;
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{faces.length} face(s) detected</p>
          <div className="flex gap-2 flex-wrap">
            {faces.slice(0, 6).map((face, i) => (
              <div
                key={i}
                className="size-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground"
              >
                {face.thumbnail ? (
                  <img src={face.thumbnail} alt={`Face ${i + 1}`} className="size-full object-cover rounded" />
                ) : (
                  `#${i + 1}`
                )}
              </div>
            ))}
            {faces.length > 6 && (
              <div className="size-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                +{faces.length - 6}
              </div>
            )}
          </div>
        </div>
      );
    }

    case "transcription": {
      const segments = metadata.segments as Array<{ start: number; speech: string }> | undefined;
      const transcript = metadata.transcript as string | undefined;
      return (
        <div className="space-y-2 min-w-0">
          {transcript && (
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Transcript</p>
              <p className="text-xs bg-muted/30 rounded p-2 max-h-24 overflow-y-auto break-words">
                {transcript}
              </p>
            </div>
          )}
          {segments && segments.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{segments.length} word(s) with timestamps</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {segments.slice(0, 20).map((seg, i) => (
                  <div key={i} className="flex justify-between text-xs bg-muted/30 rounded px-2 py-1">
                    <span>{seg.speech}</span>
                    <span className="text-muted-foreground">{(seg.start / 1000).toFixed(2)}s</span>
                  </div>
                ))}
                {segments.length > 20 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{segments.length - 20} more words
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    default:
      return (
        <pre className="text-xs overflow-auto max-h-32 bg-muted/30 rounded p-2 whitespace-pre-wrap break-all">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      );
  }
}
