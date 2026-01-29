"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function EditorSkeleton() {
  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="ml-auto h-6 w-20" />
        <Skeleton className="h-6 w-6 rounded" />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: Assets panel */}
        <div className="flex w-[18%] min-w-[140px] flex-col border-r border-border p-3 gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>

        {/* Center: Preview + Settings row */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex flex-1 min-h-0">
            {/* Preview area */}
            <div className="flex flex-1 min-w-0 flex-col items-center justify-center gap-4 border-r border-border bg-black/40 p-4">
              <Skeleton className="aspect-video w-full max-w-2xl rounded-lg" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-12 rounded" />
                <Skeleton className="h-8 w-24 rounded" />
                <Skeleton className="h-8 w-12 rounded" />
              </div>
            </div>

            {/* Right: Settings panel */}
            <div className="flex w-[22%] min-w-[200px] flex-col border-border p-3 gap-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>

          {/* Timeline */}
          <div className="flex h-[32%] min-h-[120px] flex-col border-t border-border p-3 gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
