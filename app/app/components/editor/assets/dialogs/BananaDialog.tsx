"use client";

import { useState, useCallback, type ChangeEvent } from "react";
import { Loader2, ImageIcon, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RemoteAsset } from "@/app/types/assets";
import { encodeFile, type EncodedFile } from "../utils";

interface BananaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

export function BananaDialog({
  open,
  onOpenChange,
  projectId,
  onGenerated,
}: BananaDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [sourceImage, setSourceImage] = useState<EncodedFile | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSourceChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const encoded = await encodeFile(file);
        setSourceImage(encoded);
        setError(null);
      } catch {
        setError("Unable to read the selected file");
      }
      event.target.value = "";
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (isGenerating || !prompt.trim() || !projectId) return;

    setIsGenerating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        prompt,
        aspectRatio,
        imageSize,
        projectId,
      };

      if (sourceImage) {
        payload.sourceImage = {
          data: sourceImage.data,
          mimeType: sourceImage.mimeType,
        };
      }

      const response = await fetch("/api/banana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        asset?: RemoteAsset;
        error?: string;
      };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Failed to generate image");
      }

      onGenerated(data.asset);
      handleClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, aspectRatio, imageSize, projectId, sourceImage, onGenerated]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isGenerating) return;
      if (!nextOpen) {
        setPrompt("");
        setSourceImage(null);
        setError(null);
      }
      onOpenChange(nextOpen);
    },
    [isGenerating, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="size-5" />
            Generate Image with Banana Pro
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Prompt</label>
            <Textarea
              placeholder="Describe your image..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Size
              </label>
              <select
                value={imageSize}
                onChange={(e) =>
                  setImageSize(e.target.value as "1K" | "2K" | "4K")
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
          </div>

          {/* Source Image */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Reference image (optional)
            </label>
            {sourceImage ? (
              <div className="relative rounded-md border border-border p-2 flex items-center gap-2">
                <ImageIcon className="size-4 text-muted-foreground" />
                <span className="text-sm truncate flex-1">
                  {sourceImage.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setSourceImage(null)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
                <ImageIcon className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to add reference image
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSourceChange}
                />
              </label>
            )}
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
              "Generate Image"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
