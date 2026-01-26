"use client";

import { useCallback } from "react";
import { Copy, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TranscriptionRecord } from "@/app/types/transcription";
import { toast } from "sonner";

interface TranscriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcription: TranscriptionRecord | null;
}

export function TranscriptDialog({
  open,
  onOpenChange,
  transcription,
}: TranscriptDialogProps) {
  const handleCopy = useCallback(async () => {
    if (!transcription?.transcript) return;
    try {
      await navigator.clipboard.writeText(transcription.transcript);
      toast.success("Transcript copied");
    } catch {
      toast.error("Failed to copy");
    }
  }, [transcription]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Transcription
          </DialogTitle>
        </DialogHeader>

        {transcription ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {transcription.assetName}
              </p>
              {transcription.transcript && (
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="size-3.5 mr-1.5" />
                  Copy
                </Button>
              )}
            </div>

            {transcription.status === "completed" ? (
              transcription.transcript ? (
                <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {transcription.transcript}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  The transcription returned empty. The audio may not contain
                  detectable speech.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {transcription.status === "processing"
                  ? "Transcription is still processing..."
                  : transcription.error || "No transcription available."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No transcription selected.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
