import { Txt, Node } from '@motion-canvas/2d';
import { createRef, waitFor, type ThreadGenerator } from '@motion-canvas/core';
import type { TextClip, TextEntry, TextClipSettings } from '../types';
import { getEffectShaderConfig } from '../effectShaders';

interface CreateTextElementsOptions {
  clips: TextClip[];
  view: Node;
  settings: TextClipSettings;
}

export function createTextElements({ clips, view, settings }: CreateTextElementsOptions): TextEntry[] {
  const entries: TextEntry[] = [];

  for (const clip of clips) {
    const ref = createRef<Txt>();
    const fontSize = clip.fontSize ?? settings.defaultFontSize ?? 48;
    const fill = clip.fill ?? settings.defaultFill ?? '#ffffff';
    const effectShaders = getEffectShaderConfig(clip.effect);

    entries.push({ clip, ref });

    view.add(
      <Txt
        key={`text-clip-${clip.id}`}
        ref={ref}
        text={clip.text}
        fontFamily={settings.fontFamily}
        fontWeight={settings.fontWeight}
        fontSize={fontSize}
        fill={fill}
        x={clip.position.x}
        y={clip.position.y}
        scale={clip.scale}
        opacity={0}
        shaders={effectShaders}
      />
    );
  }

  return entries;
}

interface PlayTextOptions {
  entry: TextEntry;
}

export function* playText({ entry }: PlayTextOptions): ThreadGenerator {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 0.0001);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;

  if (startAt > 0) {
    yield* waitFor(startAt);
  }

  const text = ref();
  if (!text) return;

  text.opacity(clip.opacity ?? 1);
  yield* waitFor(timelineDuration);
  text.opacity(0);
}
