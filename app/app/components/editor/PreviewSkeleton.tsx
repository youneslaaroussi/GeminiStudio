"use client";

import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the preview panel only (video/canvas area). Use when loading the scene. */
export function PreviewSkeleton() {
  return (
    <div className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-4 bg-black/40 p-4">
      <Skeleton className="aspect-video w-full max-w-2xl rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-12 rounded" />
        <Skeleton className="h-8 w-24 rounded" />
        <Skeleton className="h-8 w-12 rounded" />
      </div>
    </div>
  );
}
