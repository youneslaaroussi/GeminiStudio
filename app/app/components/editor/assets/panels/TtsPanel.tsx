"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Volume2 } from "lucide-react";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { getCreditsForAction } from "@/app/lib/credits-config";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { RemoteAsset } from "@/app/types/assets";
import {
  CHIRP3_HD_VOICES,
  CHIRP3_LANGUAGE_OPTIONS,
} from "@/app/lib/services/tts/voices";

type SupportedTtsEncoding = "mp3" | "ogg_opus" | "linear16";

interface TtsPanelProps {
  projectId: string | null;
  onGenerated: (asset: RemoteAsset) => void;
}

const AUDIO_ENCODING_OPTIONS: { id: SupportedTtsEncoding; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "ogg_opus", label: "OGG Opus" },
  { id: "linear16", label: "WAV" },
];

export function TtsPanel({ projectId, onGenerated }: TtsPanelProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [voiceName, setVoiceName] = useState(CHIRP3_HD_VOICES[0]?.id ?? "");
  const [languageCode, setLanguageCode] = useState("en-US");
  const [speakingRate, setSpeakingRate] = useState(1);
  const [encoding, setEncoding] = useState<SupportedTtsEncoding>("mp3");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ttsCredits = useMemo(() => getCreditsForAction("tts"), []);

  const selectedVoice = useMemo(
    () => CHIRP3_HD_VOICES.find((item) => item.id === voiceName),
    [voiceName]
  );

  const charCount = text.length;
  const maxChars = 5000;

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
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
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
      const data = (await response.json()) as {
        asset?: RemoteAsset;
        error?: string;
        required?: number;
      };

      if (response.status === 402) {
        const msg = data.error ?? "Insufficient credits";
        setError(msg);
        toast.error(msg, {
          description:
            data.required != null
              ? `This generation requires ${data.required} R‑Credits. Add credits to continue.`
              : "Add credits in Settings to continue.",
          action: {
            label: "Add credits",
            onClick: () => router.push("/settings/billing"),
          },
        });
        return;
      }

      if (!response.ok || !data.asset) {
        throw new Error(data.error || "Text-to-speech generation failed");
      }

      onGenerated(data.asset);

      // Reset form
      setText("");
      setFileName("");
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
    router,
  ]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Volume2 className="size-4" />
          Text to Speech
        </div>
        <p className="text-xs text-muted-foreground">
          Generate narration with Chirp 3 HD voices
        </p>

        {/* Script */}
        <div className="space-y-1.5">
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
            rows={4}
            placeholder="Write narration or dialogue..."
            className="text-sm resize-none"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Punctuation helps pacing</span>
            <span>{charCount}/{maxChars}</span>
          </div>
        </div>

        {/* Voice & Language */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Voice
            </label>
            <select
              value={voiceName}
              onChange={(event) => setVoiceName(event.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {CHIRP3_HD_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
            {selectedVoice && (
              <p className="text-[11px] text-muted-foreground">
                {selectedVoice.gender === "FEMALE" ? "Female" : "Male"}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Language
            </label>
            <select
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {CHIRP3_LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Speed & Format */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Speed: {speakingRate.toFixed(2)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={speakingRate}
              onChange={(event) => setSpeakingRate(Number(event.target.value))}
              className="w-full h-1.5 accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.5x</span>
              <span>1.5x</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Format
            </label>
            <select
              value={encoding}
              onChange={(event) => setEncoding(event.target.value as SupportedTtsEncoding)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {AUDIO_ENCODING_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* File Name */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            File name (optional)
          </label>
          <Input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="narration.mp3"
            className="h-8 text-sm"
          />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-2.5">
            <span className="text-xs text-destructive">{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground text-center">
            This generation uses{" "}
            <span className="font-medium tabular-nums text-foreground">{ttsCredits}</span>{" "}
            R‑Credits
          </p>
          <Button
            className="w-full"
            size="sm"
            onClick={() => void handleGenerate()}
            disabled={isGenerating || !text.trim() || !projectId}
          >
            {isGenerating ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <Volume2 className="size-3.5 mr-1.5" />
            )}
            {isGenerating ? "Generating..." : "Generate Audio"}
          </Button>
        </div>

        {!projectId && (
          <p className="text-[11px] text-muted-foreground text-center">
            Save your project first to generate speech.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
