import { Video, Rect, Txt, Img, makeScene2D } from '@motion-canvas/2d';
import { Vector2, all, createRef, Reference, useScene, waitFor } from '@motion-canvas/core';

// Type definitions matching the app's types
interface Transform {
  x: number;
  y: number;
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

type TimelineClip = VideoClip | AudioClip | TextClip | ImageClip;

interface Layer {
  id: string;
  name: string;
  type: TimelineClip['type'];
  clips: TimelineClip[];
}

const toVector = (transform: Transform) => new Vector2(transform.x, transform.y);

export default makeScene2D(function* (view) {
  const scene = useScene();

  // Get scene dimensions
  const { width, height } = scene.getSize();

  // Get variables from the player
  const layers = scene.variables.get<Layer[]>('layers', [])();
  scene.variables.get<number>('duration', 10)();

  const audioClips = layers
    .filter((layer) => layer.type === 'audio')
    .flatMap((layer) => layer.clips as AudioClip[]);
  const textClips = layers
    .filter((layer) => layer.type === 'text')
    .flatMap((layer) => layer.clips as TextClip[]);
  const imageClips = layers
    .filter((layer) => layer.type === 'image')
    .flatMap((layer) => layer.clips as ImageClip[]);

  // Sort clips by start time
  const sortedAudioClips = [...audioClips].sort((a, b) => a.start - b.start);
  const sortedTextClips = [...textClips].sort((a, b) => a.start - b.start);
  const sortedImageClips = [...imageClips].sort((a, b) => a.start - b.start);

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

  const playVideo = (clip: VideoClip, videoRef: Reference<Video>) =>
    function* () {
      const speed = clip.speed ?? 1;
      const safeSpeed = Math.max(speed, 0.0001);
      const startAt = Math.max(clip.start, 0);
      const timelineDuration = clip.duration / safeSpeed;

      if (startAt > 0) {
        yield* waitFor(startAt);
      }

      const video = videoRef();
      if (!video) return;

      video.seek(clip.offset);
      video.playbackRate(safeSpeed);
      video.position(toVector(clip.position));
      video.scale(toVector(clip.scale));
      video.opacity(1);
      video.play();

      yield* waitFor(timelineDuration);

      video.opacity(0);
      video.pause();
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

        // Set up audio playback
        video.seek(clip.offset);
        video.playbackRate(safeSpeed);

        // Set volume via HTML video element
        try {
          const htmlVideo = (video as any).video() as HTMLVideoElement | undefined;
          if (htmlVideo) {
            const trackVolume = Math.min(Math.max(clip.volume ?? 1, 0), 1);
            htmlVideo.volume = trackVolume;
          }
        } catch (err) {
          // Silently handle volume setting errors
        }

        // Start playback
        video.play();

        // Wait for clip duration
        yield* waitFor(timelineDuration);

        // Stop playback
        video.pause();
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
