import { Node, NodeProps, Rect, Txt, initial, signal } from '@motion-canvas/2d';
import {
  SignalValue,
  SimpleSignal,
  createSignal,
  easeInCubic,
  easeOutCubic,
  map,
  tween,
  waitFor,
} from '@motion-canvas/core';

import gaussianBlur from '../shaders/gaussianBlur.glsl';

export interface TranscriptionEntry {
  start: number;
  speech: string;
}

export interface AnimatedCaptionsProps extends NodeProps {
  ShowCaptions: SignalValue<boolean>;
  CaptionsSize: SignalValue<number>;
  CaptionsDuration: SignalValue<number>;
  TranscriptionData: SignalValue<TranscriptionEntry[]>;
  SceneHeight: SignalValue<number>;
  SceneWidth: SignalValue<number>;
  CaptionsFontFamily: SignalValue<string>;
  CaptionsFontWeight: SignalValue<number>;
}

const GO_UP = 8 / 30;
const GO_DOWN = 5 / 30;

export class AnimatedCaptions extends Node {
  @initial(false)
  @signal()
  public declare readonly ShowCaptions: SimpleSignal<boolean, this>;

  @initial(1.5)
  @signal()
  public declare readonly CaptionsDuration: SimpleSignal<number, this>;

  @initial(1)
  @signal()
  public declare readonly CaptionsSize: SimpleSignal<number, this>;

  @initial([])
  @signal()
  public declare readonly TranscriptionData: SimpleSignal<TranscriptionEntry[], this>;

  @initial(0)
  @signal()
  public declare readonly SceneHeight: SimpleSignal<number, this>;

  @initial(0)
  @signal()
  public declare readonly SceneWidth: SimpleSignal<number, this>;

  @initial('Inter Variable')
  @signal()
  public declare readonly CaptionsFontFamily: SimpleSignal<string, this>;

  @initial(400)
  @signal()
  public declare readonly CaptionsFontWeight: SimpleSignal<number, this>;

  private readonly CaptionText = createSignal('');
  private readonly Opacity = createSignal(0);
  private readonly Blur = createSignal(0);

