"use client";

import { useState, useCallback, type ChangeEvent } from "react";
import { Loader2, ImageIcon, X } from "lucide-react";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RemoteAsset } from "@/app/types/assets";
import { encodeFile, type EncodedFile } from "../utils";

interface ImagePanelProps {
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

export function ImagePanel({ projectId, onGenerated }: ImagePanelProps) {
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

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/banana", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
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

      // Reset form
      setPrompt("");
      setSourceImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, aspectRatio, imageSize, projectId, sourceImage, onGenerated]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ImageIcon className="size-4" />
          Generate Image
        </div>
        <p className="text-xs text-muted-foreground">
          Create images with Banana Pro
        </p>

        {/* Prompt */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Prompt</label>
          <Textarea
            placeholder="Describe your image..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Aspect Ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="1:1">1:1 Square</option>
              <option value="16:9">16:9 Landscape</option>
              <option value="9:16">9:16 Portrait</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Size
            </label>
            <select
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value as "1K" | "2K" | "4K")}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
        </div>

        {/* Source Image */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Reference image (optional)
          </label>
          {sourceImage ? (
            <div className="rounded-md border border-border p-2 flex items-center gap-2 bg-muted/30">
              <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs truncate flex-1">{sourceImage.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => setSourceImage(null)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-2.5 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
              <ImageIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Add reference image</span>
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
              <ImageIcon className="size-3.5 mr-1.5" />
              Generate Image
            </>
          )}
        </Button>

        {!projectId && (
          <p className="text-[11px] text-muted-foreground text-center">
            Save your project first to generate images.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
