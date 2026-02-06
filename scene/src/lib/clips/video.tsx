import { Video, Node, Rect } from '@motion-canvas/2d';
import { Vector2, createRef, createSignal, waitFor, all, easeOutCubic, easeInCubic, easeInOutCubic, type ThreadGenerator, type SimpleSignal } from '@motion-canvas/core';
import type { VideoClip, VideoEntry, ClipTransition } from '../types';
import { toVector } from '../helpers';
import { getEffectShaderConfig, getColorGradingShaderConfig, getChromaKeyShaderConfig } from '../effectShaders';
import { applyClipAnimation } from './animations';
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
  /** Clipping container for focus/zoom (video scales inside, container clips at scene bounds) */
  focusContainerRef?: ReturnType<typeof createRef<Rect>>;
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

    // Build shader config: chroma key takes precedence, then visual effect, then transition
    type ShaderConfig = { fragment: string; uniforms: Record<string, SimpleSignal<number>> };
    let shaders: ShaderConfig | undefined = getChromaKeyShaderConfig(clip.chromaKey);
    if (!shaders) {
      shaders = getEffectShaderConfig(clip.effect);
    }
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
            {...(shaders ? { shaders } : {})}
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
      // Create focus container for clips with zoom/focus (clips content to scene bounds)
      const hasFocus = !!(clip.focus && clip.focus.zoom >= 1);
      const focusContainerRef = hasFocus ? createRef<Rect>() : undefined;

      entries.push({ clip, ref, blurSignal, zoomStrengthSignal, zoomDirectionSignal, dissolveSignal, colorGradingContainerRef, focusContainerRef });

      // When using focus container: video starts at origin with unit scale, 
      // container handles position/scale. Otherwise video handles them directly.
      // NOTE: The `video-clip-${clip.id}` key goes on whichever element should receive
      // hit detection - the container when focused, the video otherwise.
      const videoElement = (
        <Video
          key={hasFocus ? `video-inner-${clip.id}` : `video-clip-${clip.id}`}
          ref={ref}
          src={clip.src}
          width={1920}
          height={1080}
          opacity={hasFocus ? 1 : 0}
          position={hasFocus ? undefined : toVector(clip.position)}
          scale={hasFocus ? undefined : toVector(clip.scale)}
          {...(shaders ? { shaders } : {})}
        />
      );

      // Wrap in focus container if clip has focus/zoom (clips content to bounds)
      // The container gets the `video-clip-${clip.id}` key for hit detection
      let wrappedElement = videoElement;
      if (focusContainerRef) {
        wrappedElement = (
          <Rect
            key={`video-clip-${clip.id}`}
            ref={focusContainerRef}
            clip
            position={toVector(clip.position)}
            scale={toVector(clip.scale)}
            opacity={0}
          >
            {videoElement}
          </Rect>
        );
      }

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
            {wrappedElement}
          </Node>
        );
      } else {
        view.add(wrappedElement);
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
  const { clip, ref: videoRef, maskRef, containerRef, blurSignal, zoomStrengthSignal, zoomDirectionSignal, dissolveSignal, focusContainerRef } = entry;
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
  const focusContainer = focusContainerRef?.();
  const isMaskedClip = !!(maskVideo && container);
  const hasFocusContainer = !!(focusContainer && clip.focus);

  const playback = function* () {
    const safeOffset = Math.max(0, offset);
    video.seek(safeOffset);
    video.playbackRate(safeSpeed);

    try {
      const htmlVideo = (video as any).video() as HTMLVideoElement | undefined;
      if (htmlVideo) {
        const trackVolume = Math.min(Math.max(clip.audioVolume ?? 1, 0), 1);
        htmlVideo.volume = trackVolume;
      }
    } catch {
      // ignore volume errors
    }

    if (maskVideo) {
      maskVideo.seek(safeOffset);
      maskVideo.playbackRate(safeSpeed);
    }

    // Calculate dimensions based on objectFit
    // - 'fill': stretch to scene dimensions (distorts aspect ratio)
    // - 'contain': fit within scene maintaining aspect ratio (letterboxing)
    // - 'cover': cover scene maintaining aspect ratio (cropping)
    const fit = clip.objectFit ?? 'contain';
    
    // Get source dimensions: prefer clip metadata, fallback to video element, then default
    const domVideo = (video as any).video() as HTMLVideoElement | undefined;
    const srcW = clip.width || domVideo?.videoWidth || 1920;
    const srcH = clip.height || domVideo?.videoHeight || 1080;
    
    // Calculate target dimensions based on fit mode
    let vidW = sceneWidth;
    let vidH = sceneHeight;

    if (fit === 'fill') {
      // Stretch to fill - use scene dimensions directly (may distort)
      vidW = sceneWidth;
      vidH = sceneHeight;
    } else if (srcW > 0 && srcH > 0) {
      // We have source dimensions - calculate proper fit
      const srcRatio = srcW / srcH;
      const sceneRatio = sceneWidth / sceneHeight;

      if (fit === 'contain') {
        // Fit within scene (smaller scale wins)
        if (srcRatio > sceneRatio) {
          // Source is wider - fit to scene width
          vidW = sceneWidth;
          vidH = sceneWidth / srcRatio;
        } else {
          // Source is taller - fit to scene height
          vidH = sceneHeight;
          vidW = sceneHeight * srcRatio;
        }
      } else if (fit === 'cover') {
        // Cover scene (larger scale wins)
        if (srcRatio > sceneRatio) {
          // Source is wider - fit to scene height (overflow width)
          vidH = sceneHeight;
          vidW = sceneHeight * srcRatio;
        } else {
          // Source is taller - fit to scene width (overflow height)
          vidW = sceneWidth;
          vidH = sceneWidth / srcRatio;
        }
      }
    }
    // else: no source dimensions available, use scene dimensions as fallback

    video.width(vidW);
    video.height(vidH);

    if (maskVideo) {
      maskVideo.width(vidW);
      maskVideo.height(vidH);
    }

    // Calculate focus/zoom transforms (center 0–1, zoom ratio >= 1)
    // When focus container exists, video scales inside a clipped container
    let baseScale = toVector(clip.scale);
    let basePos = toVector(clip.position);
    let videoInnerScale = new Vector2(1, 1);
    let videoInnerPos = new Vector2(0, 0);

    if (hasFocusContainer && clip.focus && clip.focus.zoom >= 1) {
      const { x, y, zoom } = clip.focus;
      const zoomFactor = Math.max(1, zoom);

      // Clamp focus x,y so visible area stays within video bounds
      // Valid range: [0.5/zoom, 1 - 0.5/zoom]
      const margin = 0.5 / zoomFactor;
      const clampedX = Math.max(margin, Math.min(1 - margin, x));
      const clampedY = Math.max(margin, Math.min(1 - margin, y));

      // Set up the clipping container at the calculated video size
      focusContainer.size([vidW, vidH]);

      // Video scales inside the container by zoom factor
      videoInnerScale = new Vector2(zoomFactor, zoomFactor);

      // Offset video so the focus center appears at container center
      const cx = clampedX * vidW;
      const cy = clampedY * vidH;
      const fvx = cx - vidW / 2;
      const fvy = cy - vidH / 2;
      videoInnerPos = new Vector2(-fvx * zoomFactor, -fvy * zoomFactor);

      // Video position/scale relative to container (inner)
      video.position(videoInnerPos);
      video.scale(videoInnerScale);
    } else if (clip.focus && clip.focus.zoom >= 1) {
      // Fallback: no focus container, apply zoom directly (may overflow)
      const { x, y, zoom } = clip.focus;
      const zoomFactor = Math.max(1, zoom);

      // Clamp focus x,y so visible area stays within video bounds
      const margin = 0.5 / zoomFactor;
      const clampedX = Math.max(margin, Math.min(1 - margin, x));
      const clampedY = Math.max(margin, Math.min(1 - margin, y));

      baseScale = baseScale.mul(zoomFactor);

      const cx = clampedX * vidW;
      const cy = clampedY * vidH;
      const fvx = cx - vidW / 2;
      const fvy = cy - vidH / 2;
      const focusOffset = new Vector2(fvx, fvy);
      basePos = basePos.sub(focusOffset.mul(baseScale));
    }

    // Determine targets: focus container wraps the video when present
    const opacityTarget = hasFocusContainer ? focusContainer : (isMaskedClip ? container : video);
    const positionTarget = hasFocusContainer ? focusContainer : (isMaskedClip ? container : video);
    const scaleTarget = hasFocusContainer ? focusContainer : (isMaskedClip ? container : video);

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

    // Main phase (with optional idle animation: hover, pulse, float, glow)
    const mainDuration = timelineDuration - (enter ? enter.duration : 0) - (exit ? exit.duration : 0);
    if (mainDuration > 0) {
      if (clip.animation && clip.animation !== 'none') {
        yield* all(
          waitFor(mainDuration),
          applyClipAnimation(scaleTarget, clip.animation, mainDuration, clip.animationIntensity)
        );
      } else {
        yield* waitFor(mainDuration);
      }
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
