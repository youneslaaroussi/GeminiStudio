import { makeProject } from '@motion-canvas/core';
import nle_timeline from './scenes/nle_timeline?scene';

export default makeProject({
  name: 'gemini-studio-scene',
  scenes: [nle_timeline],
  variables: {
    // Video clips on the timeline
    videoClips: [] as Array<{
      id: string;
      type: 'video';
      src: string;
      name: string;
      start: number;
      duration: number;
      offset: number;
      speed: number;
    }>,
    // Audio clips on the timeline
    audioClips: [] as Array<{
      id: string;
      type: 'audio';
      src: string;
      name: string;
      start: number;
      duration: number;
      offset: number;
      speed: number;
      volume: number;
    }>,
    // Text clips on the timeline
    textClips: [] as Array<{
      id: string;
      type: 'text';
      text: string;
      name: string;
      start: number;
      duration: number;
      offset: number;
      speed: number;
      fontSize?: number;
      fill?: string;
      x?: number;
      y?: number;
      opacity?: number;
    }>,
    // Total timeline duration
    duration: 10,
  },
});
