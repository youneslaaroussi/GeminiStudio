import { Img, Node } from '@motion-canvas/2d';
import { createRef, waitFor, type ThreadGenerator } from '@motion-canvas/core';
import type { ImageClip, ImageEntry } from '../types';

interface CreateImageElementsOptions {
  clips: ImageClip[];
  view: Node;
}

export function createImageElements({ clips, view }: CreateImageElementsOptions): ImageEntry[] {
  const entries: ImageEntry[] = [];

  for (const clip of clips) {
    const ref = createRef<Img>();
    const imgWidth = clip.width ?? 1920;
    const imgHeight = clip.height ?? 1080;

    entries.push({ clip, ref });

    view.add(
      <Img
        key={`image-clip-${clip.id}`}
        ref={ref}
        src={clip.src}
        width={imgWidth}
        height={imgHeight}
        x={clip.position.x}
        y={clip.position.y}
        scale={clip.scale}
        opacity={0}
      />
    );
  }

  return entries;
}

interface PlayImageOptions {
  entry: ImageEntry;
}

export function* playImage({ entry }: PlayImageOptions): ThreadGenerator {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 0.0001);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;

  if (startAt > 0) {
    yield* waitFor(startAt);
  }

  const image = ref();
  if (!image) return;

  image.opacity(1);
  yield* waitFor(timelineDuration);
  image.opacity(0);
}
