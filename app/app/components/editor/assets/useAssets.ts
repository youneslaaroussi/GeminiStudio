"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { RemoteAsset } from "@/app/types/assets";
import { DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { toast } from "sonner";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

export function useAssets() {
  const [assets, setAssets] = useState<RemoteAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});

  const publishAssets = useAssetsStore((state) => state.setAssets);
  const upsertAssetMetadata = useAssetsStore((state) => state.upsertMetadata);
  const metadata = useAssetsStore((state) => state.metadata);
  const projectId = useProjectStore((s) => s.projectId);
  const transcriptions = useProjectStore((s) => s.project.transcriptions ?? {});

  const assetsRef = useRef<RemoteAsset[]>([]);
  const previousAssetsRef = useRef<RemoteAsset[] | null>(null);

  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL("/api/assets", window.location.origin);
      url.searchParams.set("projectId", projectId);
      const authHeaders = await getAuthHeaders();
      const response = await fetch(url.toString(), {
        headers: authHeaders,
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("Unauthorized. Please log in.");
        if (response.status === 503) throw new Error("Asset service not available");
        throw new Error("Failed to load assets");
      }
      const data = (await response.json()) as { assets: RemoteAsset[] };
      setAssets(data.assets ?? []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not load assets");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const addAssets = useCallback((newAssets: RemoteAsset[]) => {
    setAssets((prev) => [...newAssets, ...prev]);
  }, []);

  const renameAsset = useCallback(
    async (assetId: string, name: string): Promise<boolean> => {
      if (!projectId) {
        toast.error("No project selected");
        return false;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Name cannot be empty");
        return false;
      }
      // Optimistic update: apply new name immediately
      setAssets((prev) => {
        previousAssetsRef.current = prev;
        return prev.map((a) =>
          a.id === assetId ? { ...a, name: trimmed } : a
        );
      });
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`/api/assets/${assetId}`, window.location.origin);
        url.searchParams.set("projectId", projectId);
        const response = await fetch(url.toString(), {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to rename asset");
        }
        previousAssetsRef.current = null;
        return true;
      } catch (err) {
        console.error("Failed to rename asset", err);
        if (previousAssetsRef.current) {
          setAssets(previousAssetsRef.current);
          previousAssetsRef.current = null;
        }
        toast.error("Failed to rename asset", {
          description: "Reverted. " + (err instanceof Error ? err.message : "Unknown error"),
        });
        return false;
      }
    },
    [projectId]
  );

  const reorderAssets = useCallback(
    async (orderedIds: string[]): Promise<boolean> => {
      if (!projectId) {
        toast.error("No project selected");
        return false;
      }
      if (orderedIds.length === 0) return true;
      // Optimistic update: reorder list immediately
      setAssets((prev) => {
        previousAssetsRef.current = prev;
        const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
        return [...prev].sort(
          (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999)
        );
      });
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/assets/reorder", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, assetIds: orderedIds }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to reorder assets");
        }
        const data = (await response.json()) as { assets: RemoteAsset[] };
        previousAssetsRef.current = null;
        setAssets(data.assets ?? []);
        return true;
      } catch (err) {
        console.error("Failed to reorder assets", err);
        if (previousAssetsRef.current) {
          setAssets(previousAssetsRef.current);
          previousAssetsRef.current = null;
        }
        toast.error("Failed to reorder assets", {
          description: "Reverted. " + (err instanceof Error ? err.message : "Unknown error"),
        });
        return false;
      }
    },
    [projectId]
  );

  const deleteAsset = useCallback(
    async (assetId: string): Promise<boolean> => {
      if (!projectId) {
        toast.error("No project selected");
        return false;
      }
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`/api/assets/${assetId}`, window.location.origin);
        url.searchParams.set("projectId", projectId);
        const response = await fetch(url.toString(), {
          method: "DELETE",
          headers: authHeaders,
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to delete asset");
        }
        setAssets((prev) => prev.filter((a) => a.id !== assetId));
        toast.success("Asset deleted");
        return true;
      } catch (err) {
        console.error("Failed to delete asset", err);
        toast.error("Failed to delete asset", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
        return false;
      }
    },
    [projectId]
  );

  const resolveAssetDuration = useCallback(
    (asset: RemoteAsset) =>
      assetDurations[asset.id] ?? DEFAULT_ASSET_DURATIONS[asset.type] ?? 5,
    [assetDurations]
  );

  const startTranscription = useCallback(async (asset: RemoteAsset) => {
    if (asset.type !== "audio" && asset.type !== "video") {
      toast.error("Only audio or video assets can be transcribed.");
      return;
    }

    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    try {
      const authHeaders = await getAuthHeaders();
      const url = new URL(`/api/assets/${asset.id}/pipeline`, window.location.origin);
      url.searchParams.set("projectId", projectId);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "transcription" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start transcription");
      }

      toast.success("Transcription started", {
        description: "This may take a few minutes. Check the asset details for progress.",
      });
    } catch (err) {
      console.error("Failed to start transcription:", err);
      toast.error("Failed to start transcription", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [projectId]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    publishAssets(assets);
    assetsRef.current = assets;
  }, [assets, publishAssets]);

  const persistMetadataToServer = useCallback(
    async (assetId: string, update: { width?: number; height?: number; duration?: number }) => {
      if (!projectId) return;
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`/api/assets/${assetId}`, window.location.origin);
        url.searchParams.set("projectId", projectId);
        await fetch(url.toString(), {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
      } catch (err) {
        console.error("Failed to persist asset metadata", err);
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    const mediaElements: Array<HTMLMediaElement | HTMLImageElement> = [];

    const assetsMissingMetadata = assets.filter((asset) => {
      if (assetDurations[asset.id] != null) return false;
      if (asset.duration != null) {
        setAssetDurations((prev) => ({ ...prev, [asset.id]: asset.duration! }));
        if (asset.width && asset.height) {
          upsertAssetMetadata(asset.id, {
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
          });
        }
        return false;
      }
      return true;
    });

    assetsMissingMetadata.forEach((asset) => {
      const defaultDuration =
        DEFAULT_ASSET_DURATIONS[asset.type] ?? DEFAULT_ASSET_DURATIONS.other;
      const hasServerDimensions = asset.width != null && asset.height != null;

      if (asset.type === "image") {
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: defaultDuration };
        });
        upsertAssetMetadata(asset.id, { duration: defaultDuration });

        if (hasServerDimensions) {
          upsertAssetMetadata(asset.id, {
            width: asset.width,
            height: asset.height,
          });
          return;
        }

        const img = new Image();
        img.src = asset.url;
        img.onload = () => {
          if (cancelled) return;
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          upsertAssetMetadata(asset.id, {
            duration: defaultDuration,
            width,
            height,
          });
          void persistMetadataToServer(asset.id, { width, height, duration: defaultDuration });
          img.remove();
        };
        img.onerror = () => img.remove();
        mediaElements.push(img);
        return;
      }

      const media =
        asset.type === "audio"
          ? document.createElement("audio")
          : document.createElement("video");
      media.preload = "metadata";
      media.src = asset.url;
      media.onloadedmetadata = () => {
        if (cancelled) return;
        const duration =
          Number.isFinite(media.duration) && media.duration > 0
            ? media.duration
            : defaultDuration;
        setAssetDurations((prev) => {
          if (prev[asset.id] && prev[asset.id] === duration) return prev;
          return { ...prev, [asset.id]: duration };
        });

        const width =
          asset.type === "video" && media instanceof HTMLVideoElement
            ? media.videoWidth || undefined
            : undefined;
        const height =
          asset.type === "video" && media instanceof HTMLVideoElement
            ? media.videoHeight || undefined
            : undefined;

        upsertAssetMetadata(asset.id, { duration, width, height });

        if (!hasServerDimensions && (width || height || duration !== defaultDuration)) {
          void persistMetadataToServer(asset.id, { width, height, duration });
        }

        media.remove();
      };
      media.onerror = () => {
        if (cancelled) return;
        setAssetDurations((prev) => {
          if (prev[asset.id] != null) return prev;
          return { ...prev, [asset.id]: defaultDuration };
        });
        upsertAssetMetadata(asset.id, { duration: defaultDuration });
        media.remove();
      };
      mediaElements.push(media);
    });

    return () => {
      cancelled = true;
      mediaElements.forEach((media) => {
        if (media instanceof HTMLImageElement) {
          media.onload = null;
          media.onerror = null;
        } else {
          media.onloadedmetadata = null;
          media.onerror = null;
        }
        media.remove();
      });
    };
  }, [assets, assetDurations, upsertAssetMetadata, persistMetadataToServer]);

  return {
    assets,
    isLoading,
    error,
    transcriptions,
    metadata,
    projectId,
    fetchAssets,
    addAssets,
    renameAsset,
    reorderAssets,
    deleteAsset,
    resolveAssetDuration,
    startTranscription,
  };
}
