"use client";

import { useState, useCallback } from "react";
import { Loader2, Music, Sparkles } from "lucide-react";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { RemoteAsset } from "@/app/types/assets";

interface MusicPanelProps {
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

const EXAMPLE_PROMPTS = [
  "Calm piano piece for studying",
  "Energetic EDM with synths",
  "Cinematic orchestral, heroic",
  "Lo-fi hip hop, relaxing",
  "Ambient soundscape, dreamy",
];

export function MusicPanel({ projectId, onGenerated }: MusicPanelProps) {
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

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/lyria", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
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

      // Reset form
      setPrompt("");
      setNegativePrompt("");
      setUseSeed(false);
      setSeed(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, negativePrompt, useSeed, seed, projectId, onGenerated]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Music className="size-4" />
          Generate Music
        </div>
        <p className="text-xs text-muted-foreground">
          Create music with Lyria
        </p>

        {/* Main Prompt */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Prompt</label>
          <Textarea
            placeholder="Describe your music... e.g., 'An energetic electronic dance track with a fast tempo'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
          <p className="text-[11px] text-muted-foreground">
            Describe genre, mood, instruments, tempo, and style.
          </p>
        </div>

        {/* Negative Prompt */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Negative prompt (optional)
          </label>
          <Input
            placeholder="e.g., vocals, drums, distorted guitar"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Seed Option */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">Use seed</span>
              <p className="text-[11px] text-muted-foreground">
                Reproducible results
              </p>
            </div>
            <Switch
              checked={useSeed}
              onCheckedChange={setUseSeed}
            />
          </div>
          {useSeed && (
            <Input
              type="number"
              placeholder="Enter seed number"
              value={seed ?? ""}
              onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="h-8 text-sm"
            />
          )}
        </div>

        {/* Info Box */}
        <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">About Lyria</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Instrumental music only</li>
            <li>~32 seconds WAV at 48kHz</li>
            <li>Takes 10-20 seconds</li>
          </ul>
        </div>

        {/* Prompt Examples */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Examples:</p>
          <div className="flex flex-wrap gap-1">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-2.5">
            <span className="text-xs text-destructive">{error}</span>
          </div>
        )}

        <Button
          className="w-full"
          size="sm"
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating || !projectId}
        >
          {isGenerating ? (
            <>
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="size-3.5 mr-1.5" />
              Generate Music
            </>
          )}
        </Button>

        {!projectId && (
          <p className="text-[11px] text-muted-foreground text-center">
            Save your project first to generate music.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
