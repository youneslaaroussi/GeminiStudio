import { makeProject } from '@motion-canvas/core';
import nle_timeline from './scenes/nle_timeline?scene';

export default makeProject({
  name: 'gemini-studio-scene',
  experimentalFeatures: true,
  scenes: [nle_timeline],
  variables: {
    layers: [] as Array<{
      id: string;
      name: string;
      type: 'video' | 'audio' | 'text' | 'image' | 'component';
      clips: Array<{
        id: string;
        type: 'video' | 'audio' | 'text' | 'image' | 'component';
        name: string;
        start: number;
        duration: number;
        offset: number;
        speed: number;
        position: { x: number; y: number };
        scale: { x: number; y: number };
        src?: string;
        volume?: number;
        text?: string;
        fontSize?: number;
        fill?: string;
        opacity?: number;
        width?: number;
        height?: number;
        focus?: { x: number; y: number; zoom: number };
        objectFit?: 'contain' | 'cover' | 'fill';
        effect?: string;
        maskAssetId?: string;
        maskSrc?: string;
        maskMode?: 'include' | 'exclude';
        chromaKey?: { color: string; threshold: number; smoothness?: number };
        componentName?: string;
        inputs?: Record<string, string | number | boolean>;
        colorGrading?: {
          exposure: number;
          contrast: number;
          saturation: number;
          temperature: number;
          tint: number;
          highlights: number;
          shadows: number;
        };
      }>;
    }>,
    // Total timeline duration
    duration: 10,
    transcriptions: {} as Record<
      string,
      {
        assetId: string;
        assetUrl: string;
        segments?: { start: number; speech: string }[];
      }
    >,
  },
});