  public constructor(props?: AnimatedCaptionsProps) {
    super({ ...props });

    const ScaleFactor = createSignal(() => {
      const height = this.SceneHeight();
      return height > 0 ? height / 720 : 1;
    });

    this.add(
      <Rect
        opacity={() =>
          this.ShowCaptions() &&
          this.TranscriptionData().length > 0 &&
          this.CaptionText().trim().replace(/\*/g, '').length > 0
            ? this.Opacity()
            : 0
        }
        layout
        alignItems={'center'}
        justifyContent={'center'}
        shaders={[
          {
            fragment: gaussianBlur,
            uniforms: {
              Directions: 12,
              Size: this.Blur,
              Quality: 10,
            },
          },
        ]}
      >
        <Rect
          fill={'rgba(0,0,0,0.9)'}
          shadowBlur={50}
          shadowColor={'rgba(0,0,0,0.8)'}
          layout
          alignItems={'center'}
          justifyContent={'center'}
          paddingTop={() => 10 * this.CaptionsSize() * ScaleFactor()}
          paddingBottom={() => 6 * this.CaptionsSize() * ScaleFactor()}
          paddingLeft={() => 14 * this.CaptionsSize() * ScaleFactor()}
          paddingRight={() => 14 * this.CaptionsSize() * ScaleFactor()}
          radius={() => 10 * this.CaptionsSize() * ScaleFactor()}
        >
          {() =>
            this.CaptionText()
              .split('*')
              .map((caption, index) => {
                if (!caption) return null;
                const [, secondary] = this.CaptionText().split('*');
                return (
                  <Txt
                    key={`${caption}-${index}`}
                    shadowBlur={20}
                    shadowColor={
                      index === 0 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0)'
                    }
                    fill={
                      index === 1
                        ? 'rgba(255,255,255,0.5)'
                        : 'rgba(255,255,255,1)'
                    }
                    fontWeight={this.CaptionsFontWeight()}
                    fontFamily={this.CaptionsFontFamily()}
                    text={caption.trim()}
                    paddingRight={
                      index === 0 && secondary ? 5 * this.CaptionsSize() * ScaleFactor() : 0
                    }
                    fontSize={() => this.CaptionsSize() * ScaleFactor() * 18}
                  />
                );
              })
          }
        </Rect>
      </Rect>,
    );
  }

  public *animate() {
    // Calculate MAX_LENGTH based on aspect ratio
    // Vertical layouts (portrait) need shorter lines to fit the narrower width
    const width = this.SceneWidth();
    const height = this.SceneHeight();
    const aspectRatio = width > 0 && height > 0 ? width / height : 16 / 9;
    
    // For 16:9 (1.78) use 50 chars, for 9:16 (0.56) use ~25 chars
    // Linear interpolation between these values
    const MAX_LENGTH = Math.round(
      Math.max(20, Math.min(50, 25 + (aspectRatio - 0.56) * (50 - 25) / (1.78 - 0.56)))
    );

    const filteredData = this.TranscriptionData().filter(
      entry => entry.speech.trim().length > 0,
    );

    if (filteredData.length === 0) {
      this.CaptionText('');
      return;
    }

    let currText = '';
    let currSeconds = 0;

    const captions = new Map<number, Map<number, string>>([
      [currSeconds, new Map()],
    ]);

    for (const entry of filteredData) {
      currText += entry.speech;

      captions.get(currSeconds)?.set(entry.start / 1000, entry.speech);

      if (currText.length > MAX_LENGTH) {
        currSeconds = entry.start / 1000;
        currText = '';

        captions.set(currSeconds, new Map());
      }
    }

    const captionEntries = Array.from(captions.entries());
    
    for (let index = 0; index < captionEntries.length; index++) {
      const [seconds, shortcut] = captionEntries[index];
      const prevEntry = captionEntries[index - 1];
      const nextEntry = captionEntries[index + 1];
      
      this.CaptionText('*' + Array.from(shortcut.values()).join(' '));

      // Fade in if: first group, OR enough time passed since previous group started
      const shouldFadeIn = !prevEntry || seconds - prevEntry[0] >= this.CaptionsDuration();
      if (shouldFadeIn) {
        yield* tween(GO_UP, value => {
          this.Opacity(map(0, 1, easeInCubic(value)));
          this.Blur(map(100, 0, easeInCubic(value)));
        });
      }

      let prevSeconds = seconds;
      if (prevEntry && !shouldFadeIn) {
        // If we didn't fade in, we're continuing from previous group
        // No need to add transition time offset
      } else if (prevEntry) {
        prevSeconds += GO_UP + GO_DOWN;
      }

      let i = 0;
      for (const [startSeconds, caption] of shortcut.entries()) {
        const text =
          Array.from(shortcut.values()).slice(0, i).join(' ') +
          ` ${caption}*` +
          Array.from(shortcut.values())
            .slice(i + 1)
            .join(' ');

        this.CaptionText(text);

        yield* waitFor(startSeconds - prevSeconds);
        prevSeconds = startSeconds;
        i++;
      }

      // Check if next group is close - if so, don't fade out
      const shouldFadeOut = !nextEntry || nextEntry[0] - seconds >= this.CaptionsDuration();
      
      if (shouldFadeOut) {
        // Wait for remaining duration before fading out
        if (prevSeconds < this.CaptionsDuration() + seconds) {
          yield* waitFor(
            this.CaptionsDuration() - prevSeconds + seconds - GO_DOWN - GO_UP,
          );
        }

        yield* tween(GO_DOWN, value => {
          this.Opacity(map(1, 0, easeOutCubic(value)));
          this.Blur(map(0, 100, easeOutCubic(value)));
        });
      }
    }
  }
}
