import { Rect, makeScene2D } from '@motion-canvas/2d';
import { all, createRef, Reference, useScene } from '@motion-canvas/core';
import { AnimatedCaptions, TranscriptionEntry } from '../components/AnimatedCaptions';
import {
  createVideoElements,
  createTextElements,
  createImageElements,
  createAudioElements,
  playVideo,
  playText,
  playImage,
  playAudio,
} from '../lib/clips';
import { normalizeRawSegments, makeTransitionKey } from '../lib/helpers';
import type {
  Layer,
  VideoClip,
  AudioClip,
  TextClip,
  ImageClip,
  ClipTransition,
  SceneTranscription,
  CaptionSettings,
  TextClipSettings,
  VideoEntry,
  TextEntry,
  ImageEntry,
  AudioEntry,
} from '../lib/types';

export default makeScene2D(function* (view) {
  const scene = useScene();
  const { width, height } = scene.getSize();

  // Get variables from the player
  const layers = scene.variables.get<Layer[]>('layers', [])();
  const transitions = scene.variables.get<Record<string, ClipTransition>>('transitions', {})();
  const captionSettings = scene.variables.get<CaptionSettings>('captionSettings', {
    fontFamily: 'Inter Variable',
    fontWeight: 400,
    distanceFromBottom: 140,
  })();
  const textClipSettings = scene.variables.get<TextClipSettings>('textClipSettings', {
    fontFamily: 'Inter Variable',
    fontWeight: 400,
    defaultFontSize: 48,
    defaultFill: '#ffffff',
  })();
  const transcriptionRecords = scene.variables.get<Record<string, SceneTranscription>>('transcriptions', {})();

  // Build transcription lookup maps
  const transcriptionByAssetId = new Map<string, SceneTranscription>();
  const transcriptionByUrl = new Map<string, SceneTranscription>();
  Object.values(transcriptionRecords ?? {}).forEach((record) => {
    if (record?.assetId) transcriptionByAssetId.set(record.assetId, record);
    if (record?.assetUrl) transcriptionByUrl.set(record.assetUrl, record);
  });

  // Pre-process transitions for video clips
  const clipTransitions = new Map<string, { enter?: ClipTransition; exit?: ClipTransition }>();
  for (const layer of layers) {
    if (layer.type !== 'video') continue;
    const clips = (layer.clips as VideoClip[]).sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const prev = clips[i - 1];
      const next = clips[i + 1];
      const entry: { enter?: ClipTransition; exit?: ClipTransition } = {};

      if (prev) {
        const prevEnd = prev.start + prev.duration / (prev.speed || 1);
        if (Math.abs(clip.start - prevEnd) < 0.1) {
          const trans = transitions[makeTransitionKey(prev.id, clip.id)];
          if (trans) entry.enter = trans;
        }
      }
      if (next) {
        const currentEnd = clip.start + clip.duration / (clip.speed || 1);
        if (Math.abs(next.start - currentEnd) < 0.1) {
          const trans = transitions[makeTransitionKey(clip.id, next.id)];
          if (trans) entry.exit = trans;
        }
      }
      clipTransitions.set(clip.id, entry);
    }
  }

  // Caption helpers
  const captionRefs = new Map<string, Reference<AnimatedCaptions>>();
  const clipCaptionData = new Map<string, TranscriptionEntry[]>();

  const normalizeSegmentsForClip = (clip: VideoClip | AudioClip, segments?: TranscriptionEntry[]) => {
    if (!segments?.length) return [];
    const safeSpeed = Math.max(clip.speed ?? 1, 0.0001);
    const offsetSeconds = clip.offset ?? 0;
    const clipSourceEnd = offsetSeconds + clip.duration;

    return segments
      .map((seg) => ({ startSeconds: seg.start / 1000, speech: seg.speech.trim() }))
      .filter(({ startSeconds, speech }) => speech.length > 0 && startSeconds >= offsetSeconds && startSeconds <= clipSourceEnd + 0.05)
      .map(({ startSeconds, speech }) => ({
        start: Math.max(0, ((startSeconds - offsetSeconds) / safeSpeed) * 1000),
        speech,
      }))
      .sort((a, b) => a.start - b.start);
  };

  const registerCaptionForClip = (clip: VideoClip | AudioClip) => {
    const record = (clip.assetId ? transcriptionByAssetId.get(clip.assetId) : undefined) ??
      (clip.src ? transcriptionByUrl.get(clip.src) : undefined);
    if (!record?.segments?.length) return;
    const rawNormalized = normalizeRawSegments(record.segments);
    if (!rawNormalized.length) return;
    const normalized = normalizeSegmentsForClip(clip, rawNormalized);
    if (!normalized.length) return;

    const ref = createRef<AnimatedCaptions>();
    captionRefs.set(clip.id, ref);
    clipCaptionData.set(clip.id, normalized);
    view.add(
      <AnimatedCaptions
        key={`captions-${clip.id}`}
        ref={ref}
        SceneHeight={height}
        SceneWidth={width}
        y={height / 2 - captionSettings.distanceFromBottom}
        CaptionsSize={1.1}
        CaptionsDuration={3}
        ShowCaptions={false}
        TranscriptionData={() => normalized}
        CaptionsFontFamily={captionSettings.fontFamily}
        CaptionsFontWeight={captionSettings.fontWeight}
        zIndex={1000}
      />
    );
  };

  const createCaptionRunner = (clip: VideoClip | AudioClip) => {
    const ref = captionRefs.get(clip.id);
    const data = clipCaptionData.get(clip.id);
    if (!ref || !data?.length) return undefined;
    return function* () {
      const captionNode = ref();
      if (!captionNode) return;
      captionNode.TranscriptionData(data);
      captionNode.ShowCaptions(true);
      yield* captionNode.animate();
      captionNode.ShowCaptions(false);
    };
  };

  // Background
  view.add(<Rect width={'100%'} height={'100%'} fill="#141417" />);

  // Register captions for all video and audio clips
  for (const layer of layers) {
    if (layer.type === 'video') {
      (layer.clips as VideoClip[]).forEach(registerCaptionForClip);
    } else if (layer.type === 'audio') {
      (layer.clips as AudioClip[]).forEach(registerCaptionForClip);
    }
  }

  // Storage for all entries (for playback)
  const videoEntries: VideoEntry[] = [];
  const textEntries: TextEntry[] = [];
  const imageEntries: ImageEntry[] = [];
  const audioEntries: AudioEntry[] = [];

  // UNIFIED LAYER LOOP - respects z-order
  // Layers at index 0 render ON TOP, so iterate in reverse (bottom layers first)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];

    switch (layer.type) {
      case 'video': {
        const entries = createVideoElements({
          clips: layer.clips as VideoClip[],
          view,
          transitions: clipTransitions,
        });
        videoEntries.push(...entries);
        break;
      }
      case 'text': {
        const entries = createTextElements({
          clips: layer.clips as TextClip[],
          view,
          settings: textClipSettings,
          sceneWidth: width,
          sceneHeight: height,
        });
        textEntries.push(...entries);
        break;
      }
      case 'image': {
        const entries = createImageElements({
          clips: layer.clips as ImageClip[],
          view,
        });
        imageEntries.push(...entries);
        break;
      }
      case 'audio': {
        const entries = createAudioElements({
          clips: layer.clips as AudioClip[],
          view,
          sceneWidth: width,
          sceneHeight: height,
        });
        audioEntries.push(...entries);
        break;
      }
    }
  }

  // Playback generators
  function* processVideoClips() {
    if (videoEntries.length === 0) return;
    yield* all(
      ...videoEntries.map((entry) =>
        playVideo({
          entry,
          sceneWidth: width,
          sceneHeight: height,
          transitions: clipTransitions,
          captionRunner: createCaptionRunner(entry.clip),
        })
      )
    );
  }

  function* processTextClips() {
    if (textEntries.length === 0) return;
    yield* all(...textEntries.map((entry) => playText({ entry, sceneWidth: width, sceneHeight: height })));
  }

  function* processImageClips() {
    if (imageEntries.length === 0) return;
    yield* all(...imageEntries.map((entry) => playImage({ entry, sceneWidth: width, sceneHeight: height })));
  }

  function* processAudioTracks() {
    if (audioEntries.length === 0) return;
    yield* all(
      ...audioEntries.map((entry) =>
        playAudio({
          entry,
          captionRunner: createCaptionRunner(entry.clip),
        })
      )
    );
  }

  // Run all tracks in parallel
  yield* all(
    processVideoClips(),
    processAudioTracks(),
    processTextClips(),
    processImageClips()
  );

  // Final cleanup
  videoEntries.forEach(({ ref, maskRef, containerRef }) => {
    const video = ref();
    if (video) video.pause();
    const mask = maskRef?.();
    if (mask) mask.pause();
    const container = containerRef?.();
    if (container) container.opacity(0);
    else if (video) video.opacity(0);
  });
  audioEntries.forEach(({ ref }) => ref()?.pause());
});
