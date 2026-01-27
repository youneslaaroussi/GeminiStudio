"use client";

import { useState, useCallback } from "react";
import { Loader2, Music, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { RemoteAsset } from "@/app/types/assets";

interface LyriaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

export function LyriaDialog({ open, onOpenChange, projectId, onGenerated }: LyriaDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [useSeed, setUseSeed] = useState(false);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (isGenerating || !prompt.trim() || !projectId) return;

    setIsGenerating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        prompt: prompt.trim(),
        projectId,
        sampleCount: 1,
      };

      if (negativePrompt.trim()) {
        payload.negativePrompt = negativePrompt.trim();
      }

      if (useSeed && seed !== undefined) {
        payload.seed = seed;
      }

      const response = await fetch("/api/lyria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        asset?: RemoteAsset;
        error?: string;
      };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Failed to generate music");
      }

      onGenerated(data.asset);
      handleClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, negativePrompt, useSeed, seed, projectId, onGenerated]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isGenerating) return;
      if (!nextOpen) {
        setPrompt("");
        setNegativePrompt("");
        setUseSeed(false);
        setSeed(undefined);
        setError(null);
      }
      onOpenChange(nextOpen);
    },
    [isGenerating, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="size-5" />
            Generate Music with Lyria
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Main Prompt */}
          <div className="space-y-2">
            <label htmlFor="lyria-prompt" className="text-sm font-medium">Prompt</label>
            <Textarea
              id="lyria-prompt"
              placeholder="Describe your music... e.g., 'An energetic electronic dance track with a fast tempo and driving beat, featuring synthesizers and electronic drums'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Describe the genre, mood, instruments, tempo, and style you want.
            </p>
          </div>

          {/* Negative Prompt */}
          <div className="space-y-2">
            <label htmlFor="lyria-negative" className="text-sm font-medium">Negative prompt (optional)</label>
            <Input
              id="lyria-negative"
              placeholder="e.g., vocals, drums, distorted guitar"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Elements to exclude from the generated music.
            </p>
          </div>

          {/* Seed Option */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label htmlFor="use-seed" className="text-sm font-medium">Use seed for reproducibility</label>
                <p className="text-xs text-muted-foreground">
                  Generate consistent results with the same prompt
                </p>
              </div>
              <input
                type="checkbox"
                id="use-seed"
                checked={useSeed}
                onChange={(e) => setUseSeed(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
            </div>
            {useSeed && (
              <Input
                type="number"
                placeholder="Enter a seed number (e.g., 12345)"
                value={seed ?? ""}
                onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              />
            )}
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">About Lyria</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Generates instrumental music only (no vocals)</li>
              <li>Output: ~32 seconds of WAV audio at 48kHz</li>
              <li>Generation takes 10-20 seconds</li>
            </ul>
          </div>

          {/* Prompt Examples */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Example prompts:</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Calm piano piece for studying",
                "Energetic EDM with synths",
                "Cinematic orchestral, heroic",
                "Lo-fi hip hop, relaxing",
                "Ambient soundscape, dreamy",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="size-4 mr-2" />
                Generate Music
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
