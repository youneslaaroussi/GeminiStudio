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
                    fontWeight={400}
                    fontFamily={'Inter Variable'}
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
    const MAX_LENGTH = 50;

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

    let index = 0;
    for (const [seconds, shortcut] of captions.entries()) {
      this.CaptionText('*' + Array.from(shortcut.values()).join(' '));

      const prevShortcut = Array.from(captions.entries())[index - 1];

      if (!prevShortcut || seconds - prevShortcut[0] >= this.CaptionsDuration()) {
        yield* tween(GO_UP, value => {
          this.Opacity(map(0, 1, easeInCubic(value)));
          this.Blur(map(100, 0, easeInCubic(value)));
        });
      }

      index++;
      let prevSeconds = seconds;
      if (prevShortcut) prevSeconds += GO_UP + GO_DOWN;

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
