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
import type { CaptionStyleType } from '../lib/types';

export interface TranscriptionEntry {
  start: number;
  speech: string;
}

/** Per-style colors and layout (default = unspoken, highlight = current word). Use shadow for outline so layout stays consistent. */
const CAPTION_STYLE_CONFIG: Record<
  CaptionStyleType,
  {
    /** Show dark pill background */
    showPill: boolean;
    pillFill: string;
    fillDefault: string;
    fillHighlight: string;
    shadowBlur: number;
    shadowColor: string;
    /** Background under current word only (word-highlight style) */
    wordBackground?: boolean;
    wordBackgroundFill?: string;
  }
> = {
  pill: {
    showPill: true,
    pillFill: 'rgba(0,0,0,0.9)',
    fillDefault: 'rgba(255,255,255,0.5)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 20,
    shadowColor: 'rgba(255,255,255,0.75)',
  },
  'karaoke-lime': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,1)',
    fillHighlight: 'rgba(180,255,0,1)',
    shadowBlur: 10,
    shadowColor: 'rgba(0,0,0,1)',
  },
  'karaoke-magenta': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,0.9)',
    fillHighlight: 'rgba(255,0,128,1)',
    shadowBlur: 10,
    shadowColor: 'rgba(0,0,0,1)',
  },
  'karaoke-cyan': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,1)',
    fillHighlight: 'rgba(0,220,255,1)',
    shadowBlur: 10,
    shadowColor: 'rgba(0,0,0,1)',
  },
  outlined: {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,1)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 14,
    shadowColor: 'rgba(0,0,0,1)',
  },
  'bold-outline': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,1)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 18,
    shadowColor: 'rgba(0,0,0,1)',
  },
  minimal: {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,0.95)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 4,
    shadowColor: 'rgba(0,0,0,0.4)',
  },
  'word-highlight': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,0.9)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 6,
    shadowColor: 'rgba(0,0,0,0.5)',
    wordBackground: true,
    wordBackgroundFill: 'rgba(255,220,100,0.45)',
  },
  'pink-pill': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,1)',
    fillHighlight: 'rgba(255,255,255,1)',
    shadowBlur: 8,
    shadowColor: 'rgba(0,0,0,0.6)',
    wordBackground: true,
    wordBackgroundFill: 'rgba(255,20,147,0.85)', // Bright pink/magenta
  },
  'dark-pill-lime': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,0.9)',
    fillHighlight: 'rgba(180,255,0,1)', // Lime green
    shadowBlur: 6,
    shadowColor: 'rgba(0,0,0,0.4)',
    wordBackground: true,
    wordBackgroundFill: 'rgba(60,60,60,0.85)', // Dark grey
  },
  'cloud-blob': {
    showPill: false,
    pillFill: 'rgba(0,0,0,0)',
    fillDefault: 'rgba(255,255,255,0.95)',
    fillHighlight: 'rgba(0,220,255,1)', // Cyan
    shadowBlur: 12,
    shadowColor: 'rgba(0,0,0,0.3)',
    wordBackground: true,
    wordBackgroundFill: 'rgba(255,248,220,0.75)', // Light yellow/beige
  },
};

export interface AnimatedCaptionsProps extends NodeProps {
  ShowCaptions: SignalValue<boolean>;
  CaptionsSize: SignalValue<number>;
  CaptionsDuration: SignalValue<number>;
  TranscriptionData: SignalValue<TranscriptionEntry[]>;
  SceneHeight: SignalValue<number>;
  SceneWidth: SignalValue<number>;
  CaptionsFontFamily: SignalValue<string>;
  CaptionsFontWeight: SignalValue<number>;
  CaptionsFontSize?: SignalValue<number>;
  CaptionsStyle?: SignalValue<CaptionStyleType>;
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

  @initial(18)
  @signal()
  public declare readonly CaptionsFontSize: SimpleSignal<number, this>;

