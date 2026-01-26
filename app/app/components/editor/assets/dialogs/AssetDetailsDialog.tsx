"use client";

import { useCallback, useMemo } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
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
import type { TranscriptionRecord } from "@/app/types/transcription";
import { toast } from "sonner";
import { formatBytes, STEP_STATUS_STYLES, STEP_DOT_STYLES } from "../utils";
import { cn } from "@/lib/utils";

interface AssetDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: RemoteAsset | null;
  pipelineSteps: PipelineStepState[];
  transcription?: TranscriptionRecord;
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
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
                  <div
                    key={step.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full shrink-0",
                        STEP_DOT_STYLES[step.status]
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{step.label}</p>
                      {step.error && (
                        <p className="text-xs text-destructive truncate">
                          {step.error}
                        </p>
                      )}
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
                  </div>
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
