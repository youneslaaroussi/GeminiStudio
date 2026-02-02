"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { RemoteAsset } from "@/app/types/assets";
import { DEFAULT_ASSET_DURATIONS } from "@/app/types/assets";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { toast } from "sonner";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { extractMetadataFromUrl } from "@/app/lib/media/mediabunny";

const TRANSCODE_POLL_MS = 2500;

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  description?: string;
  labels?: string[];
  highlights?: {
    name?: string;
    description?: string;
    searchableText?: string;
  };
}

export function useAssets() {
  const [assets, setAssets] = useState<RemoteAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});
  const [transcodingAssetIds, setTranscodingAssetIds] = useState<Set<string>>(new Set());
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const publishAssets = useAssetsStore((state) => state.setAssets);
  const upsertAssetMetadata = useAssetsStore((state) => state.upsertMetadata);
  const metadata = useAssetsStore((state) => state.metadata);
  const projectId = useProjectStore((s) => s.projectId);
  const transcriptions = useProjectStore((s) => s.project.transcriptions ?? {});

  const assetsRef = useRef<RemoteAsset[]>([]);
  const previousAssetsRef = useRef<RemoteAsset[] | null>(null);

  const fetchAssets = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setIsLoading(true);
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
      const list = data.assets ?? [];
      setAssets((prev) => {
        const prevMap = new Map(prev.map((a) => [a.id, a]));
        return list.map((serverAsset) => {
          const existing = prevMap.get(serverAsset.id);
          if (existing) {
            return {
              ...serverAsset,
              description: serverAsset.description ?? existing.description,
              notes: serverAsset.notes ?? existing.notes,
            };
          }
          return serverAsset;
        });
      });
      setTranscodingAssetIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        prev.forEach((id) => {
          const asset = list.find((a) => a.id === id);
          if (!asset) return;
          const name = asset.name?.toLowerCase() ?? "";
          // Video transcode complete: name ends with .mp4
          // Image convert complete: name ends with .png or mimeType changed to png
          const isTranscodeComplete = name.endsWith(".mp4");
          const isConvertComplete = name.endsWith(".png") || asset.mimeType === "image/png";
          if (isTranscodeComplete || isConvertComplete) {
            next.delete(id);
          }
        });
        return next;
      });
    } catch (err) {
      console.error(err);
      if (!silent) setError(err instanceof Error ? err.message : "Could not load assets");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [projectId]);

  const markAssetsTranscoding = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setTranscodingAssetIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  useEffect(() => {
    if (transcodingAssetIds.size === 0) return;
    const t = setInterval(() => void fetchAssets(true), TRANSCODE_POLL_MS);
    return () => clearInterval(t);
  }, [transcodingAssetIds.size, fetchAssets]);

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

  const updateAssetNotes = useCallback(
    async (assetId: string, notes: string): Promise<boolean> => {
      if (!projectId) {
        toast.error("No project selected");
        return false;
      }
      setAssets((prev) => {
        previousAssetsRef.current = prev;
        return prev.map((a) =>
          a.id === assetId ? { ...a, notes: notes || undefined } : a
        );
      });
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`/api/assets/${assetId}`, window.location.origin);
        url.searchParams.set("projectId", projectId);
        const response = await fetch(url.toString(), {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notes || null }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to update notes");
        }
        previousAssetsRef.current = null;
        return true;
      } catch (err) {
        console.error("Failed to update asset notes", err);
        if (previousAssetsRef.current) {
          setAssets(previousAssetsRef.current);
          previousAssetsRef.current = null;
        }
        toast.error("Failed to update notes", {
          description: err instanceof Error ? err.message : "Unknown error",
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
        // Merge server response with existing assets to preserve local fields like description
        setAssets((prev) => {
          const prevMap = new Map(prev.map((a) => [a.id, a]));
          return (data.assets ?? []).map((serverAsset) => {
            const existing = prevMap.get(serverAsset.id);
            if (existing) {
              return {
                ...serverAsset,
                description: serverAsset.description ?? existing.description,
                notes: serverAsset.notes ?? existing.notes,
              };
            }
            return serverAsset;
          });
        });
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

  const removeClipsByAssetId = useProjectStore((s) => s.removeClipsByAssetId);
  const removeClipsByAssetIds = useProjectStore((s) => s.removeClipsByAssetIds);

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
        // Remove all clips that reference this asset from the timeline
        removeClipsByAssetId(assetId);
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
    [projectId, removeClipsByAssetId]
  );

  const deleteAssets = useCallback(
    async (assetIds: string[]): Promise<void> => {
      if (!projectId) {
        toast.error("No project selected");
        return;
      }
      if (assetIds.length === 0) return;
      const ids = [...assetIds];
      const toRestore = assets.filter((a) => ids.includes(a.id));
      setAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
      try {
        const authHeaders = await getAuthHeaders();
        const results = await Promise.allSettled(
          ids.map(async (assetId) => {
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
          })
        );
        const failedIndices = results
          .map((r, i) => (r.status === "rejected" ? i : -1))
          .filter((i) => i >= 0);
        if (failedIndices.length > 0) {
          const failedIds = new Set(failedIndices.map((i) => ids[i]));
          const restored = toRestore.filter((a) => failedIds.has(a.id));
          setAssets((prev) => [...prev, ...restored]);
          // Remove clips for successfully deleted assets
          const successfulIds = ids.filter((id) => !failedIds.has(id));
          if (successfulIds.length > 0) {
            removeClipsByAssetIds(successfulIds);
          }
          toast.error("Failed to delete some assets", {
            description: `${failedIndices.length} of ${ids.length} could not be deleted`,
          });
        } else {
          // Remove all clips that reference the deleted assets from the timeline
          removeClipsByAssetIds(ids);
          toast.success(
            ids.length === 1 ? "Asset deleted" : `${ids.length} assets deleted`
          );
        }
      } catch (err) {
        setAssets((prev) => [...prev, ...toRestore]);
        toast.error("Failed to delete assets", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [projectId, assets, removeClipsByAssetIds]
  );

  const resolveAssetDuration = useCallback(
    (asset: RemoteAsset) =>
      assetDurations[asset.id] ?? DEFAULT_ASSET_DURATIONS[asset.type] ?? 5,
    [assetDurations]
  );

  // Search assets
  const searchAssets = useCallback(
    async (query: string): Promise<void> => {
      if (!projectId) return;
      
      const trimmed = query.trim();
      setSearchQuery(trimmed);
      
      if (!trimmed) {
        setSearchResults(null);
        return;
      }
      
      setIsSearching(true);
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL("/api/assets/search", window.location.origin);
        url.searchParams.set("projectId", projectId);
        
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, limit: 50 }),
        });
        
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Search failed");
        }
        
        const data = await response.json();
        setSearchResults(data.hits || []);
      } catch (err) {
        console.error("Search failed:", err);
        toast.error("Search failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    },
    [projectId]
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults(null);
  }, []);

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
    const abortController = new AbortController();

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

    // Process assets using mediabunny for metadata extraction
    const processAssets = async () => {
      for (const asset of assetsMissingMetadata) {
        if (cancelled) break;

        const defaultDuration =
          DEFAULT_ASSET_DURATIONS[asset.type] ?? DEFAULT_ASSET_DURATIONS.other;
        const hasServerDimensions = asset.width != null && asset.height != null;

        // For images, use default duration and only extract dimensions if needed
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
            continue;
          }
        }

        try {
          // Use mediabunny to extract metadata
          const mediaType = asset.type === "other" ? "video" : asset.type;
          const metadata = await extractMetadataFromUrl(asset.url, mediaType);
          
          if (cancelled) break;

          const duration =
            metadata.duration != null && metadata.duration > 0
              ? metadata.duration
              : defaultDuration;

          setAssetDurations((prev) => {
            if (prev[asset.id] && prev[asset.id] === duration) return prev;
            return { ...prev, [asset.id]: duration };
          });

          const width = metadata.width;
          const height = metadata.height;

          upsertAssetMetadata(asset.id, { duration, width, height });

          // Persist to server if we extracted new information
          if (!hasServerDimensions && (width || height || duration !== defaultDuration)) {
            void persistMetadataToServer(asset.id, { width, height, duration });
          }
        } catch (err) {
          if (cancelled) break;
          console.warn(`Failed to extract metadata for asset ${asset.id}:`, err);
          
          // Fall back to default duration on error
          setAssetDurations((prev) => {
            if (prev[asset.id] != null) return prev;
            return { ...prev, [asset.id]: defaultDuration };
          });
          upsertAssetMetadata(asset.id, { duration: defaultDuration });
        }
      }
    };

    void processAssets();

    return () => {
      cancelled = true;
      abortController.abort();
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
    updateAssetNotes,
    reorderAssets,
    deleteAsset,
    deleteAssets,
    resolveAssetDuration,
    startTranscription,
    transcodingAssetIds,
    markAssetsTranscoding,
    // Search
    searchQuery,
    searchResults,
    isSearching,
    searchAssets,
    clearSearch,
  };
}
