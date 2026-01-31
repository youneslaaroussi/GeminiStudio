import { Video, Node } from '@motion-canvas/2d';
import { createRef, waitFor, all, type ThreadGenerator } from '@motion-canvas/core';
import type { AudioClip, AudioEntry } from '../types';

interface CreateAudioElementsOptions {
  clips: AudioClip[];
  view: Node;
  sceneWidth: number;
  sceneHeight: number;
}

export function createAudioElements({ clips, view, sceneWidth, sceneHeight }: CreateAudioElementsOptions): AudioEntry[] {
  const entries: AudioEntry[] = [];

  for (const clip of clips) {
    const ref = createRef<Video>();
    entries.push({ clip, ref });

    // 1px video positioned at bottom right corner (invisible)
    view.add(
      <Video
        ref={ref}
        src={clip.src}
        width={1}
        height={1}
        x={sceneWidth / 2 - 0.5}
        y={sceneHeight / 2 - 0.5}
      />
    );
  }

  return entries;
}

interface PlayAudioOptions {
  entry: AudioEntry;
  captionRunner?: () => ThreadGenerator;
}

export function* playAudio({ entry, captionRunner }: PlayAudioOptions): ThreadGenerator {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 0.0001);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;

  if (startAt > 0) {
    yield* waitFor(startAt);
  }

  const video = ref();
  if (!video) return;

  const playback = function* () {
    video.seek(clip.offset);
    video.playbackRate(safeSpeed);

    try {
      const htmlVideo = (video as any).video() as HTMLVideoElement | undefined;
      if (htmlVideo) {
        const trackVolume = Math.min(Math.max(clip.volume ?? 1, 0), 1);
        htmlVideo.volume = trackVolume;
      }
    } catch {
      // ignore volume errors
    }

    video.play();
    yield* waitFor(timelineDuration);
    video.pause();
  };

  if (captionRunner) {
    yield* all(playback(), captionRunner());
  } else {
    yield* playback();
  }
}
