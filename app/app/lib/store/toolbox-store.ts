import { create } from "zustand";
import type { AssetType } from "@/app/types/assets";

export interface CapturedAsset {
  id: string;
  name: string;
  assetId: string;
  assetType: AssetType;
  assetUrl: string;
  timecode: number;
  notes?: string;
  createdAt: number;
}

interface ToolboxState {
  capturedAssets: CapturedAsset[];
  addCapturedAsset: (asset: {
    name: string;
    assetId: string;
    assetType: AssetType;
    assetUrl: string;
    timecode: number;
    notes?: string;
  }) => CapturedAsset;
  clearAssets: () => void;
}

export const useToolboxStore = create<ToolboxState>((set) => ({
  capturedAssets: [],
  addCapturedAsset: ({ name, assetId, assetType, assetUrl, timecode, notes }) => {
    const entry: CapturedAsset = {
      id: crypto.randomUUID(),
      name,
      assetId,
      assetType,
      assetUrl,
      timecode,
      notes,
      createdAt: Date.now(),
    };
    set((state) => ({
      capturedAssets: [entry, ...state.capturedAssets],
    }));
    return entry;
  },
  clearAssets: () => set({ capturedAssets: [] }),
}));
