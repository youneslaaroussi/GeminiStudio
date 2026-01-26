import type { PipelineStepStatus } from "@/app/types/pipeline";

export function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1
  );
  const value = size / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
}

export function stripDataUrlPrefix(value: string) {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return value;
  return value.slice(commaIndex + 1);
}

export interface EncodedFile {
  name: string;
  data: string;
  mimeType: string;
  size: number;
}

export async function encodeFile(file: File): Promise<EncodedFile> {
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read file"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });

  const data = stripDataUrlPrefix(result);
  if (!data) {
    throw new Error("File data is empty");
  }

  return {
    name: file.name,
    data,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export const STEP_STATUS_STYLES: Record<PipelineStepStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  queued: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  running: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  waiting: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
  succeeded: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/20 text-destructive",
};

export const STEP_DOT_STYLES: Record<PipelineStepStatus, string> = {
  idle: "bg-muted-foreground/50",
  queued: "bg-amber-500",
  running: "bg-blue-500",
  waiting: "bg-slate-400",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
};
