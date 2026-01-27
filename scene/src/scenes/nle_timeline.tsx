import { Video, Rect, Txt, Img, makeScene2D } from '@motion-canvas/2d';
import { Vector2, all, createRef, Reference, useScene, waitFor } from '@motion-canvas/core';
import { AnimatedCaptions, TranscriptionEntry } from '../components/AnimatedCaptions';

// Type definitions matching the app's types
interface Transform {
  x: number;
  y: number;
}

interface Focus {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
}

interface VideoClip {
  id: string;
  type: 'video';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  position: Transform;
  scale: Transform;
  focus?: Focus;
  objectFit?: 'contain' | 'cover' | 'fill';
}

interface AudioClip {
  id: string;
  type: 'audio';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  volume: number;
  position: Transform;
  scale: Transform;
}

interface TextClip {
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
  opacity?: number;
  position: Transform;
  scale: Transform;
}

interface ImageClip {
  id: string;
  type: 'image';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  width?: number;
  height?: number;
  position: Transform;
  scale: Transform;
}

interface ClipTransition {
  type: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';
  duration: number;
}

type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

interface Layer {
  id: string;
  name: string;
  type: TimelineClip['type'];
  clips: TimelineClip[];
}

interface SceneTranscription {
  assetId: string;
  assetUrl: string;
  segments?: TranscriptionEntry[];
}

const toVector = (transform: Transform) => new Vector2(transform.x, transform.y);

