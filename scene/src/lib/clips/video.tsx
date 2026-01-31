import { Video, Node } from '@motion-canvas/2d';
import { Vector2, createRef, waitFor, all, type ThreadGenerator } from '@motion-canvas/core';
import type { VideoClip, VideoEntry, ClipTransition } from '../types';
import { toVector } from '../helpers';
import luminanceToAlpha from '../../shaders/luminanceToAlpha.glsl';

interface CreateVideoElementsOptions {
  clips: VideoClip[];
  view: Node;
}

export function createVideoElements({ clips, view }: CreateVideoElementsOptions): VideoEntry[] {
  const entries: VideoEntry[] = [];

  for (const clip of clips) {
    const ref = createRef<Video>();

    if (clip.maskSrc && clip.maskMode) {
      const maskRef = createRef<Video>();
      const containerRef = createRef<Node>();
      const compositeOp = clip.maskMode === 'include' ? 'source-in' : 'source-out';

      entries.push({ clip, ref, maskRef, containerRef });

      view.add(
        <Node
          key={`masked-container-${clip.id}`}
          ref={containerRef}
          cache
          position={toVector(clip.position)}
          scale={toVector(clip.scale)}
          opacity={0}
        >
          <Video
            key={`mask-${clip.id}`}
            ref={maskRef}
            src={clip.maskSrc}
            width={1920}
            height={1080}
            cache
            shaders={{
              fragment: luminanceToAlpha,
              uniforms: {},
            }}
          />
          <Video
            key={`video-clip-${clip.id}`}
            ref={ref}
            src={clip.src}
            width={1920}
            height={1080}
            compositeOperation={compositeOp}
          />
        </Node>
      );
    } else {
      entries.push({ clip, ref });
      view.add(
        <Video
          key={`video-clip-${clip.id}`}
          ref={ref}
          src={clip.src}
          width={1920}
          height={1080}
          opacity={0}
          position={toVector(clip.position)}
          scale={toVector(clip.scale)}
        />
      );
    }
  }

  return entries;
}

interface PlayVideoOptions {
  entry: VideoEntry;
  sceneWidth: number;
  sceneHeight: number;
  transitions: Map<string, { enter?: ClipTransition; exit?: ClipTransition }>;
  captionRunner?: () => ThreadGenerator;
}

