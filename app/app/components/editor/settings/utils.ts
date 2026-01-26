import type { TimelineClip } from "@/app/types/timeline";

export function toNumber(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ClipUpdateHandler = (updates: Partial<TimelineClip>) => void;

export const inputClassName =
  "w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export const labelClassName = "text-xs text-muted-foreground mb-1 block";

export const sectionClassName = "space-y-3";

export const cardClassName = "rounded-lg border border-border bg-card/50 p-3 space-y-3";