export default makeScene2D(function* (view) {
  const scene = useScene();

  // Get scene dimensions
  const { width, height } = scene.getSize();

  // Get variables from the player
  const layers = scene.variables.get<Layer[]>('layers', [])();
  scene.variables.get<number>('duration', 10)();
  const transitions = scene.variables.get<Record<string, ClipTransition>>('transitions', {})();
  const captionSettings = scene.variables.get<{
    fontFamily: string;
    fontWeight: number;
    distanceFromBottom: number;
  }>('captionSettings', {
    fontFamily: 'Inter Variable',
    fontWeight: 400,
    distanceFromBottom: 140,
  })();

  const audioClips = layers
    .filter((layer) => layer.type === 'audio')
    .flatMap((layer) => layer.clips as AudioClip[]);
  const videoClips = layers
    .filter((layer) => layer.type === 'video')
    .flatMap((layer) => layer.clips as VideoClip[]);
  const textClips = layers
    .filter((layer) => layer.type === 'text')
    .flatMap((layer) => layer.clips as TextClip[]);
  const imageClips = layers
    .filter((layer) => layer.type === 'image')
    .flatMap((layer) => layer.clips as ImageClip[]);

  const transcriptionRecords = scene.variables.get<Record<string, SceneTranscription>>('transcriptions', {})();
  const transcriptionByUrl = new Map<string, SceneTranscription>();
  Object.values(transcriptionRecords ?? {}).forEach((record) => {
    if (record?.assetUrl) {
      transcriptionByUrl.set(record.assetUrl, record);
    }
  });

  // Helper to make transition key
  const makeKey = (from: string, to: string) => `${from}->${to}`;

  // Pre-process transitions for video clips
  const clipTransitions = new Map<string, { enter?: ClipTransition; exit?: ClipTransition }>();
  
  // Group video clips by layer to find adjacent clips
  for (const layer of layers) {
    if (layer.type !== 'video') continue;
    const clips = (layer.clips as VideoClip[]).sort((a, b) => a.start - b.start);
    
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const prev = clips[i - 1];
      const next = clips[i + 1];
      
      const entry: { enter?: ClipTransition; exit?: ClipTransition } = {};
      
      // Check for incoming transition
      if (prev) {
        // Only if they abut (within small epsilon)
        const prevEnd = prev.start + prev.duration / (prev.speed || 1);
        if (Math.abs(clip.start - prevEnd) < 0.1) {
           const trans = transitions[makeKey(prev.id, clip.id)];
           if (trans) entry.enter = trans;
        }
      }

      // Check for outgoing transition
      if (next) {
        const currentEnd = clip.start + clip.duration / (clip.speed || 1);
        if (Math.abs(next.start - currentEnd) < 0.1) {
           const trans = transitions[makeKey(clip.id, next.id)];
           if (trans) entry.exit = trans;
        }
      }
      
      clipTransitions.set(clip.id, entry);
    }
  }

  // Sort clips by start time
  const sortedAudioClips = [...audioClips].sort((a, b) => a.start - b.start);
  const sortedTextClips = [...textClips].sort((a, b) => a.start - b.start);
  const sortedImageClips = [...imageClips].sort((a, b) => a.start - b.start);

  const captionRefs = new Map<string, Reference<AnimatedCaptions>>();
  const clipCaptionData = new Map<string, TranscriptionEntry[]>();

  const normalizeSegmentsForClip = (clip: VideoClip | AudioClip, segments?: TranscriptionEntry[]) => {
    if (!segments || segments.length === 0) return [];
    const safeSpeed = Math.max(clip.speed ?? 1, 0.0001);
    const offsetSeconds = clip.offset ?? 0;
    const clipSourceEnd = offsetSeconds + clip.duration;

    return segments
      .map((segment) => ({
        startSeconds: segment.start / 1000,
        speech: segment.speech.trim(),
      }))
      .filter(({ startSeconds, speech }) => speech.length > 0 && startSeconds >= offsetSeconds && startSeconds <= clipSourceEnd + 0.05)
      .map(({ startSeconds, speech }) => ({
        start: Math.max(0, ((startSeconds - offsetSeconds) / safeSpeed) * 1000),
        speech,
      }))
      .sort((a, b) => a.start - b.start);
  };

  const registerCaptionForClip = (clip: VideoClip | AudioClip) => {
    if (!clip.src) return;
    const record = transcriptionByUrl.get(clip.src);
    if (!record?.segments?.length) return;
    const normalized = normalizeSegmentsForClip(clip, record.segments);
    if (!normalized.length) return;
    const ref = createRef<AnimatedCaptions>();
    captionRefs.set(clip.id, ref);
    clipCaptionData.set(clip.id, normalized);
    view.add(
      <AnimatedCaptions
        key={`captions-${clip.id}`}
        ref={ref}
        SceneHeight={height}
        y={height / 2 - captionSettings.distanceFromBottom}
        CaptionsSize={1.1}
        CaptionsDuration={3}
        ShowCaptions={false}
        TranscriptionData={() => normalized}
        CaptionsFontFamily={captionSettings.fontFamily}
        CaptionsFontWeight={captionSettings.fontWeight}
        zIndex={1000}
      />,
    );
  };

  // Create refs
  const videoEntries: Array<{clip: VideoClip; ref: Reference<Video>}> = [];

  // Background
  view.add(
    <Rect
      width={'100%'}
      height={'100%'}
      fill="#141417"
    />
  );

  videoClips.forEach(registerCaptionForClip);
  sortedAudioClips.forEach(registerCaptionForClip);

  // Video elements per clip, respecting layer order
  for (const layer of layers) {
    if (layer.type !== 'video') continue;
    for (const clip of layer.clips as VideoClip[]) {
      const ref = createRef<Video>();
      videoEntries.push({clip, ref});
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

  // Create audio elements (1px videos positioned at bottom right for audio-only playback)
  // Position at bottom right: x = width/2 - 0.5, y = height/2 - 0.5
  const audioRefs: Reference<Video>[] = [];
  for (let i = 0; i < sortedAudioClips.length; i++) {
    const clip = sortedAudioClips[i];
    const audioRef = createRef<Video>();
    audioRefs.push(audioRef);
    view.add(
      <Video
        ref={audioRef}
        src={clip.src}
        width={1}
        height={1}
        x={width / 2 - 0.5}
        y={height / 2 - 0.5}
      />
    );
  }

  const createCaptionRunner = (clip: VideoClip | AudioClip) => {
    const ref = captionRefs.get(clip.id);
    const data = clipCaptionData.get(clip.id);
    if (!ref || !data?.length) return null;
    return function* () {
      const captionNode = ref();
      if (!captionNode) return;
      captionNode.TranscriptionData(data);
      captionNode.ShowCaptions(true);
      yield* captionNode.animate();
      captionNode.ShowCaptions(false);
    };
  };

  const playVideo = (clip: VideoClip, videoRef: Reference<Video>) =>
    function* () {
      const transInfo = clipTransitions.get(clip.id);
      const enter = transInfo?.enter;
      const exit = transInfo?.exit;

      const speed = clip.speed ?? 1;
      const safeSpeed = Math.max(speed, 0.0001);
      
      let startAt = clip.start;
      let timelineDuration = clip.duration / safeSpeed;
      let offset = clip.offset;

      // Adjust for transitions
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

      const playback = function* () {
        // Clamp offset to 0 if we went negative
        const safeOffset = Math.max(0, offset);
        
        video.seek(safeOffset);
        video.playbackRate(safeSpeed);
        
        // Calculate Base Dimensions (Object Fit)
        const fit = clip.objectFit ?? 'fill';
        let vidW = width; 
        let vidH = height;
        
        if (fit !== 'fill') {
           const domVideo = (video as any).video() as HTMLVideoElement | undefined;
           const srcW = domVideo?.videoWidth || 1920;
           const srcH = domVideo?.videoHeight || 1080;
           
           if (srcW > 0 && srcH > 0) {
             const srcRatio = srcW / srcH;
             const sceneRatio = width / height;
             
             if (fit === 'contain') {
               if (srcRatio > sceneRatio) {
                 vidW = width;
                 vidH = width / srcRatio;
               } else {
                 vidH = height;
                 vidW = height * srcRatio;
               }
             } else if (fit === 'cover') {
               // For cover, we want the dimension that COVERS the scene
               // If video is wider (srcRatio > sceneRatio), we match Height (so width overflows)
               if (srcRatio > sceneRatio) {
                 vidH = height;
                 vidW = height * srcRatio;
               } else {
                 // If video is taller (srcRatio < sceneRatio), we match Width (so height overflows)
                 vidW = width;
                 vidH = width / srcRatio;
               }
             }
           }
        }
        
        video.width(vidW);
        video.height(vidH);
        
        // Calculate Focus Transforms
        let baseScale = toVector(clip.scale);
        let basePos = toVector(clip.position);

        if (clip.focus) {
          const { x, y, width: fw, height: fh, padding } = clip.focus;
          // Use dynamic video dimensions
          
          // Fit ratio
          const sX = (vidW / Math.max(1, fw + padding * 2));
          const sY = (vidH / Math.max(1, fh + padding * 2));
          const s = Math.min(sX, sY); 
          
          baseScale = baseScale.mul(s);
          
          // Focus Center relative to Video Center
          const fvx = (x + fw / 2) - vidW / 2;
          const fvy = (y + fh / 2) - vidH / 2;
          const focusOffset = new Vector2(fvx, fvy);
          
          // Adjust position
          basePos = basePos.sub(focusOffset.mul(baseScale));
        }
        
        // Initial State
        const initialPos = basePos;
        video.position(initialPos);
        video.scale(baseScale);
        
        // Initial Opacity
        if (enter && enter.type === 'fade') {
           video.opacity(0);
        } else {
           video.opacity(1);
        }
        
        // Handle Slide Enter
        if (enter && enter.type.startsWith('slide')) {
           const w = width;
           const h = height;
           let startPos = initialPos;
           
           if (enter.type === 'slide-left') startPos = new Vector2(initialPos.x + w, initialPos.y);
           else if (enter.type === 'slide-right') startPos = new Vector2(initialPos.x - w, initialPos.y);
           else if (enter.type === 'slide-up') startPos = new Vector2(initialPos.x, initialPos.y + h);
           else if (enter.type === 'slide-down') startPos = new Vector2(initialPos.x, initialPos.y - h);
           
           video.position(startPos);
        }

        video.play();

        // Animation Sequence
        // 1. Enter Phase
        if (enter) {
           if (enter.type === 'fade') {
             yield* video.opacity(1, enter.duration);
           } else if (enter.type.startsWith('slide')) {
             yield* video.position(initialPos, enter.duration);
           } else {
             yield* waitFor(enter.duration);
           }
        }
        
        // 2. Main Phase (Duration - Enter - Exit)
        const mainDuration = timelineDuration - (enter ? enter.duration : 0) - (exit ? exit.duration : 0);
        if (mainDuration > 0) {
           yield* waitFor(mainDuration);
        }
        
        // 3. Exit Phase
        if (exit) {
           if (exit.type === 'fade') {
             yield* video.opacity(0, exit.duration);
           } else if (exit.type.startsWith('slide')) {
             // Outgoing slide
             const w = width;
             const h = height;
             let endPos = initialPos;
             
             if (exit.type === 'slide-left') endPos = new Vector2(initialPos.x - w, initialPos.y);
             else if (exit.type === 'slide-right') endPos = new Vector2(initialPos.x + w, initialPos.y);
             else if (exit.type === 'slide-up') endPos = new Vector2(initialPos.x, initialPos.y - h);
             else if (exit.type === 'slide-down') endPos = new Vector2(initialPos.x, initialPos.y + h);
             
             yield* video.position(endPos, exit.duration);
           } else {
             yield* waitFor(exit.duration);
           }
        }

        video.opacity(0);
        video.pause();
      };

      const captionsRunner = createCaptionRunner(clip);
      if (captionsRunner) {
        yield* all(playback(), captionsRunner());
      } else {
        yield* playback();
      }
    };

  function* processVideoClips() {
    if (videoEntries.length === 0) return;
    yield* all(...videoEntries.map(({clip, ref}) => playVideo(clip, ref)()));
  }

  // Process text clips in parallel
  function* processTextClips() {
    if (!sortedTextClips || sortedTextClips.length === 0) return;

    // Create text elements for each text clip
    const textRefs: Reference<Txt>[] = [];
    for (let i = 0; i < sortedTextClips.length; i++) {
      const clip = sortedTextClips[i];
      const textRef = createRef<Txt>();
      textRefs.push(textRef);
      view.add(
        <Txt
          key={`text-clip-${clip.id}`}
          ref={textRef}
          text={clip.text}
          fontSize={clip.fontSize ?? 48}
          fill={clip.fill ?? '#ffffff'}
          x={clip.position.x}
          y={clip.position.y}
          scale={clip.scale}
          opacity={0}
        />
      );
    }

    // Create a generator function for each text clip
    const playText = (clip: TextClip, textRef: Reference<Txt>) =>
      function* () {
        const speed = clip.speed ?? 1;
        const safeSpeed = Math.max(speed, 0.0001);
        const startAt = Math.max(clip.start, 0);
        const timelineDuration = clip.duration / safeSpeed;

        // Wait until this clip's start time
        if (startAt > 0) {
          yield* waitFor(startAt);
        }

        const text = textRef();
        if (!text) return;

        // Show text
        text.opacity(clip.opacity ?? 1);

        // Wait for clip duration
        yield* waitFor(timelineDuration);

        // Hide text
        text.opacity(0);
      };

    // Create generators for each text clip and run them all in parallel
    const runners = sortedTextClips.map((clip, index) => playText(clip, textRefs[index]));
    if (runners.length > 0) {
      yield* all(...runners.map(r => r()));
    }
  }

  // Process image clips in parallel
  function* processImageClips() {
    if (!sortedImageClips || sortedImageClips.length === 0) return;

    // Create image elements for each image clip
    const imageRefs: Reference<Img>[] = [];
    for (let i = 0; i < sortedImageClips.length; i++) {
      const clip = sortedImageClips[i];
      const imageRef = createRef<Img>();
      imageRefs.push(imageRef);
      
      const props: any = {
        key: `image-clip-${clip.id}`,
        ref: imageRef,
        src: clip.src,
        x: clip.position.x,
        y: clip.position.y,
        scale: clip.scale,
        opacity: 0,
      };
      
      if (clip.width) props.width = clip.width;
      if (clip.height) props.height = clip.height;

      view.add(<Img {...props} />);
    }

    // Create a generator function for each image clip
    const playImage = (clip: ImageClip, imageRef: Reference<Img>) =>
      function* () {
        const speed = clip.speed ?? 1;
        const safeSpeed = Math.max(speed, 0.0001);
        const startAt = Math.max(clip.start, 0);
        const timelineDuration = clip.duration / safeSpeed;

        // Wait until this clip's start time
        if (startAt > 0) {
          yield* waitFor(startAt);
        }

        const image = imageRef();
        if (!image) return;

        // Show image
        image.opacity(1);

        // Wait for clip duration
        yield* waitFor(timelineDuration);

        // Hide image
        image.opacity(0);
      };

    // Create generators for each image clip and run them all in parallel
    const runners = sortedImageClips.map((clip, index) => playImage(clip, imageRefs[index]));
    if (runners.length > 0) {
      yield* all(...runners.map(r => r()));
    }
  }

  // Process audio tracks in parallel (following Vidova's pattern)
  function* processAudioTracks() {
    if (!sortedAudioClips || sortedAudioClips.length === 0) return;

    // Create a generator function for each audio clip that handles its own timing
    const playTrack = (clip: AudioClip, audioRef: Reference<Video>) =>
      function* () {
        const speed = clip.speed ?? 1;
        const safeSpeed = Math.max(speed, 0.0001);
        const startAt = Math.max(clip.start, 0);
        const timelineDuration = clip.duration / safeSpeed;

        // Wait until this clip's start time
        if (startAt > 0) {
          yield* waitFor(startAt);
        }

        const video = audioRef();
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

        const captionsRunner = createCaptionRunner(clip);
        if (captionsRunner) {
          yield* all(playback(), captionsRunner());
        } else {
          yield* playback();
        }
      };

    // Create generators for each audio clip and run them all in parallel
    const runners = sortedAudioClips.map((clip, index) => playTrack(clip, audioRefs[index]));
    if (runners.length > 0) {
      yield* all(...runners.map(r => r()));
    }
  }

  // Run video, audio, and text tracks in parallel
  yield* all(
    processVideoClips(),
    processAudioTracks(),
    processTextClips(),
    processImageClips(),
  );

  // Final cleanup - pause all media
  videoEntries.forEach(({ref}) => {
    const node = ref();
    if (node) {
      node.pause();
      node.opacity(0);
    }
  });
  audioRefs.forEach(ref => ref().pause());
});