export function* playVideo({
  entry,
  sceneWidth,
  sceneHeight,
  transitions,
  captionRunner,
}: PlayVideoOptions): ThreadGenerator {
  const { clip, ref: videoRef, maskRef, containerRef } = entry;
  const transInfo = transitions.get(clip.id);
  const enter = transInfo?.enter;
  const exit = transInfo?.exit;

  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 0.0001);

  let startAt = clip.start;
  let timelineDuration = clip.duration / safeSpeed;
  let offset = clip.offset;

  if (enter) {
    startAt -= enter.duration / 2;
    timelineDuration += enter.duration / 2;
    offset -= (enter.duration / 2) * safeSpeed;
  }
  if (exit) {
    timelineDuration += exit.duration / 2;
  }

  const waitTime = Math.max(startAt, 0);
  if (waitTime > 0) {
    yield* waitFor(waitTime);
  }

  const video = videoRef();
  if (!video) return;

  const maskVideo = maskRef?.();
  const container = containerRef?.();
  const isMaskedClip = !!(maskVideo && container);

  const playback = function* () {
    const safeOffset = Math.max(0, offset);
    video.seek(safeOffset);
    video.playbackRate(safeSpeed);

    if (maskVideo) {
      maskVideo.seek(safeOffset);
      maskVideo.playbackRate(safeSpeed);
    }

    // Calculate dimensions based on objectFit
    const fit = clip.objectFit ?? 'fill';
    let vidW = sceneWidth;
    let vidH = sceneHeight;

    if (fit !== 'fill') {
      const domVideo = (video as any).video() as HTMLVideoElement | undefined;
      const srcW = domVideo?.videoWidth || 1920;
      const srcH = domVideo?.videoHeight || 1080;

      if (srcW > 0 && srcH > 0) {
        const srcRatio = srcW / srcH;
        const sceneRatio = sceneWidth / sceneHeight;

        if (fit === 'contain') {
          if (srcRatio > sceneRatio) {
            vidW = sceneWidth;
            vidH = sceneWidth / srcRatio;
          } else {
            vidH = sceneHeight;
            vidW = sceneHeight * srcRatio;
          }
        } else if (fit === 'cover') {
          if (srcRatio > sceneRatio) {
            vidH = sceneHeight;
            vidW = sceneHeight * srcRatio;
          } else {
            vidW = sceneWidth;
            vidH = sceneWidth / srcRatio;
          }
        }
      }
    }

    video.width(vidW);
    video.height(vidH);

    if (maskVideo) {
      maskVideo.width(vidW);
      maskVideo.height(vidH);
    }

    // Calculate focus transforms
    let baseScale = toVector(clip.scale);
    let basePos = toVector(clip.position);

    if (clip.focus) {
      const { x, y, width: fw, height: fh, padding } = clip.focus;
      const sX = vidW / Math.max(1, fw + padding * 2);
      const sY = vidH / Math.max(1, fh + padding * 2);
      const s = Math.min(sX, sY);

      baseScale = baseScale.mul(s);

      const fvx = (x + fw / 2) - vidW / 2;
      const fvy = (y + fh / 2) - vidH / 2;
      const focusOffset = new Vector2(fvx, fvy);

      basePos = basePos.sub(focusOffset.mul(baseScale));
    }

    const opacityTarget = isMaskedClip ? container : video;
    const positionTarget = isMaskedClip ? container : video;
    const scaleTarget = isMaskedClip ? container : video;

    const initialPos = basePos;
    positionTarget.position(initialPos);
    scaleTarget.scale(baseScale);

    if (enter && enter.type === 'fade') {
      opacityTarget.opacity(0);
    } else {
      opacityTarget.opacity(1);
    }

    if (enter && enter.type.startsWith('slide')) {
      let startPos = initialPos;
      if (enter.type === 'slide-left') startPos = new Vector2(initialPos.x + sceneWidth, initialPos.y);
      else if (enter.type === 'slide-right') startPos = new Vector2(initialPos.x - sceneWidth, initialPos.y);
      else if (enter.type === 'slide-up') startPos = new Vector2(initialPos.x, initialPos.y + sceneHeight);
      else if (enter.type === 'slide-down') startPos = new Vector2(initialPos.x, initialPos.y - sceneHeight);
      positionTarget.position(startPos);
    }

    video.play();
    if (maskVideo) {
      maskVideo.play();
    }

    // Enter phase
    if (enter) {
      if (enter.type === 'fade') {
        yield* opacityTarget.opacity(1, enter.duration);
      } else if (enter.type.startsWith('slide')) {
        yield* positionTarget.position(initialPos, enter.duration);
      } else {
        yield* waitFor(enter.duration);
      }
    }

    // Main phase
    const mainDuration = timelineDuration - (enter ? enter.duration : 0) - (exit ? exit.duration : 0);
    if (mainDuration > 0) {
      yield* waitFor(mainDuration);
    }

    // Exit phase
    if (exit) {
      if (exit.type === 'fade') {
        yield* opacityTarget.opacity(0, exit.duration);
      } else if (exit.type.startsWith('slide')) {
        let endPos = initialPos;
        if (exit.type === 'slide-left') endPos = new Vector2(initialPos.x - sceneWidth, initialPos.y);
        else if (exit.type === 'slide-right') endPos = new Vector2(initialPos.x + sceneWidth, initialPos.y);
        else if (exit.type === 'slide-up') endPos = new Vector2(initialPos.x, initialPos.y - sceneHeight);
        else if (exit.type === 'slide-down') endPos = new Vector2(initialPos.x, initialPos.y + sceneHeight);
        yield* positionTarget.position(endPos, exit.duration);
      } else {
        yield* waitFor(exit.duration);
      }
    }

    opacityTarget.opacity(0);
    video.pause();
    if (maskVideo) {
      maskVideo.pause();
    }
  };

  if (captionRunner) {
    yield* all(playback(), captionRunner());
  } else {
    yield* playback();
  }
}
