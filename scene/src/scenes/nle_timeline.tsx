import { Video, Rect, Txt, makeScene2D } from '@motion-canvas/2d';
import { all, createRef, Reference, useScene, waitFor } from '@motion-canvas/core';

// Type definitions matching the app's types
interface VideoClip {
  id: string;
  type: 'video';
  src: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
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
}

export default makeScene2D(function* (view) {
  const scene = useScene();

  // Get scene dimensions
  const { width, height } = scene.getSize();

  // Get variables from the player
  const videoClips = scene.variables.get<VideoClip[]>('videoClips', [])();
  const audioClips = scene.variables.get<AudioClip[]>('audioClips', [])();
  const totalDuration = scene.variables.get<number>('duration', 10)();

  // Sort clips by start time
  const sortedVideoClips = [...videoClips].sort((a, b) => a.start - b.start);
  const sortedAudioClips = [...audioClips].sort((a, b) => a.start - b.start);

  // Create refs
  const videoRef = createRef<Video>();
  const placeholderRef = createRef<Rect>();

  // Background
  view.add(
    <Rect
      width={'100%'}
      height={'100%'}
      fill="#141417"
    />
  );

  // Video element for main video track (initially hidden)
  view.add(
    <Video
      ref={videoRef}
      src=""
      width={1920}
      height={1080}
      opacity={0}
    />
  );

  // Placeholder when no video clip
  view.add(
    <Rect
      ref={placeholderRef}
      width={400}
      height={225}
      fill="#1e1e22"
      radius={8}
      opacity={1}
    >
      <Txt
        text="No clip at current time"
        fill="#666"
        fontSize={18}
        fontFamily="system-ui"
      />
    </Rect>
  );

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

  // Generator function to play a single video clip
  function* playVideoClip(clip: VideoClip, startDelay: number) {
    if (startDelay > 0) {
      yield* waitFor(startDelay);
    }

    const clipSpeed = clip.speed ?? 1;
    const timelineDuration = clip.duration / clipSpeed;

    // Set up and play this clip
    videoRef().src(clip.src);
    videoRef().seek(clip.offset);
    videoRef().playbackRate(clipSpeed);

    // Show video, hide placeholder
    videoRef().opacity(1);
    placeholderRef().opacity(0);

    // Start playback
    videoRef().play();

    // Wait for clip duration
    yield* waitFor(timelineDuration);

    // Pause after clip ends
    videoRef().pause();

    // Show placeholder after clip
    videoRef().opacity(0);
    placeholderRef().opacity(1);
  }

  // Process video clips sequentially
  function* processVideoClips() {
    let currentTime = 0;

    for (const clip of sortedVideoClips) {
      const clipSpeed = clip.speed ?? 1;
      const timelineDuration = clip.duration / clipSpeed;
      const clipEnd = clip.start + timelineDuration;

      // Wait for gap before this clip
      const waitTime = clip.start - currentTime;
      if (waitTime > 0) {
        // Show placeholder during gap
        videoRef().opacity(0);
        placeholderRef().opacity(1);
        yield* waitFor(waitTime);
        currentTime = clip.start;
      }

      // Play the clip
      yield* playVideoClip(clip, 0);
      currentTime = clipEnd;
    }

    // After all clips, wait for remaining time
    const remainingTime = totalDuration - currentTime;
    if (remainingTime > 0) {
      videoRef().opacity(0);
      placeholderRef().opacity(1);
      yield* waitFor(remainingTime);
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

  // Run video and all audio tracks in parallel
  yield* all(
    processVideoClips(),
    processAudioTracks(),
  );

  // Final cleanup - pause all media
  videoRef().pause();
  audioRefs.forEach(ref => ref().pause());
});
