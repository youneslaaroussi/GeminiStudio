"use client";

import { useState, useCallback, useEffect, type ChangeEvent } from "react";
import { Loader2, Sparkles, X, ImageIcon, Video } from "lucide-react";
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
import { encodeFile, type EncodedFile } from "../utils";

interface VeoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

export function VeoDialog({ open, onOpenChange, projectId, onGenerated }: VeoDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [promptIdea, setPromptIdea] = useState("");
  const [duration, setDuration] = useState<5 | 8>(8);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageInput, setImageInput] = useState<EncodedFile | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock duration to 8s for higher resolutions
  useEffect(() => {
    if (resolution !== "720p" && duration !== 8) {
      setDuration(8);
    }
  }, [resolution, duration]);

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
    if (isGenerating || !prompt.trim() || !projectId) return;

    setIsGenerating(true);
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

      const response = await fetch("/api/veo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        asset?: RemoteAsset;
        error?: string;
      };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Failed to generate video");
      }

      onGenerated(data.asset);
      handleClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating,
    prompt,
    duration,
    aspectRatio,
    resolution,
    generateAudio,
    projectId,
    imageInput,
    negativePrompt,
    onGenerated,
  ]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isGenerating) return;
      if (!nextOpen) {
        setPrompt("");
        setPromptIdea("");
        setNegativePrompt("");
        setImageInput(null);
        setError(null);
      }
      onOpenChange(nextOpen);
    },
    [isGenerating, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="size-5" />
            Generate Video with Veo 3
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt Idea + Enhance */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Quick idea</label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. A cat playing piano"
                value={promptIdea}
                onChange={(e) => setPromptIdea(e.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEnhancePrompt}
                disabled={isEnhancing || (!promptIdea && !prompt)}
              >
                {isEnhancing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Main Prompt */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Prompt</label>
            <Textarea
              placeholder="Describe your video in detail..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Duration
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as 5 | 8)}
                disabled={resolution !== "720p"}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value={5}>5 seconds</option>
                <option value={8}>8 seconds</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) =>
                  setAspectRatio(e.target.value as "16:9" | "9:16")
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Resolution
              </label>
              <select
                value={resolution}
                onChange={(e) =>
                  setResolution(e.target.value as "720p" | "1080p" | "4k")
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4K</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Audio
              </label>
              <select
                value={generateAudio ? "yes" : "no"}
                onChange={(e) => setGenerateAudio(e.target.value === "yes")}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="yes">Generate audio</option>
                <option value="no">No audio</option>
              </select>
            </div>
          </div>

          {/* Starting Image */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Starting image (optional)
            </label>
            {imageInput ? (
              <div className="relative rounded-md border border-border p-2 flex items-center gap-2">
                <ImageIcon className="size-4 text-muted-foreground" />
                <span className="text-sm truncate flex-1">
                  {imageInput.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setImageInput(null)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
                <ImageIcon className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to add starting frame
                </span>
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
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Negative prompt (optional)
            </label>
            <Input
              placeholder="What to avoid..."
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
            />
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
              "Generate Video"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
