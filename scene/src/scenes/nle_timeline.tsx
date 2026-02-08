import { Rect, makeScene2D } from '@motion-canvas/2d';
import { all, createRef, createSignal, useScene } from '@motion-canvas/core';
import { AnimatedCaptions, TranscriptionEntry } from '../components/AnimatedCaptions';
import {
  createVideoElements,
  createTextElements,
  createImageElements,
  createAudioElements,
  createComponentElements,
  playVideo,
  playText,
  playImage,
  playAudio,
  playComponent,
} from '../lib/clips';
import { normalizeRawSegments, makeTransitionKey } from '../lib/helpers';
import type {
  Layer,
  VideoClip,
  AudioClip,
  TextClip,
  ImageClip,
  ComponentClip,
  ClipTransition,
  SceneTranscription,
  CaptionSettings,
  TextClipSettings,
  VideoEntry,
  TextEntry,
  ImageEntry,
  AudioEntry,
  ComponentEntry,
} from '../lib/types';

// --- Register custom components ---
// The scene-compiler generates src/components/custom/index.ts which imports
// and registers all custom components. During development, we import it here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import '../components/custom';

export default makeScene2D(function* (view) {
  const scene = useScene();
  const { width, height } = scene.getSize();

  const defaultCaptionSettings: CaptionSettings = {
    fontFamily: 'Inter Variable',
    fontWeight: 400,
    fontSize: 18,
    distanceFromBottom: 140,
    style: 'pill',
  };

  // Get variables from the player (read once for layout; style read reactively below)
  const layers = scene.variables.get<Layer[]>('layers', [])();
  const transitions = scene.variables.get<Record<string, ClipTransition>>('transitions', {})();
  const captionSettings = scene.variables.get<CaptionSettings>('captionSettings', defaultCaptionSettings)();
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
      // Use clip’s own enter/exit transitions when no between-clips transition is set (same as images)
      if (!entry.enter && clip.enterTransition && clip.enterTransition.type !== 'none') {
        entry.enter = clip.enterTransition;
      }
      if (!entry.exit && clip.exitTransition && clip.exitTransition.type !== 'none') {
        entry.exit = clip.exitTransition;
      }
      clipTransitions.set(clip.id, entry);
    }
  }

  // Caption helpers: single shared caption; prefer next clip (take over immediately to avoid desync)
  const sharedCaptionRef = createRef<AnimatedCaptions>();
  const currentCaptionData = createSignal<TranscriptionEntry[]>([]);
  const activeCaptionClipId = createSignal<string | null>(null);
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
    clipCaptionData.set(clip.id, normalized);
  };

  const createCaptionRunner = (clip: VideoClip | AudioClip) => {
    const data = clipCaptionData.get(clip.id);
    if (!data?.length) return undefined;
    const clipId = clip.id;
    return function* () {
      // Prefer next: take over immediately so captions stay in sync (don't wait for previous to finish)
      activeCaptionClipId(clipId);
      currentCaptionData(data);
      const captionNode = sharedCaptionRef();
      if (captionNode) {
        captionNode.ShowCaptions(true);
        yield* captionNode.animate(() => activeCaptionClipId() === clipId);
        if (activeCaptionClipId() === clipId) {
          captionNode.ShowCaptions(false);
        }
      }
      if (activeCaptionClipId() === clipId) {
        activeCaptionClipId(null);
      }
    };
  };

  // Background
  view.add(<Rect width={'100%'} height={'100%'} fill="#141417" />);

  // Register captions for all video and audio clips (data only; one shared caption component below)
  for (const layer of layers) {
    if (layer.type === 'video') {
      (layer.clips as VideoClip[]).forEach(registerCaptionForClip);
    } else if (layer.type === 'audio') {
      (layer.clips as AudioClip[]).forEach(registerCaptionForClip);
    }
  }

  // Single shared caption component — only one video/audio caption visible at a time
  if (clipCaptionData.size > 0) {
    view.add(
      <AnimatedCaptions
        key="scene-captions"
        ref={sharedCaptionRef}
        SceneHeight={height}
        SceneWidth={width}
        y={height / 2 - captionSettings.distanceFromBottom}
        CaptionsSize={1.1}
        CaptionsDuration={3}
        ShowCaptions={false}
        TranscriptionData={() => currentCaptionData()}
        CaptionsFontFamily={captionSettings.fontFamily}
        CaptionsFontWeight={captionSettings.fontWeight}
        CaptionsFontSize={() => scene.variables.get<CaptionSettings>('captionSettings', defaultCaptionSettings)().fontSize ?? 18}
        CaptionsStyle={() => scene.variables.get<CaptionSettings>('captionSettings', defaultCaptionSettings)().style ?? 'pill'}
        zIndex={1000}
      />
    );
  }

  // Storage for all entries (for playback)
  const videoEntries: VideoEntry[] = [];
  const textEntries: TextEntry[] = [];
  const imageEntries: ImageEntry[] = [];
  const audioEntries: AudioEntry[] = [];
  const componentEntries: ComponentEntry[] = [];

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
      case 'component': {
        const entries = createComponentElements({
          clips: layer.clips as ComponentClip[],
          view,
        });
        componentEntries.push(...entries);
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

  function* processComponentClips() {
    if (componentEntries.length === 0) return;
    yield* all(
      ...componentEntries.map((entry) =>
        playComponent({ entry, sceneWidth: width, sceneHeight: height })
      )
    );
  }

  // Pause all video/audio at scene start so that after a project reset or seek-to-zero
  // no media keeps playing (the generator may be aborted before "Final cleanup" runs).
  // Yield once so refs are populated after view.add().
  yield;
  videoEntries.forEach(({ ref, maskRef }) => {
    ref()?.pause();
    maskRef?.()?.pause();
  });
  audioEntries.forEach(({ ref }) => ref()?.pause());

  // Run all tracks in parallel
  yield* all(
    processVideoClips(),
    processAudioTracks(),
    processTextClips(),
    processImageClips(),
    processComponentClips(),
  );

  // Final cleanup (runs when playback completes normally; start-of-scene pause handles reset)
  videoEntries.forEach(({ ref, maskRef, containerRef }) => {
    const video = ref();
    if (video) {
      video.pause();
      video.opacity(0);
    }
    const mask = maskRef?.();
    if (mask) mask.pause();
    const container = containerRef?.();
    if (container) container.opacity(0);
  });
  audioEntries.forEach(({ ref }) => ref()?.pause());
});
