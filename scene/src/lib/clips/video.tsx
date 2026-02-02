import { Video, Node } from '@motion-canvas/2d';
import { Vector2, createRef, createSignal, waitFor, all, easeOutCubic, easeInCubic, easeInOutCubic, type ThreadGenerator, type SimpleSignal } from '@motion-canvas/core';
import type { VideoClip, VideoEntry, ClipTransition } from '../types';
import { toVector } from '../helpers';
import { getEffectShaderConfig, getColorGradingShaderConfig } from '../effectShaders';
import luminanceToAlpha from '../../shaders/luminanceToAlpha.glsl';
import blurTransition from '../../shaders/blurTransition.glsl';
import zoomTransition from '../../shaders/zoomTransition.glsl';
import crossDissolve from '../../shaders/crossDissolve.glsl';

// Extended entry with shader signals
interface VideoEntryWithSignals extends VideoEntry {
  blurSignal?: SimpleSignal<number>;
  zoomStrengthSignal?: SimpleSignal<number>;
  zoomDirectionSignal?: SimpleSignal<number>;
  dissolveSignal?: SimpleSignal<number>;
  colorGradingContainerRef?: ReturnType<typeof createRef<Node>>;
}

interface CreateVideoElementsOptions {
  clips: VideoClip[];
  view: Node;
  transitions?: Map<string, { enter?: ClipTransition; exit?: ClipTransition }>;
}

export function createVideoElements({ clips, view, transitions }: CreateVideoElementsOptions): VideoEntryWithSignals[] {
  const entries: VideoEntryWithSignals[] = [];

  for (const clip of clips) {
    const ref = createRef<Video>();
    const transInfo = transitions?.get(clip.id);
    const needsBlur = transInfo?.enter?.type === 'blur' || transInfo?.exit?.type === 'blur';
    const needsZoom = transInfo?.enter?.type === 'zoom' || transInfo?.exit?.type === 'zoom';
    const needsDissolve = transInfo?.enter?.type === 'cross-dissolve' || transInfo?.exit?.type === 'cross-dissolve';

    // Create signals for shader uniforms
    const blurSignal = needsBlur ? createSignal(0) : undefined;
    const zoomStrengthSignal = needsZoom ? createSignal(0) : undefined;
    const zoomDirectionSignal = needsZoom ? createSignal(1) : undefined;
    const dissolveSignal = needsDissolve ? createSignal(0) : undefined;

    // Build shader config: visual effect takes precedence over transition
    type ShaderConfig = { fragment: string; uniforms: Record<string, SimpleSignal<number>> };
    let shaders: ShaderConfig | undefined = getEffectShaderConfig(clip.effect);

    if (!shaders) {
      if (needsBlur && blurSignal) {
        shaders = {
          fragment: blurTransition,
          uniforms: { blurAmount: blurSignal },
        };
      } else if (needsZoom && zoomStrengthSignal && zoomDirectionSignal) {
        shaders = {
          fragment: zoomTransition,
          uniforms: {
            zoomStrength: zoomStrengthSignal,
            zoomDirection: zoomDirectionSignal,
          },
        };
      } else if (needsDissolve && dissolveSignal) {
        shaders = {
          fragment: crossDissolve,
          uniforms: { dissolveProgress: dissolveSignal },
        };
      }
    }

    // Check if color grading is needed
    const colorGradingConfig = getColorGradingShaderConfig(clip.colorGrading);
    const colorGradingContainerRef = colorGradingConfig ? createRef<Node>() : undefined;

    if (clip.maskSrc && clip.maskMode) {
      const maskRef = createRef<Video>();
      const containerRef = createRef<Node>();
      const compositeOp = clip.maskMode === 'include' ? 'source-in' : 'source-out';

      entries.push({ clip, ref, maskRef, containerRef, blurSignal, zoomStrengthSignal, zoomDirectionSignal, dissolveSignal, colorGradingContainerRef });

      const maskedContent = (
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
            shaders={shaders}
          />
        </Node>
      );

      // Wrap in color grading node if needed
      if (colorGradingConfig && colorGradingContainerRef) {
        view.add(
          <Node
            key={`color-grading-${clip.id}`}
            ref={colorGradingContainerRef}
            cache
            shaders={{
              fragment: colorGradingConfig.fragment,
              uniforms: colorGradingConfig.uniforms,
            }}
          >
            {maskedContent}
          </Node>
        );
      } else {
        view.add(maskedContent);
      }
    } else {
      entries.push({ clip, ref, blurSignal, zoomStrengthSignal, zoomDirectionSignal, dissolveSignal, colorGradingContainerRef });

      const videoElement = (
        <Video
          key={`video-clip-${clip.id}`}
          ref={ref}
          src={clip.src}
          width={1920}
          height={1080}
          opacity={0}
          position={toVector(clip.position)}
          scale={toVector(clip.scale)}
          shaders={shaders}
        />
      );

      // Wrap in color grading node if needed
      if (colorGradingConfig && colorGradingContainerRef) {
        view.add(
          <Node
            key={`color-grading-${clip.id}`}
            ref={colorGradingContainerRef}
            cache
            shaders={{
              fragment: colorGradingConfig.fragment,
              uniforms: colorGradingConfig.uniforms,
            }}
          >
            {videoElement}
          </Node>
        );
      } else {
        view.add(videoElement);
      }
    }
  }

  return entries;
}

