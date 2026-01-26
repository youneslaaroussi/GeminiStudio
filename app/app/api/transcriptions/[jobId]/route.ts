import { NextRequest, NextResponse } from "next/server";
import { getSpeechAccessToken } from "@/app/lib/server/google-speech";
import {
  findTranscriptionJobById,
  updateTranscriptionJob,
  serializeJob,
} from "@/app/lib/server/transcriptions-store";
import type { TranscriptionSegment } from "@/app/types/transcription";
import { updatePipelineStep } from "@/app/lib/server/pipeline/store";

export const runtime = "nodejs";

type SpeechWord = {
  startOffset?: unknown;
  word?: string | null;
};

type SpeechAlternative = {
  transcript?: string | null;
  words?: SpeechWord[];
};

type SpeechRecognitionResult = {
  alternatives?: SpeechAlternative[];
  transcript?: { results?: SpeechRecognitionResult[] };
  results?: SpeechRecognitionResult[];
};

function offsetToMilliseconds(offset: unknown): number {
  if (typeof offset === "number") {
    return offset * 1000;
  }
  if (typeof offset === "string") {
    const numeric = Number(offset.replace(/[^\d.]/g, ""));
    return Number.isFinite(numeric) ? numeric * 1000 : 0;
  }
  if (!offset || typeof offset !== "object") {
    return 0;
  }
  const secondsRaw = (offset as { seconds?: number | string }).seconds;
  const nanos = (offset as { nanos?: number }).nanos ?? 0;
  const seconds =
    typeof secondsRaw === "string" ? Number(secondsRaw) : secondsRaw ?? 0;
  return seconds * 1000 + Math.round(nanos / 1_000_000);
}

function extractResultError(payload: unknown, gcsUri: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const response = (payload as { response?: unknown }).response;
  if (!response || typeof response !== "object") return null;
  const resultsField = (response as { results?: unknown }).results;
  if (!resultsField || typeof resultsField !== "object") return null;

  const record = resultsField as Record<string, unknown>;
  const fileResult = (record[gcsUri] ?? Object.values(record)[0]) as { error?: { message?: string } } | undefined;
  if (fileResult?.error?.message) {
    return fileResult.error.message;
  }
  return null;
}

function extractResults(payload: unknown, gcsUri: string): SpeechRecognitionResult[] {
  if (!payload || typeof payload !== "object") return [];
  const response = (payload as { response?: unknown }).response;
  if (!response || typeof response !== "object") return [];
  const resultsField = (response as { results?: unknown }).results;
  if (!resultsField) return [];

  if (Array.isArray(resultsField)) {
    return resultsField as SpeechRecognitionResult[];
  }

  if (typeof resultsField === "object") {
    const record = resultsField as Record<string, unknown>;
    const candidate = (record[gcsUri] ?? Object.values(record)[0]) as
      | SpeechRecognitionResult[]
      | SpeechRecognitionResult
      | undefined;
    if (!candidate) return [];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if ("results" in candidate && Array.isArray(candidate.results)) {
      return candidate.results;
    }
    return [candidate];
  }

  return [];
}

function extractTranscriptionData(payload: unknown, gcsUri: string) {
  const results = extractResults(payload, gcsUri);
  const segments: TranscriptionSegment[] = [];
  const transcriptParts: string[] = [];

  for (const result of results) {
    const alternative =
      result?.alternatives && result.alternatives.length > 0
        ? result.alternatives[0]
        : undefined;
    if (!alternative) continue;

    if (alternative.transcript) {
      transcriptParts.push(alternative.transcript.trim());
    }

    for (const word of alternative.words ?? []) {
      const speech = word.word?.trim();
      if (!speech) continue;
      const start = offsetToMilliseconds(word.startOffset);
      segments.push({ start, speech });
    }
  }

  let transcript = transcriptParts.join(" ").replace(/\s+/g, " ").trim();
  if (!transcript && segments.length) {
    transcript = segments
      .map((segment) => segment.speech)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!segments.length && transcript) {
    const fallbackParts = transcript
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    fallbackParts.forEach((part, index) => {
      segments.push({
        start: index * 4000,
        speech: part,
      });
    });
  }

  return { transcript, segments };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await findTranscriptionJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Transcription job not found" }, { status: 404 });
  }

  if (job.status === "completed" || job.status === "error") {
    return NextResponse.json({ job: serializeJob(job) });
  }

  if (!job.operationName) {
    const updated = await updateTranscriptionJob(job.id, {
      status: "error",
      error: "Missing operation reference",
    });
    await updatePipelineStep(job.assetId, "transcription", (prev) => ({
      ...prev,
      status: "failed",
      error: "Missing operation reference",
      updatedAt: new Date().toISOString(),
    }));
    return NextResponse.json({ job: serializeJob(updated ?? job) });
  }

  try {
    const token = await getSpeechAccessToken();
    // Extract location from operation name: projects/{project}/locations/{location}/operations/{id}
    const locationMatch = job.operationName.match(/locations\/([^/]+)/);
    const location = locationMatch?.[1] ?? "global";
    const endpoint = location === "global"
      ? "speech.googleapis.com"
      : `${location}-speech.googleapis.com`;
    const url = `https://${endpoint}/v2/${job.operationName}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch transcription status: ${text}`);
    }

    const payload = (await response.json()) as {
      done?: boolean;
      error?: { message?: string };
    };

    // Debug: log raw response
    console.log("[transcription] Raw Speech API response:", JSON.stringify(payload, null, 2));

    if (!payload.done) {
      return NextResponse.json({ job: serializeJob(job) });
    }

    if (payload.error) {
      const updated = await updateTranscriptionJob(job.id, {
        status: "error",
        error: payload.error.message || "Speech-to-Text returned an error",
      });
      await updatePipelineStep(job.assetId, "transcription", (prev) => ({
        ...prev,
        status: "failed",
        error: payload.error?.message || prev.error,
        updatedAt: new Date().toISOString(),
      }));
      return NextResponse.json({ job: serializeJob(updated ?? job) });
    }

    // Check for per-file error in results (e.g., encoding issues)
    const resultError = extractResultError(payload, job.gcsUri);
    if (resultError) {
      const updated = await updateTranscriptionJob(job.id, {
        status: "error",
        error: resultError,
      });
      await updatePipelineStep(job.assetId, "transcription", (prev) => ({
        ...prev,
        status: "failed",
        error: resultError,
        updatedAt: new Date().toISOString(),
      }));
      return NextResponse.json({ job: serializeJob(updated ?? job) });
    }

    const { transcript, segments } = extractTranscriptionData(payload, job.gcsUri);
    console.log("[transcription] Extracted transcript:", transcript);
    console.log("[transcription] Extracted segments:", segments.length);
    const updated = await updateTranscriptionJob(job.id, {
      status: "completed",
      transcript,
      segments,
    });
    await updatePipelineStep(job.assetId, "transcription", (prev) => ({
      ...prev,
      status: "succeeded",
      metadata: {
        ...(prev.metadata ?? {}),
        transcript,
        segments,
        jobId: job.id,
      },
      updatedAt: new Date().toISOString(),
    }));

    return NextResponse.json({ job: serializeJob(updated ?? job) });
  } catch (error) {
    console.error("Failed to poll transcription job", error);
    const updated = await updateTranscriptionJob(job.id, {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    await updatePipelineStep(job.assetId, "transcription", (prev) => ({
      ...prev,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      updatedAt: new Date().toISOString(),
    }));
    return NextResponse.json({ job: serializeJob(updated ?? job) }, { status: 500 });
  }
}
