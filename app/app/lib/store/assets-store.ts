import { create } from "zustand";
import type { RemoteAsset } from "@/app/types/assets";

export interface AssetMetadata {
  duration?: number;
  width?: number;
  height?: number;
}

interface AssetsState {
  assets: RemoteAsset[];
  metadata: Record<string, AssetMetadata>;
  setAssets: (assets: RemoteAsset[]) => void;
  getAssetById: (id: string) => RemoteAsset | undefined;
  findByName: (name: string) => RemoteAsset | undefined;
  upsertMetadata: (assetId: string, metadata: AssetMetadata) => void;
}

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: [],
  metadata: {},
  setAssets: (assets) => set({ assets }),
  getAssetById: (id) => get().assets.find((asset) => asset.id === id),
  findByName: (name) =>
    get()
      .assets.find(
        (asset) => asset.name.trim().toLowerCase() === name.trim().toLowerCase()
      ),
  upsertMetadata: (assetId, metadata) =>
    set((state) => ({
      metadata: {
        ...state.metadata,
        [assetId]: {
          ...state.metadata[assetId],
          ...metadata,
        },
      },
    })),
}));