interface PlayVideoOptions {
  entry: VideoEntryWithSignals;
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
  const { clip, ref: videoRef, maskRef, containerRef, blurSignal, zoomStrengthSignal, zoomDirectionSignal, dissolveSignal } = entry;
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
    const fit = clip.objectFit ?? 'contain';
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

    // Set initial state based on enter transition type
    if (enter) {
      switch (enter.type) {
        case 'fade':
        case 'dip-to-black':
          opacityTarget.opacity(0);
          break;
        case 'cross-dissolve':
          opacityTarget.opacity(0);
          dissolveSignal?.(0);
          break;
        case 'zoom':
          opacityTarget.opacity(0);
          scaleTarget.scale(baseScale.mul(0.3)); // Start smaller
          zoomStrengthSignal?.(1);
          zoomDirectionSignal?.(1); // Zoom in
          break;
        case 'blur':
          opacityTarget.opacity(1);
          blurSignal?.(60); // Start very blurry
          break;
        case 'slide-left':
          opacityTarget.opacity(1);
          positionTarget.position(new Vector2(initialPos.x + sceneWidth, initialPos.y));
          break;
        case 'slide-right':
          opacityTarget.opacity(1);
          positionTarget.position(new Vector2(initialPos.x - sceneWidth, initialPos.y));
          break;
        case 'slide-up':
          opacityTarget.opacity(1);
          positionTarget.position(new Vector2(initialPos.x, initialPos.y + sceneHeight));
          break;
        case 'slide-down':
          opacityTarget.opacity(1);
          positionTarget.position(new Vector2(initialPos.x, initialPos.y - sceneHeight));
          break;
        default:
          opacityTarget.opacity(1);
      }
    } else {
      opacityTarget.opacity(1);
    }

    video.play();
    if (maskVideo) {
      maskVideo.play();
    }

    // Enter phase
    if (enter) {
      switch (enter.type) {
        case 'fade':
          yield* opacityTarget.opacity(1, enter.duration);
          break;
        case 'cross-dissolve':
          yield* all(
            opacityTarget.opacity(1, enter.duration, easeInOutCubic),
            dissolveSignal!(1, enter.duration, easeInOutCubic)
          );
          break;
        case 'zoom':
          yield* all(
            opacityTarget.opacity(1, enter.duration * 0.3),
            scaleTarget.scale(baseScale, enter.duration, easeOutCubic),
            zoomStrengthSignal!(0, enter.duration, easeOutCubic)
          );
          break;
        case 'blur':
          yield* blurSignal!(0, enter.duration, easeOutCubic);
          break;
        case 'dip-to-black':
          yield* opacityTarget.opacity(1, enter.duration, easeInCubic);
          break;
        case 'slide-left':
        case 'slide-right':
        case 'slide-up':
        case 'slide-down':
          yield* positionTarget.position(initialPos, enter.duration, easeOutCubic);
          break;
        default:
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
      switch (exit.type) {
        case 'fade':
          yield* opacityTarget.opacity(0, exit.duration);
          break;
        case 'cross-dissolve':
          dissolveSignal?.(0); // Reset to start of dissolve
          yield* all(
            opacityTarget.opacity(0, exit.duration, easeInOutCubic),
            dissolveSignal!(1, exit.duration, easeInOutCubic)
          );
          break;
        case 'zoom':
          zoomDirectionSignal?.(-1); // Zoom out
          yield* all(
            scaleTarget.scale(baseScale.mul(1.8), exit.duration, easeInCubic),
            zoomStrengthSignal!(1, exit.duration, easeInCubic),
            opacityTarget.opacity(0, exit.duration * 0.7, easeInCubic)
          );
          break;
        case 'blur':
          yield* all(
            blurSignal!(60, exit.duration, easeInCubic),
            opacityTarget.opacity(0, exit.duration * 0.8)
          );
          break;
        case 'dip-to-black':
          yield* opacityTarget.opacity(0, exit.duration, easeOutCubic);
          break;
        case 'slide-left':
          yield* positionTarget.position(new Vector2(initialPos.x - sceneWidth, initialPos.y), exit.duration, easeInCubic);
          break;
        case 'slide-right':
          yield* positionTarget.position(new Vector2(initialPos.x + sceneWidth, initialPos.y), exit.duration, easeInCubic);
          break;
        case 'slide-up':
          yield* positionTarget.position(new Vector2(initialPos.x, initialPos.y - sceneHeight), exit.duration, easeInCubic);
          break;
        case 'slide-down':
          yield* positionTarget.position(new Vector2(initialPos.x, initialPos.y + sceneHeight), exit.duration, easeInCubic);
          break;
        default:
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