  @initial('pill')
  @signal()
  public declare readonly CaptionsStyle: SimpleSignal<CaptionStyleType, this>;

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
        {() => {
          const style = this.CaptionsStyle();
          const config = CAPTION_STYLE_CONFIG[style] ?? CAPTION_STYLE_CONFIG.pill;
          const scale = () => this.CaptionsSize() * ScaleFactor();
          // Always use same padding/radius so layout never collapses when switching styles
          return (
            <Rect
              fill={config.pillFill}
              shadowBlur={config.showPill ? 50 : 0}
              shadowColor={config.showPill ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)'}
              layout
              alignItems={'center'}
              justifyContent={'center'}
              paddingTop={() => 10 * scale()}
              paddingBottom={() => 6 * scale()}
              paddingLeft={() => 14 * scale()}
              paddingRight={() => 14 * scale()}
              radius={() => 10 * scale()}
            >
              {(() => {
                const parts = this.CaptionText().split('*');
                // Format: "before* current* after" → 3 parts (current word highlighted)
                // Format: "* all words" → 2 parts (all words in default, initial state)
                // parts[0] = before (default), parts[1] = current (highlight if 3 parts), parts[2] = after (default)
                const hasThreeParts = parts.length === 3;
                return parts.map((caption, index) => {
                  if (!caption.trim()) return null;
                  // Only highlight middle segment if we have 3 parts (two asterisks)
                  const isCurrent = hasThreeParts && index === 1;
                  const fill = isCurrent ? config.fillHighlight : config.fillDefault;
                  const hasNext = index < parts.length - 1 && parts[index + 1]?.trim().length > 0;
                  
                  // For word-highlight styles, wrap current word in a background Rect
                  if (config.wordBackground && isCurrent) {
                    const style = this.CaptionsStyle();
                    // Different radius for different styles
                    const radiusValue = style === 'cloud-blob' 
                      ? () => 20 * scale() // Very rounded for blob effect
                      : style === 'pink-pill'
                      ? () => 4 * scale()  // More rectangular
                      : () => 12 * scale(); // Rounded pill
                    
                    return (
                      <Rect
                        key={`word-bg-${index}`}
                        layout
                        paddingLeft={() => 8 * scale()}
                        paddingRight={() => 8 * scale()}
                        paddingTop={() => 5 * scale()}
                        paddingBottom={() => 5 * scale()}
                        radius={radiusValue}
                        fill={config.wordBackgroundFill ?? 'rgba(255,220,100,0.45)'}
                        marginRight={hasNext ? () => 4 * scale() : 0}
                        shadowBlur={style === 'cloud-blob' ? 8 : 0}
                        shadowColor={style === 'cloud-blob' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0)'}
                      >
                        <Txt
                          shadowBlur={config.shadowBlur}
                          shadowColor={config.shadowColor}
                          fill={fill}
                          fontWeight={this.CaptionsFontWeight()}
                          fontFamily={this.CaptionsFontFamily()}
                          text={caption.trim()}
                          fontSize={() => this.CaptionsSize() * ScaleFactor() * this.CaptionsFontSize()}
                        />
                      </Rect>
                    );
                  }
                  
                  return (
                    <Txt
                      key={`${caption}-${index}`}
                      shadowBlur={config.shadowBlur}
                      shadowColor={config.shadowColor}
                      fill={fill}
                      fontWeight={this.CaptionsFontWeight()}
                      fontFamily={this.CaptionsFontFamily()}
                      text={caption.trim()}
                      paddingRight={hasNext ? () => 5 * this.CaptionsSize() * ScaleFactor() : 0}
                      fontSize={() => this.CaptionsSize() * ScaleFactor() * this.CaptionsFontSize()}
                    />
                  );
                });
              })()}
            </Rect>
          );
        }}
      </Rect>,
    );
  }

  /**
   * Run caption animation. If shouldContinue is provided and returns false
   * (e.g. another clip took over), the animation exits early so the next caption can run.
   */
  public *animate(shouldContinue?: () => boolean) {
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
      yield;
      if (shouldContinue && !shouldContinue()) return;

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
      if (shouldContinue && !shouldContinue()) return;

      let prevSeconds = seconds;
      if (prevEntry && !shouldFadeIn) {
        // If we didn't fade in, we're continuing from previous group
        // No need to add transition time offset
      } else if (prevEntry) {
        prevSeconds += GO_UP + GO_DOWN;
      }

      let i = 0;
      for (const [startSeconds, caption] of shortcut.entries()) {
        // Build text with format: "before* current* after" for three segments
        const before = Array.from(shortcut.values()).slice(0, i).join(' ');
        const after = Array.from(shortcut.values()).slice(i + 1).join(' ');
        const text = before + (before ? '*' : '') + ` ${caption}*` + (after ? after : '');

        this.CaptionText(text);

        yield* waitFor(startSeconds - prevSeconds);
        prevSeconds = startSeconds;
        i++;
        yield;
        if (shouldContinue && !shouldContinue()) return;
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
        if (shouldContinue && !shouldContinue()) return;

        yield* tween(GO_DOWN, value => {
          this.Opacity(map(1, 0, easeOutCubic(value)));
          this.Blur(map(0, 100, easeOutCubic(value)));
        });
      }
    }
  }
}
