import { Txt, Node, Rect } from '@motion-canvas/2d';
import { createRef, waitFor, type ThreadGenerator } from '@motion-canvas/core';
import type { TextClip, TextEntry, TextClipSettings } from '../types';
import { getEffectShaderConfig } from '../effectShaders';
import { applyEnterTransition, applyExitTransition, getTransitionAdjustedTiming } from './transitions';

interface CreateTextElementsOptions {
  clips: TextClip[];
  view: Node;
  settings: TextClipSettings;
  sceneWidth: number;
  sceneHeight: number;
}

export function createTextElements({ clips, view, settings, sceneWidth, sceneHeight }: CreateTextElementsOptions): TextEntry[] {
  const entries: TextEntry[] = [];

  for (const clip of clips) {
    const template = clip.template ?? 'text';

    switch (template) {
      case 'title-card':
        entries.push(createTitleCard(clip, view, settings, sceneWidth, sceneHeight));
        break;
      case 'lower-third':
        entries.push(createLowerThird(clip, view, settings, sceneWidth, sceneHeight));
        break;
      case 'caption-style':
        entries.push(createCaptionStyle(clip, view, settings));
        break;
      case 'text':
      default:
        entries.push(createBasicText(clip, view, settings));
        break;
    }
  }

  return entries;
}

function createBasicText(clip: TextClip, view: Node, settings: TextClipSettings): TextEntry {
  const ref = createRef<Txt>();
  const fontSize = clip.fontSize ?? settings.defaultFontSize ?? 48;
  const fill = clip.fill ?? settings.defaultFill ?? '#ffffff';
  const effectShaders = getEffectShaderConfig(clip.effect);

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
      shadowBlur={8}
      shadowColor="rgba(0,0,0,0.5)"
    />
  );

  return { clip, ref };
}

function createTitleCard(
  clip: TextClip,
  view: Node,
  settings: TextClipSettings,
  sceneWidth: number,
  sceneHeight: number
): TextEntry {
  const ref = createRef<Txt>();
  const containerRef = createRef<Rect>();
  const fontSize = clip.fontSize ?? 72;
  const fill = clip.fill ?? '#ffffff';
  const backgroundColor = clip.backgroundColor ?? '#1a1a2e';
  const effectShaders = getEffectShaderConfig(clip.effect);

  view.add(
    <Rect
      key={`title-card-container-${clip.id}`}
      ref={containerRef}
      width={sceneWidth}
      height={sceneHeight}
      fill={backgroundColor}
      opacity={0}
    >
      {/* Title text */}
      <Txt
        ref={ref}
        text={clip.text}
        fontFamily={settings.fontFamily}
        fontWeight={700}
        fontSize={fontSize}
        fill={fill}
        y={clip.subtitle ? -30 : 0}
        shaders={effectShaders}
        shadowBlur={20}
        shadowColor="rgba(255,255,255,0.15)"
      />
      {/* Divider line */}
      {clip.subtitle && (
        <Rect
          width={80}
          height={2}
          fill={`${fill}66`}
          y={10}
          radius={1}
        />
      )}
      {/* Subtitle */}
      {clip.subtitle && (
        <Txt
          text={clip.subtitle}
          fontFamily={settings.fontFamily}
          fontWeight={400}
          fontSize={fontSize * 0.4}
          fill={`${fill}99`}
          y={50}
        />
      )}
    </Rect>
  );

  return { clip, ref, containerRef };
}

function createLowerThird(
  clip: TextClip,
  view: Node,
  settings: TextClipSettings,
  _sceneWidth: number,
  sceneHeight: number
): TextEntry {
  const ref = createRef<Txt>();
  const containerRef = createRef<Rect>();
  const fontSize = clip.fontSize ?? 36;
  const fill = clip.fill ?? '#ffffff';
  const backgroundColor = clip.backgroundColor ?? 'rgba(0,0,0,0.85)';
  const effectShaders = getEffectShaderConfig(clip.effect);

  // Position at bottom of screen
  const yPosition = sceneHeight / 2 - 120;

  view.add(
    <Rect
      key={`lower-third-container-${clip.id}`}
      ref={containerRef}
      layout
      direction="row"
      alignItems="stretch"
      gap={0}
      y={yPosition}
      opacity={0}
      shadowBlur={30}
      shadowColor="rgba(0,0,0,0.6)"
    >
      {/* Accent bar on left */}
      <Rect
        width={6}
        fill="#3b82f6"
        radius={[4, 0, 0, 4]}
      />
      {/* Background bar with content */}
      <Rect
        layout
        direction="column"
        alignItems="start"
        padding={[16, 24]}
        fill={backgroundColor}
        radius={[0, 8, 8, 0]}
      >
        {/* Name/Title */}
        <Txt
          ref={ref}
          text={clip.text}
          fontFamily={settings.fontFamily}
          fontWeight={600}
          fontSize={fontSize}
          fill={fill}
          shaders={effectShaders}
        />
        {/* Subtitle */}
        {clip.subtitle && (
          <Txt
            text={clip.subtitle}
            fontFamily={settings.fontFamily}
            fontWeight={400}
            fontSize={fontSize * 0.65}
            fill={`${fill}99`}
            marginTop={4}
          />
        )}
      </Rect>
    </Rect>
  );

  return { clip, ref, containerRef };
}

function createCaptionStyle(clip: TextClip, view: Node, settings: TextClipSettings): TextEntry {
  const ref = createRef<Txt>();
  const containerRef = createRef<Rect>();
  const fontSize = clip.fontSize ?? 32;
  const fill = clip.fill ?? '#ffffff';
  const backgroundColor = clip.backgroundColor ?? 'rgba(0,0,0,0.9)';
  const effectShaders = getEffectShaderConfig(clip.effect);

  view.add(
    <Rect
      key={`caption-style-container-${clip.id}`}
      ref={containerRef}
      layout
      padding={[12, 24]}
      fill={backgroundColor}
      radius={999}
      x={clip.position.x}
      y={clip.position.y}
      scale={clip.scale}
      opacity={0}
      shadowBlur={20}
      shadowColor="rgba(0,0,0,0.5)"
    >
      <Txt
        ref={ref}
        text={clip.text}
        fontFamily={settings.fontFamily}
        fontWeight={settings.fontWeight}
        fontSize={fontSize}
        fill={fill}
        shaders={effectShaders}
      />
    </Rect>
  );

  return { clip, ref, containerRef };
}

interface PlayTextOptions {
  entry: TextEntry;
  sceneWidth: number;
  sceneHeight: number;
}

export function* playText({ entry, sceneWidth, sceneHeight }: PlayTextOptions): ThreadGenerator {
  const { clip, ref, containerRef } = entry;
  const targetOpacity = clip.opacity ?? 1;

  const timing = getTransitionAdjustedTiming(
    clip.start,
    clip.duration,
    clip.speed ?? 1,
    clip.enterTransition,
    clip.exitTransition
  );

  if (timing.startAt > 0) {
    yield* waitFor(timing.startAt);
  }

  // For templates with containers, animate the container
  // For basic text, animate the text directly
  const target = containerRef?.() ?? ref();
  if (!target) return;

  // Enter transition
  yield* applyEnterTransition(target, clip.enterTransition, targetOpacity, sceneWidth, sceneHeight);

  // Main duration
  if (timing.mainDuration > 0) {
    yield* waitFor(timing.mainDuration);
  }

  // Exit transition
  yield* applyExitTransition(target, clip.exitTransition, sceneWidth, sceneHeight);
}
