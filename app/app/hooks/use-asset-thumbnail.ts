"use client";

import { useEffect, useState } from "react";
import { usePipelineStatesStore } from "@/app/lib/store/pipeline-states-store";

/**
 * Get thumbnail URL - uses pipeline state (Firestore) to know when ready,
 * fetches fresh signed URL from API when step succeeds (URLs expire, can't store).
 */
export function useAssetThumbnail(
  assetId: string | undefined,
  projectId: string | null
): { thumbnailUrl: string | null; isLoading: boolean } {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const states = usePipelineStatesStore((s) => s.states);
  const steps = assetId ? (states[assetId] ?? []) : [];
  const thumbStep = steps.find((s) => s.id === "thumbnail");
  const stepStatus = thumbStep?.status ?? "idle";

  const isLoading =
    !!assetId &&
    !!projectId &&
    (stepStatus === "running" || stepStatus === "waiting");

  useEffect(() => {
    if (!assetId || !projectId || stepStatus !== "succeeded") {
      if (stepStatus !== "succeeded") setThumbnailUrl(null);
      return;
    }

    let cancelled = false;

    fetch(
      `/api/assets/${assetId}/thumbnail?projectId=${encodeURIComponent(projectId)}`,
      { credentials: "include" }
    )
      .then((res) => (res.ok ? res.json() : { url: null, available: false }))
      .then((d: { url?: string | null; available?: boolean }) => {
        if (!cancelled && d.available && d.url) {
          setThumbnailUrl(d.url);
        }
      })
      .catch(() => {
        if (!cancelled) setThumbnailUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, projectId, stepStatus]);

  return { thumbnailUrl, isLoading };
}
