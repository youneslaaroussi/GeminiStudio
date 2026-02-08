"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, ChevronDown, ChevronRight, Camera, RotateCw, StickyNote } from "lucide-react";
import { getAuthToken } from "@/app/lib/hooks/useAuthFetch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  projectId: string | null;
  pipelineSteps: PipelineStepState[];
  pipelineLoading?: boolean;
  transcription?: ProjectTranscription;
  onPipelineRefresh?: () => void;
  /** Refresh pipeline state from server (with minimum loading duration) */
  onRefreshPipeline?: () => void | Promise<void>;
  onUpdateNotes?: (assetId: string, notes: string) => Promise<boolean>;
}

export function AssetDetailsDialog({
  open,
  onOpenChange,
  asset,
  projectId,
  pipelineSteps,
  pipelineLoading,
  transcription,
  onPipelineRefresh,
  onRefreshPipeline,
  onUpdateNotes,
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>Asset Details</SheetTitle>
        </SheetHeader>

        {!asset ? (
          <p className="text-sm text-muted-foreground py-8 text-center px-4">
            No asset selected.
          </p>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 space-y-6 pb-4">
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
              {asset.duration !== undefined && (
                <InfoCard
                  label="Duration"
                  value={`${Number(asset.duration).toFixed(2)}s`}
                />
              )}
              {(asset.width || asset.height) && (
                <InfoCard
                  label="Dimensions"
                  value={`${asset.width ?? "?"}×${asset.height ?? "?"}`}
                />
              )}
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

          {/* Notes */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <StickyNote className="size-4 text-muted-foreground" />
              Notes
            </h4>
            <AssetNotesEditor
              assetId={asset.id}
              notes={asset.notes ?? ""}
              onSave={onUpdateNotes}
            />
          </section>

          {/* Cloud Storage */}
          {uploadMetadata?.gcsUri && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Cloud Storage</h4>
                {(uploadMetadata.signedUrl ?? asset.signedUrl ?? asset.url) && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={uploadMetadata.signedUrl ?? asset.signedUrl ?? asset.url}
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

          {/* Pipeline Steps (media assets only; custom components have no pipeline) */}
          {asset.type === "component" ? (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Pipeline</h4>
              <p className="text-sm text-muted-foreground rounded-lg border border-border p-3">
                Custom components don't run a pipeline. Edit code in the <strong>Components</strong> tab.
              </p>
            </section>
          ) : (pipelineSteps.length > 0 || pipelineLoading) ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Pipeline</h4>
                {onRefreshPipeline && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => void onRefreshPipeline()}
                    disabled={pipelineLoading}
                    aria-busy={pipelineLoading}
                  >
                    <RotateCw
                      className={cn("size-3.5 shrink-0", pipelineLoading && "animate-spin")}
                    />
                    <span className="text-xs">
                      {pipelineLoading ? "Refreshing…" : "Refresh"}
                    </span>
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {pipelineLoading && pipelineSteps.length === 0 ? (
                  // Skeleton only when we have no data yet (first load)
                  <>
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border p-3 animate-pulse"
                      >
                        <div className="flex items-center gap-3">
                          <div className="size-4 bg-muted rounded" />
                          <div className="size-2 bg-muted rounded-full" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-muted rounded w-32" />
                            <div className="h-3 bg-muted rounded w-24" />
                          </div>
                          <div className="h-5 bg-muted rounded-full w-16" />
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  pipelineSteps.map((step) => (
                    <PipelineStepCard
                      key={step.id}
                      step={step}
                      asset={asset}
                      projectId={projectId}
                      onRerun={onPipelineRefresh}
                    />
                  ))
                )}
              </div>
            </section>
          ) : null}

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
        )}

        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const MIN_SAVE_INDICATOR_MS = 400;

function AssetNotesEditor({
  assetId,
  notes,
  onSave,
}: {
  assetId: string;
  notes: string;
  onSave?: (assetId: string, notes: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(notes);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(notes);

  useEffect(() => {
    setValue(notes);
    setLastSaved(notes);
  }, [assetId, notes]);

  const handleSave = useCallback(async () => {
    if (!onSave || value === lastSaved) return;
    setSaving(true);
    const startedAt = Date.now();
    let ok = false;
    try {
      ok = await onSave(assetId, value.trim());
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SAVE_INDICATOR_MS - elapsed);
      await new Promise((r) => setTimeout(r, remaining));
      if (ok) setLastSaved(value.trim());
      setSaving(false);
    }
  }, [assetId, value, lastSaved, onSave]);

  const showSaveRow = (onSave && value !== lastSaved) || saving;

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="What is this asset for? Add notes to remember later..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void handleSave()}
        className="min-h-[80px] resize-y text-sm"
        disabled={!onSave}
      />
      {showSaveRow && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              "Save notes"
            )}
          </Button>
        </div>
      )}
    </div>
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

function PipelineStepCard({
  step,
  asset,
  projectId,
  onRerun,
}: {
  step: PipelineStepState;
  asset: RemoteAsset;
  projectId: string | null;
  onRerun?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const hasDetails = step.metadata && Object.keys(step.metadata).length > 0;

  const canRerun = step.status === "succeeded" || step.status === "failed";

  const handleRerun = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rerunning) return;

    if (!projectId) {
      toast.error("Missing project ID");
      return;
    }

    setRerunning(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const url = `/api/assets/${asset.id}/pipeline?projectId=${encodeURIComponent(projectId)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ stepId: step.id }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ?? "Failed to re-run pipeline step");
      }

      toast.success(`${step.label} completed`);
      onRerun?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to re-run pipeline step");
    } finally {
      setRerunning(false);
    }
  }, [asset.id, projectId, step.id, step.label, rerunning, onRerun]);

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
      case "label-detection": {
        const segmentCount = step.metadata.segmentLabelCount as number | undefined;
        return segmentCount ? `${segmentCount} labels detected` : null;
      }
      case "person-detection": {
        const personCount = step.metadata.personCount as number | undefined;
        return personCount ? `${personCount} person(s) detected` : null;
      }
      case "transcription": {
        // New format: segments is array of { start, speech } - one per word
        const segments = step.metadata.segments as Array<{ start?: number; speech?: string }> | undefined;
        const transcript = step.metadata.transcript as string | undefined;
        // Each segment is a word in the new format
        if (segments && segments.length > 0) return `${segments.length} words`;
        if (transcript && transcript.trim()) return `${transcript.split(" ").length} words`;
        // Completed but no speech detected
        if (step.status === "succeeded") return "No speech detected";
        return null;
      }
      case "gemini-analysis": {
        const category = step.metadata.category as string | undefined;
        const totalTokens = step.metadata.totalTokens as number | undefined;
        if (category && totalTokens) {
          return `${category} analysis (${totalTokens.toLocaleString()} tokens)`;
        }
        if (category) return `${category} analysis`;
        return "AI analysis complete";
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
        {canRerun && (
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
            title={`Re-run ${step.label}`}
          >
            {rerunning ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <RotateCw className="size-3.5 text-muted-foreground" />
            )}
          </button>
        )}
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
          <PipelineStepDetails stepId={step.id} metadata={step.metadata} asset={asset} />
        </div>
      )}
    </div>
  );
}

function PipelineStepDetails({
  stepId,
  metadata,
  asset,
}: {
  stepId: string;
  metadata: Record<string, unknown>;
  asset: RemoteAsset;
}) {
  switch (stepId) {
    case "metadata":
      return (
        <div className="grid gap-2 text-xs">
          {(metadata.duration as number | undefined) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span>{Number(metadata.duration as number).toFixed(2)}s</span>
            </div>
          )}
          {(metadata.width as string | undefined) && (metadata.height as string | undefined) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dimensions</span>
              <span>{metadata.width as string} × {metadata.height as string}</span>
            </div>
          )}
          {(metadata.mimeType as string | undefined) && (
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
          {(metadata.gcsUri as string | undefined) && (
            <div className="flex justify-between gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">GCS URI</span>
              <code className="truncate bg-muted px-1 rounded min-w-0">
                {String(metadata.gcsUri)}
              </code>
            </div>
          )}
          {(metadata.bucket as string | undefined) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bucket</span>
              <span className="truncate">{String(metadata.bucket)}</span>
            </div>
          )}
          {(metadata.objectName as string | undefined) && (
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
      const faces = metadata.faces as Array<{
        faceIndex: number;
        trackId?: number;
        thumbnail?: string;
        firstAppearance?: { time: number; boundingBox: unknown } | null;
      }> | undefined;
      if (!faces?.length) return <p className="text-xs text-muted-foreground">No faces detected</p>;
      return (
        <FaceDetectionDetails faces={faces} asset={asset} />
      );
    }

    case "label-detection": {
      const segmentLabels = metadata.segmentLabels as Array<{
        entity: { description: string; entityId: string };
        categories: Array<{ description: string }>;
        confidence: number;
        segments: Array<{ start: number; end: number; confidence: number }>;
      }> | undefined;
      const shotLabels = metadata.shotLabels as Array<{
        entity: { description: string };
        confidence: number;
        segments: Array<{ start: number; end: number }>;
      }> | undefined;

      if (!segmentLabels?.length && !shotLabels?.length) {
        return <p className="text-xs text-muted-foreground">No labels detected</p>;
      }

      return (
        <div className="space-y-3">
          {/* Segment Labels (whole video) */}
          {segmentLabels && segmentLabels.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Video Labels</p>
              <div className="flex flex-wrap gap-1.5">
                {segmentLabels.slice(0, 20).map((label, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs"
                    title={`${(label.confidence * 100).toFixed(0)}% confidence${label.categories.length > 0 ? ` | Category: ${label.categories.map(c => c.description).join(", ")}` : ""}`}
                  >
                    {label.entity.description}
                    <span className="text-[10px] opacity-60">
                      {(label.confidence * 100).toFixed(0)}%
                    </span>
                  </span>
                ))}
                {segmentLabels.length > 20 && (
                  <span className="text-xs text-muted-foreground px-2">
                    +{segmentLabels.length - 20} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Shot Labels */}
          {shotLabels && shotLabels.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Shot Labels</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {shotLabels.slice(0, 15).map((label, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                    <span className="font-medium">{label.entity.description}</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{(label.confidence * 100).toFixed(0)}%</span>
                      {label.segments[0] && (
                        <span>
                          {label.segments[0].start.toFixed(1)}s - {label.segments[0].end.toFixed(1)}s
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {shotLabels.length > 15 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{shotLabels.length - 15} more labels
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    case "person-detection": {
      const people = metadata.people as Array<{
        personIndex: number;
        startTime: number;
        endTime: number;
        confidence: number;
        firstAppearance?: {
          boundingBox: { left: number; top: number; right: number; bottom: number };
          attributes: Array<{ name: string; value: string; confidence: number }>;
          landmarks: Array<{ name: string; x: number; y: number }>;
        } | null;
      }> | undefined;
      const attributeSummary = metadata.attributeSummary as Array<{
        name: string;
        values: string[];
      }> | undefined;

      if (!people?.length) {
        return <p className="text-xs text-muted-foreground">No people detected</p>;
      }

      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{people.length} person(s) detected</p>

          {/* Attribute Summary */}
          {attributeSummary && attributeSummary.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Detected Attributes</p>
              <div className="flex flex-wrap gap-1.5">
                {attributeSummary.slice(0, 10).map((attr, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-full text-xs"
                    title={`Values: ${attr.values.join(", ")}`}
                  >
                    {attr.name}
                    <span className="text-[10px] opacity-60">
                      ({attr.values.length})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Person Tracks */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Person Tracks</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {people.slice(0, 10).map((person, i) => (
                <div key={i} className="text-xs bg-muted/30 rounded px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Person #{person.personIndex + 1}</span>
                    <span className="text-muted-foreground">
                      {person.startTime.toFixed(1)}s - {person.endTime.toFixed(1)}s
                    </span>
                  </div>
                  {person.firstAppearance?.attributes && person.firstAppearance.attributes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {person.firstAppearance.attributes.slice(0, 5).map((attr, j) => (
                        <span
                          key={j}
                          className="text-[10px] px-1.5 py-0.5 bg-muted rounded"
                          title={`${(attr.confidence * 100).toFixed(0)}% confidence`}
                        >
                          {attr.name}: {attr.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {people.length > 10 && (
                <p className="text-xs text-muted-foreground text-center py-1">
                  +{people.length - 10} more people
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    case "transcription": {
      const segments = metadata.segments as Array<{
        start?: number;
        speech?: string;
      }> | undefined;
      const transcript = metadata.transcript as string | undefined;

      // Check if transcription completed but found no speech
      const hasNoSpeech = (!transcript || transcript.trim() === "") && (!segments || segments.length === 0);

      if (hasNoSpeech) {
        return (
          <div className="text-xs text-muted-foreground italic py-2">
            No speech detected in this audio. The file may be silent, contain only music/sounds, or the speech may be too quiet to recognize.
          </div>
        );
      }

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
              <p className="text-xs text-muted-foreground mb-1">{segments.length} word(s)</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {segments.slice(0, 30).map((seg, i) => (
                  <div key={i} className="flex justify-between text-xs bg-muted/30 rounded px-2 py-1">
                    <span>{seg.speech}</span>
                    <span className="text-muted-foreground">
                      {((seg.start ?? 0) / 1000).toFixed(2)}s
                    </span>
                  </div>
                ))}
                {segments.length > 30 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{segments.length - 30} more words
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    case "gemini-analysis": {
      const analysis = metadata.analysis as string | undefined;
      const category = metadata.category as string | undefined;
      const totalTokens = metadata.totalTokens as number | undefined;
      const model = metadata.model as string | undefined;

      if (!analysis) {
        return <p className="text-xs text-muted-foreground">No analysis available</p>;
      }

      return (
        <div className="space-y-3 min-w-0">
          {/* Header with category and tokens */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {category && (
                <span className="inline-flex items-center px-2 py-0.5 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-full capitalize">
                  {category}
                </span>
              )}
              {model && (
                <span className="text-muted-foreground">{model}</span>
              )}
            </div>
            {totalTokens && (
              <span className="text-muted-foreground">
                {totalTokens.toLocaleString()} tokens
              </span>
            )}
          </div>

          {/* Analysis content with markdown-like rendering */}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-1">AI Analysis</p>
            <div className="text-xs bg-muted/30 rounded p-3 max-h-64 overflow-y-auto space-y-2">
              {analysis.split('\n').map((line, i) => {
                // Handle headers (lines starting with **)
                if (line.startsWith('**') && line.endsWith('**')) {
                  return (
                    <p key={i} className="font-semibold text-foreground mt-2 first:mt-0">
                      {line.replace(/\*\*/g, '')}
                    </p>
                  );
                }
                // Handle bold inline text and headers like "**Title:**"
                if (line.includes('**')) {
                  const parts = line.split(/(\*\*[^*]+\*\*)/g);
                  return (
                    <p key={i} className={line.match(/^\d+\./) ? 'mt-1' : ''}>
                      {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <strong key={j} className="text-foreground">{part.replace(/\*\*/g, '')}</strong>;
                        }
                        return <span key={j}>{part}</span>;
                      })}
                    </p>
                  );
                }
                // Handle list items
                if (line.startsWith('- ') || line.startsWith('• ')) {
                  return (
                    <p key={i} className="pl-3 text-muted-foreground">
                      • {line.slice(2)}
                    </p>
                  );
                }
                // Handle numbered items
                if (line.match(/^\d+\./)) {
                  return (
                    <p key={i} className="mt-1">{line}</p>
                  );
                }
                // Empty lines become spacing
                if (!line.trim()) {
                  return <div key={i} className="h-1" />;
                }
                // Regular text
                return <p key={i}>{line}</p>;
              })}
            </div>
          </div>
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

function FaceDetectionDetails({
  faces,
  asset,
}: {
  faces: Array<{
    faceIndex: number;
    trackId?: number;
    thumbnail?: string;
    firstAppearance?: { time: number; boundingBox: unknown } | null;
  }>;
  asset: RemoteAsset;
}) {
  const [capturing, setCapturing] = useState<number | "all" | null>(null);
  const [capturedImages, setCapturedImages] = useState<Map<number, string>>(new Map());
  const [expandedFace, setExpandedFace] = useState<{ index: number; url: string } | null>(null);

  const handleCaptureFace = useCallback(async (faceIndex?: number) => {
    const captureKey = faceIndex ?? "all";
    setCapturing(captureKey);

    try {
      const { executeTool } = await import("@/app/lib/tools/tool-registry");
      const result = await executeTool({
        toolName: "captureFaces",
        input: {
          assetId: asset.id,
          faceIndex: faceIndex,
        },
        context: {},
      });

      if (result.status === "success" && result.outputs) {
        const newImages = new Map(capturedImages);
        for (const output of result.outputs) {
          if (output.type === "image" && output.url) {
            const match = output.alt?.match(/Face #(\d+)/);
            if (match) {
              newImages.set(parseInt(match[1]) - 1, output.url);
            }
          }
        }
        setCapturedImages(newImages);
        toast.success(faceIndex !== undefined ? `Face #${faceIndex + 1} captured` : "All faces captured");
      } else if (result.status === "error") {
        toast.error(result.error ?? "Failed to capture faces");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to capture faces");
    } finally {
      setCapturing(null);
    }
  }, [asset.id, capturedImages]);

  const hasBoundingBoxData = faces.some((f) => f.firstAppearance?.boundingBox);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{faces.length} face(s) detected</p>
        {hasBoundingBoxData && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => handleCaptureFace(undefined)}
            disabled={capturing !== null}
          >
            {capturing === "all" ? (
              <Loader2 className="size-3 mr-1 animate-spin" />
            ) : (
              <Camera className="size-3 mr-1" />
            )}
            Capture All
          </Button>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {faces.slice(0, 6).map((face, i) => {
          const capturedUrl = capturedImages.get(face.faceIndex);
          const hasBoundingBox = !!face.firstAppearance?.boundingBox;
          const hasImage = capturedUrl || face.thumbnail;

          return (
            <div key={i} className="relative group">
              <button
                type="button"
                className={cn(
                  "size-12 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground overflow-hidden",
                  hasImage && "cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                )}
                onClick={() => {
                  const url = capturedUrl || face.thumbnail;
                  if (url) {
                    setExpandedFace({ index: face.faceIndex, url });
                  }
                }}
                disabled={!hasImage}
              >
                {capturedUrl ? (
                  <img src={capturedUrl} alt={`Face ${i + 1}`} className="size-full object-cover" />
                ) : face.thumbnail ? (
                  <img src={face.thumbnail} alt={`Face ${i + 1}`} className="size-full object-cover" />
                ) : (
                  `#${i + 1}`
                )}
              </button>
              {hasBoundingBox && !capturedUrl && (
                <button
                  type="button"
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCaptureFace(face.faceIndex);
                  }}
                  disabled={capturing !== null}
                  title={`Capture Face #${face.faceIndex + 1}`}
                >
                  {capturing === face.faceIndex ? (
                    <Loader2 className="size-4 text-white animate-spin" />
                  ) : (
                    <Camera className="size-4 text-white" />
                  )}
                </button>
              )}
            </div>
          );
        })}
        {faces.length > 6 && (
          <div className="size-12 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
            +{faces.length - 6}
          </div>
        )}
      </div>
      {!hasBoundingBoxData && (
        <p className="text-xs text-muted-foreground italic">
          Re-run face detection to enable frame capture with bounding boxes.
        </p>
      )}

      {/* Expanded Face View */}
      {expandedFace && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedFace(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-background rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium">Face #{expandedFace.index + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedFace(null)}
              >
                Close
              </Button>
            </div>
            <div className="p-4">
              <img
                src={expandedFace.url}
                alt={`Face ${expandedFace.index + 1}`}
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
