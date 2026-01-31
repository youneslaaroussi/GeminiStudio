"use client";

import { useState, useCallback, useMemo, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X, ImageIcon, Video, CheckCircle2 } from "lucide-react";
import type { VeoJob } from "@/app/types/veo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { encodeFile, type EncodedFile } from "../utils";
import { toast } from "sonner";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { getCreditsForAction } from "@/app/lib/credits-config";

interface VideoPanelProps {
  projectId: string | null;
  onJobStarted?: (job: VeoJob) => void;
}

export function VideoPanel({ projectId, onJobStarted }: VideoPanelProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [promptIdea, setPromptIdea] = useState("");
  const [duration, setDuration] = useState<4 | 6 | 8>(8);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageInput, setImageInput] = useState<EncodedFile | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  const veoCredits = useMemo(
    () =>
      getCreditsForAction("veo_generation", {
        veo: { resolution, durationSeconds: duration },
      }),
    [resolution, duration]
  );

  // Lock duration to 8s for higher resolutions
  const handleResolutionChange = useCallback((newResolution: "720p" | "1080p" | "4k") => {
    setResolution(newResolution);
    if (newResolution !== "720p") {
      setDuration(8);
    }
  }, []);

  const handleImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const encoded = await encodeFile(file);
        setImageInput(encoded);
        setError(null);
      } catch {
        setError("Unable to read the selected file");
      }
      event.target.value = "";
    },
    []
  );

  const handleEnhancePrompt = useCallback(async () => {
    const seed = (promptIdea || prompt).trim();
    if (!seed || isEnhancing) return;

    setIsEnhancing(true);
    setError(null);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: seed,
          aspectRatio,
          durationSeconds: duration,
          includeAudio: generateAudio,
        }),
      });
      const data = (await response.json()) as {
        suggestion?: { finalPrompt: string };
        error?: string;
      };
      if (!response.ok || !data.suggestion) {
        throw new Error(data.error || "Failed to enhance prompt");
      }
      setPrompt(data.suggestion.finalPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enhance prompt");
    } finally {
      setIsEnhancing(false);
    }
  }, [promptIdea, prompt, isEnhancing, aspectRatio, duration, generateAudio]);

  const handleGenerate = useCallback(async () => {
    if (isStarting || !prompt.trim() || !projectId) return;

    setIsStarting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        prompt,
        durationSeconds: duration,
        aspectRatio,
        resolution,
        generateAudio,
        projectId,
      };

      if (imageInput) {
        payload.image = { data: imageInput.data, mimeType: imageInput.mimeType };
        payload.resizeMode = "pad";
      }

      if (negativePrompt.trim()) {
        payload.negativePrompt = negativePrompt.trim();
      }

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/veo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        job?: VeoJob;
        error?: string;
        required?: number;
      };

      if (response.status === 402) {
        const msg = data.error ?? "Insufficient credits";
        setError(msg);
        toast.error(msg, {
          description: data.required != null
            ? `This generation requires ${data.required} R‑Credits. Add credits to continue.`
            : "Add credits in Settings to continue.",
          action: {
            label: "Add credits",
            onClick: () => router.push("/settings/billing"),
          },
        });
        return;
      }

      if (!response.ok || !data.job) {
        throw new Error(data.error || "Failed to start video generation");
      }

      // Job started successfully - notify and reset form
      setLastJobId(data.job.id);
      onJobStarted?.(data.job);

      toast.success("Video generation started", {
        description: "Check the Jobs tab to monitor progress.",
      });

      // Reset form immediately
      setPrompt("");
      setPromptIdea("");
      setNegativePrompt("");
      setImageInput(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation");
    } finally {
      setIsStarting(false);
    }
  }, [
    isStarting,
    prompt,
    duration,
    aspectRatio,
    resolution,
    generateAudio,
    projectId,
    imageInput,
    negativePrompt,
    onJobStarted,
    router,
  ]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Video className="size-4" />
          Generate Video
        </div>
        <p className="text-xs text-muted-foreground">
          Create videos with Veo 3
        </p>

        {/* Prompt Idea + Enhance */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Quick idea</label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. A cat playing piano"
              value={promptIdea}
              onChange={(e) => setPromptIdea(e.target.value)}
              className="h-8 text-sm"
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2"
              onClick={handleEnhancePrompt}
              disabled={isEnhancing || (!promptIdea && !prompt)}
            >
              {isEnhancing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Main Prompt */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Prompt</label>
          <Textarea
            placeholder="Describe your video in detail..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Duration
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) as 4 | 6 | 8)}
              disabled={resolution !== "720p"}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value={4}>4 seconds</option>
              <option value={6}>6 seconds</option>
              <option value={8}>8 seconds</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Aspect Ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as "16:9" | "9:16")}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="16:9">16:9 Landscape</option>
              <option value="9:16">9:16 Portrait</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Resolution
            </label>
            <select
              value={resolution}
              onChange={(e) => handleResolutionChange(e.target.value as "720p" | "1080p" | "4k")}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Audio
            </label>
            <select
              value={generateAudio ? "yes" : "no"}
              onChange={(e) => setGenerateAudio(e.target.value === "yes")}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="yes">With audio</option>
              <option value="no">No audio</option>
            </select>
          </div>
        </div>

        {/* Starting Image */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Starting image (optional)
          </label>
          {imageInput ? (
            <div className="rounded-md border border-border p-2 flex items-center gap-2 bg-muted/30">
              <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs truncate flex-1">{imageInput.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => setImageInput(null)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-2.5 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
              <ImageIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Add starting frame</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
              />
            </label>
          )}
        </div>

        {/* Negative Prompt */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Negative prompt (optional)
          </label>
          <Input
            placeholder="What to avoid..."
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {lastJobId && (
          <div className="rounded-md bg-green-500/10 p-2.5 flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-green-500" />
            <span className="text-xs text-green-500">Job started! Check Jobs tab.</span>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-2.5">
            <span className="text-xs text-destructive">{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground text-center">
            This generation uses <span className="font-medium tabular-nums text-foreground">{veoCredits}</span> R‑Credits
          </p>
          <Button
            className="w-full"
            size="sm"
            onClick={handleGenerate}
            disabled={!prompt.trim() || isStarting || !projectId}
          >
            {isStarting ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Starting...
              </>
            ) : (
              <>
                <Video className="size-3.5 mr-1.5" />
                Generate Video
              </>
            )}
          </Button>
        </div>

        {!projectId && (
          <p className="text-[11px] text-muted-foreground text-center">
            Save your project first to generate videos.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
