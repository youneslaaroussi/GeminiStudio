"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2, Volume2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { RemoteAsset } from "@/app/types/assets";
import {
  CHIRP3_HD_VOICES,
  CHIRP3_LANGUAGE_OPTIONS,
} from "@/app/lib/services/tts";
import type { SupportedTtsEncoding } from "@/app/lib/services/tts";

interface TtsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

const AUDIO_ENCODING_OPTIONS: { id: SupportedTtsEncoding; label: string }[] = [
  { id: "mp3", label: "MP3 (web friendly)" },
  { id: "ogg_opus", label: "OGG Opus" },
  { id: "linear16", label: "WAV (lossless)" },
];

export function TtsDialog({ open, onOpenChange, projectId, onGenerated }: TtsDialogProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [voiceName, setVoiceName] = useState(CHIRP3_HD_VOICES[0]?.id ?? "");
  const [languageCode, setLanguageCode] = useState("en-US");
  const [speakingRate, setSpeakingRate] = useState(1);
  const [encoding, setEncoding] = useState<SupportedTtsEncoding>("mp3");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setFileName("");
      setVoiceName(CHIRP3_HD_VOICES[0]?.id ?? "");
      setLanguageCode("en-US");
      setSpeakingRate(1);
      setEncoding("mp3");
      setIsGenerating(false);
      setError(null);
    }
  }, [open]);

  const selectedVoice = useMemo(
    () => CHIRP3_HD_VOICES.find((item) => item.id === voiceName),
    [voiceName]
  );

  const charCount = text.length;
  const maxChars = 5000;

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isGenerating) return;
      onOpenChange(nextOpen);
    },
    [isGenerating, onOpenChange]
  );

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    if (!projectId) {
      setError("Save or select a project before generating speech.");
      return;
    }
    if (!text.trim()) {
      setError("Enter some narration to synthesize.");
      return;
    }
    if (!voiceName) {
      setError("Select a voice before generating audio.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          voiceName,
          languageCode,
          speakingRate,
          audioEncoding: encoding,
          fileName: fileName.trim() || undefined,
          projectId,
        }),
      });
      const data = (await response.json()) as { asset?: RemoteAsset; error?: string };
      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Text-to-speech generation failed");
      }

      onGenerated(data.asset);
      handleClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate speech");
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating,
    projectId,
    text,
    voiceName,
    languageCode,
    speakingRate,
    encoding,
    fileName,
    onGenerated,
    handleClose,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="size-5" />
            Generate Narration (Text-to-Speech)
          </DialogTitle>
          <DialogDescription>
            Synthesize voiceover audio with Google Cloud Text-to-Speech Chirp 3 HD voices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Script
            </label>
            <Textarea
              value={text}
              onChange={(event) => {
                if (event.target.value.length <= maxChars) {
                  setText(event.target.value);
                }
              }}
              rows={6}
              placeholder="Write narration or dialogue you’d like to hear..."
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Plain text only · punctuation helps pacing</span>
              <span>
                {charCount}/{maxChars}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Voice
              </label>
              <select
                value={voiceName}
                onChange={(event) => setVoiceName(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              >
                {CHIRP3_HD_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
              {selectedVoice && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedVoice.gender === "FEMALE" ? "Female voice" : "Male voice"}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Language
              </label>
              <select
                value={languageCode}
                onChange={(event) => setLanguageCode(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              >
                {CHIRP3_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Speaking rate: {speakingRate.toFixed(2)}x
              </label>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={speakingRate}
                onChange={(event) => setSpeakingRate(Number(event.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Slower</span>
                <span>Faster</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Output format
              </label>
              <select
                value={encoding}
                onChange={(event) => setEncoding(event.target.value as SupportedTtsEncoding)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              >
                {AUDIO_ENCODING_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                MP3 works well for timeline previews.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              File name (optional)
            </label>
            <Input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="tts-narration.mp3"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {!projectId && (
            <p className="text-sm text-muted-foreground">
              Tip: assign a project ID in the Project Settings panel before generating assets.
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isGenerating}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isGenerating || !text.trim() || !projectId}
          >
            {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
            {isGenerating ? "Generating..." : "Generate Audio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
