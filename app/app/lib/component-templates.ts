/**
 * Premade Motion Canvas component templates.
 *
 * Each template includes the full TSX source, the exported class name,
 * input definitions, and metadata for the template picker UI.
 */

import type { ComponentInputDef } from "@/app/types/assets";

export interface ComponentTemplate {
  /** Unique slug */
  id: string;
  /** Display name in the picker */
  name: string;
  /** Short description */
  description: string;
  /** Category for grouping */
  category: "text" | "data" | "shape" | "overlay";
  /** Exported class name (must match the code) */
  componentName: string;
  /** Input definitions */
  inputDefs: ComponentInputDef[];
  /** Complete Motion Canvas TSX source */
  code: string;
}

export const COMPONENT_TEMPLATES: ComponentTemplate[] = [
  // ---------------------------------------------------------------------------
  // TEXT
  // ---------------------------------------------------------------------------
  {
    id: "typewriter",
    name: "Typewriter Text",
    description: "Text that types itself character by character",
    category: "text",
    componentName: "TypewriterText",
    inputDefs: [
      { name: "fullText", type: "string", default: "Hello, World!", label: "Text" },
      { name: "charDelay", type: "number", default: 0.04, label: "Char Delay (s)" },
      { name: "textColor", type: "color", default: "#ffffff", label: "Color" },
      { name: "textSize", type: "number", default: 48, label: "Font Size" },
    ],
    code: `import { Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createSignal, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface TypewriterTextProps extends NodeProps {
  fullText?: SignalValue<string>;
  charDelay?: SignalValue<number>;
  textColor?: SignalValue<PossibleColor>;
  textSize?: SignalValue<number>;
}

export class TypewriterText extends Node {
  @initial('Hello, World!') @signal()
  public declare readonly fullText: SimpleSignal<string, this>;

  @initial(0.04) @signal()
  public declare readonly charDelay: SimpleSignal<number, this>;

  @initial('#ffffff') @colorSignal()
  public declare readonly textColor: ColorSignal<this>;

  @initial(48) @signal()
  public declare readonly textSize: SimpleSignal<number, this>;

  private readonly progress = createSignal(0);

  public constructor(props?: TypewriterTextProps) {
    super({ ...props });
    this.add(
      <Txt
        text={() => this.fullText().slice(0, Math.floor(this.progress() * this.fullText().length))}
        fill={() => this.textColor()}
        fontSize={() => this.textSize()}
        fontFamily={'Inter Variable'}
        fontWeight={600}
      />,
    );
  }

  public *reveal(duration?: number): ThreadGenerator {
    this.progress(0);
    const dur = duration ?? this.fullText().length * this.charDelay();
    yield* tween(dur, (v) => this.progress(easeInOutCubic(v)));
  }
}
`,
  },
  {
    id: "gradient-heading",
    name: "Gradient Heading",
    description: "Bold heading with a horizontal color gradient",
    category: "text",
    componentName: "GradientHeading",
    inputDefs: [
      { name: "text", type: "string", default: "GEMINI STUDIO", label: "Text" },
      { name: "colorA", type: "color", default: "#4285F4", label: "Color A" },
      { name: "colorB", type: "color", default: "#EA4335", label: "Color B" },
      { name: "textSize", type: "number", default: 72, label: "Font Size" },
    ],
    code: `import { Node, NodeProps, Layout, Rect, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, createSignal, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface GradientHeadingProps extends NodeProps {
  text?: SignalValue<string>;
  colorA?: SignalValue<PossibleColor>;
  colorB?: SignalValue<PossibleColor>;
  textSize?: SignalValue<number>;
}

export class GradientHeading extends Node {
  @initial('GEMINI STUDIO') @signal()
  public declare readonly text: SimpleSignal<string, this>;

  @initial('#4285F4') @colorSignal()
  public declare readonly colorA: ColorSignal<this>;

  @initial('#EA4335') @colorSignal()
  public declare readonly colorB: ColorSignal<this>;

  @initial(72) @signal()
  public declare readonly textSize: SimpleSignal<number, this>;

  private readonly letters: Txt[] = [];
  private readonly opacity = createSignal(0);

  public constructor(props?: GradientHeadingProps) {
    super({ ...props });
    const layoutRef = createRef<Layout>();
    this.add(
      <Layout ref={layoutRef} layout gap={2} opacity={() => this.opacity()}>
        {(() => {
          const chars = this.text().split('');
          return chars.map((char, i) => {
            const t = chars.length > 1 ? i / (chars.length - 1) : 0;
            const ref = createRef<Txt>();
            const node = (
              <Txt
                ref={ref}
                text={char === ' ' ? '\\u00A0' : char}
                fill={() => {
                  const a = this.colorA();
                  const b = this.colorB();
                  return \`color-mix(in srgb, \${a} \${Math.round((1 - t) * 100)}%, \${b})\`;
                }}
                fontSize={() => this.textSize()}
                fontFamily={'Inter Variable'}
                fontWeight={900}
              />
            );
            this.letters.push(ref());
            return node;
          });
        })()}
      </Layout>,
    );
  }

  public *fadeIn(duration: number = 0.8): ThreadGenerator {
    yield* tween(duration, (v) => this.opacity(easeInOutCubic(v)));
  }
}
`,
  },

  // ---------------------------------------------------------------------------
  // DATA
  // ---------------------------------------------------------------------------
  {
    id: "progress-ring",
    name: "Progress Ring",
    description: "Animated circular progress indicator with percentage label",
    category: "data",
    componentName: "ProgressRing",
    inputDefs: [
      { name: "progress", type: "number", default: 75, label: "Progress (%)" },
      { name: "ringColor", type: "color", default: "#68ABDF", label: "Ring Color" },
      { name: "label", type: "string", default: "Progress", label: "Label" },
      { name: "ringSize", type: "number", default: 200, label: "Size" },
    ],
    code: `import { Circle, Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, createSignal, easeInOutCubic, tween,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface ProgressRingProps extends NodeProps {
  progress?: SignalValue<number>;
  ringColor?: SignalValue<PossibleColor>;
  label?: SignalValue<string>;
  ringSize?: SignalValue<number>;
}

export class ProgressRing extends Node {
  @initial(75) @signal()
  public declare readonly progress: SimpleSignal<number, this>;

  @initial('#68ABDF') @colorSignal()
  public declare readonly ringColor: ColorSignal<this>;

  @initial('Progress') @signal()
  public declare readonly label: SimpleSignal<string, this>;

  @initial(200) @signal()
  public declare readonly ringSize: SimpleSignal<number, this>;

  private readonly currentProgress = createSignal(0);

  public constructor(props?: ProgressRingProps) {
    super({ ...props });
    this.currentProgress(this.progress());
    const size = this.ringSize();
    const sw = size * 0.12;

    this.add([
      <Circle width={size} height={size} stroke={'#333'} lineWidth={sw} />,
      <Circle
        width={size} height={size}
        stroke={() => this.ringColor()}
        lineWidth={sw}
        startAngle={-90}
        endAngle={() => -90 + (this.currentProgress() / 100) * 360}
        lineCap={'round'}
      />,
      <Txt
        text={() => \`\${Math.round(this.currentProgress())}%\`}
        fill={'#fff'} fontSize={size * 0.28}
        fontFamily={'Inter Variable'} fontWeight={700}
        y={-size * 0.05}
      />,
      <Txt
        text={() => this.label()}
        fill={'#aaa'} fontSize={size * 0.13}
        fontFamily={'Inter Variable'} fontWeight={400}
        y={size * 0.18}
      />,
    ]);
  }

  public *animateIn(duration: number = 1.5): ThreadGenerator {
    const target = this.progress();
    this.currentProgress(0);
    yield* tween(duration, (v) => this.currentProgress(easeInOutCubic(v) * target));
  }
}
`,
  },
  {
    id: "counter",
    name: "Animated Counter",
    description: "Number that counts up from zero to a target value",
    category: "data",
    componentName: "AnimatedCounter",
    inputDefs: [
      { name: "target", type: "number", default: 1000, label: "Target" },
      { name: "prefix", type: "string", default: "", label: "Prefix" },
      { name: "suffix", type: "string", default: "", label: "Suffix" },
      { name: "textColor", type: "color", default: "#ffffff", label: "Color" },
      { name: "textSize", type: "number", default: 64, label: "Font Size" },
      { name: "speed", type: "number", default: 1.5, label: "Duration (s)" },
    ],
    code: `import { Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createSignal, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface AnimatedCounterProps extends NodeProps {
  target?: SignalValue<number>;
  prefix?: SignalValue<string>;
  suffix?: SignalValue<string>;
  textColor?: SignalValue<PossibleColor>;
  textSize?: SignalValue<number>;
  speed?: SignalValue<number>;
}

export class AnimatedCounter extends Node {
  @initial(1000) @signal()
  public declare readonly target: SimpleSignal<number, this>;

  @initial('') @signal()
  public declare readonly prefix: SimpleSignal<string, this>;

  @initial('') @signal()
  public declare readonly suffix: SimpleSignal<string, this>;

  @initial('#ffffff') @colorSignal()
  public declare readonly textColor: ColorSignal<this>;

  @initial(64) @signal()
  public declare readonly textSize: SimpleSignal<number, this>;

  @initial(1.5) @signal()
  public declare readonly speed: SimpleSignal<number, this>;

  private readonly current = createSignal(0);

  public constructor(props?: AnimatedCounterProps) {
    super({ ...props });
    this.add(
      <Txt
        text={() => \`\${this.prefix()}\${Math.round(this.current()).toLocaleString()}\${this.suffix()}\`}
        fill={() => this.textColor()}
        fontSize={() => this.textSize()}
        fontFamily={'Inter Variable'}
        fontWeight={800}
      />,
    );
  }

  public *countUp(duration?: number): ThreadGenerator {
    const t = this.target();
    this.current(0);
    yield* tween(duration ?? this.speed(), (v) => this.current(easeInOutCubic(v) * t));
  }
}
`,
  },

  // ---------------------------------------------------------------------------
  // SHAPE / DECORATIVE
  // ---------------------------------------------------------------------------
  {
    id: "pulsing-dot",
    name: "Pulsing Dot",
    description: "Glowing circle that pulses — live indicator, accent, or bullet",
    category: "shape",
    componentName: "PulsingDot",
    inputDefs: [
      { name: "dotColor", type: "color", default: "#22c55e", label: "Color" },
      { name: "dotSize", type: "number", default: 24, label: "Size" },
    ],
    code: `import { Circle, Node, NodeProps, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, createSignal, loop, tween, easeInOutSine,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface PulsingDotProps extends NodeProps {
  dotColor?: SignalValue<PossibleColor>;
  dotSize?: SignalValue<number>;
}

export class PulsingDot extends Node {
  @initial('#22c55e') @colorSignal()
  public declare readonly dotColor: ColorSignal<this>;

  @initial(24) @signal()
  public declare readonly dotSize: SimpleSignal<number, this>;

  private readonly glow = createRef<Circle>();
  private readonly glowScale = createSignal(1);

  public constructor(props?: PulsingDotProps) {
    super({ ...props });
    const s = this.dotSize();
    this.add([
      <Circle
        ref={this.glow}
        width={s * 2} height={s * 2}
        fill={() => this.dotColor()}
        opacity={0.25}
        scale={() => this.glowScale()}
      />,
      <Circle
        width={s} height={s}
        fill={() => this.dotColor()}
      />,
    ]);
  }

  public *pulse(): ThreadGenerator {
    yield* loop(Infinity, function* (this: PulsingDot) {
      yield* tween(0.8, (v) => this.glowScale(1 + easeInOutSine(v) * 0.6));
      yield* tween(0.8, (v) => this.glowScale(1.6 - easeInOutSine(v) * 0.6));
    }.bind(this));
  }
}
`,
  },
  {
    id: "divider-line",
    name: "Animated Divider",
    description: "Horizontal line that draws itself — section separator",
    category: "shape",
    componentName: "AnimatedDivider",
    inputDefs: [
      { name: "lineColor", type: "color", default: "#ffffff", label: "Color" },
      { name: "lineWidth", type: "number", default: 400, label: "Width" },
      { name: "lineThickness", type: "number", default: 2, label: "Thickness" },
      { name: "speed", type: "number", default: 0.6, label: "Duration (s)" },
    ],
    code: `import { Line, Node, NodeProps, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface AnimatedDividerProps extends NodeProps {
  lineColor?: SignalValue<PossibleColor>;
  lineWidth?: SignalValue<number>;
  lineThickness?: SignalValue<number>;
  speed?: SignalValue<number>;
}

export class AnimatedDivider extends Node {
  @initial('#ffffff') @colorSignal()
  public declare readonly lineColor: ColorSignal<this>;

  @initial(400) @signal()
  public declare readonly lineWidth: SimpleSignal<number, this>;

  @initial(2) @signal()
  public declare readonly lineThickness: SimpleSignal<number, this>;

  @initial(0.6) @signal()
  public declare readonly speed: SimpleSignal<number, this>;

  private readonly line = createRef<Line>();

  public constructor(props?: AnimatedDividerProps) {
    super({ ...props });
    const w = this.lineWidth();
    this.add(
      <Line
        ref={this.line}
        points={[[-w / 2, 0], [w / 2, 0]]}
        stroke={() => this.lineColor()}
        lineWidth={() => this.lineThickness()}
        end={0}
        lineCap={'round'}
      />,
    );
  }

  public *draw(duration?: number): ThreadGenerator {
    this.line().end(0);
    yield* tween(duration ?? this.speed(), (v) => this.line().end(easeInOutCubic(v)));
  }
}
`,
  },

  // ---------------------------------------------------------------------------
  // OVERLAY / LOWER THIRD
  // ---------------------------------------------------------------------------
  {
    id: "lower-third-bar",
    name: "Lower Third Bar",
    description: "Animated name + title bar overlay",
    category: "overlay",
    componentName: "LowerThirdBar",
    inputDefs: [
      { name: "heading", type: "string", default: "Jane Doe", label: "Name" },
      { name: "subtitle", type: "string", default: "CEO & Founder", label: "Title" },
      { name: "accentColor", type: "color", default: "#4285F4", label: "Accent" },
      { name: "barWidth", type: "number", default: 320, label: "Width" },
    ],
    code: `import { Layout, Rect, Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, createSignal, tween, easeInOutCubic, all,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface LowerThirdBarProps extends NodeProps {
  heading?: SignalValue<string>;
  subtitle?: SignalValue<string>;
  accentColor?: SignalValue<PossibleColor>;
  barWidth?: SignalValue<number>;
}

export class LowerThirdBar extends Node {
  @initial('Jane Doe') @signal()
  public declare readonly heading: SimpleSignal<string, this>;

  @initial('CEO & Founder') @signal()
  public declare readonly subtitle: SimpleSignal<string, this>;

  @initial('#4285F4') @colorSignal()
  public declare readonly accentColor: ColorSignal<this>;

  @initial(320) @signal()
  public declare readonly barWidth: SimpleSignal<number, this>;

  private readonly container = createRef<Layout>();
  private readonly accent = createRef<Rect>();
  private readonly clipWidth = createSignal(0);

  public constructor(props?: LowerThirdBarProps) {
    super({ ...props });
    const w = this.barWidth();

    this.add(
      <Layout ref={this.container} layout direction={'column'} gap={0} opacity={0} width={w}>
        <Rect
          ref={this.accent}
          width={() => this.clipWidth()}
          height={4}
          fill={() => this.accentColor()}
          radius={2}
        />
        <Layout layout direction={'column'} gap={2} padding={[10, 0, 8, 0]}>
          <Txt
            text={() => this.heading()}
            fill={'#ffffff'}
            fontSize={22}
            fontFamily={'Inter Variable'}
            fontWeight={700}
          />
          <Txt
            text={() => this.subtitle()}
            fill={'#aaaaaa'}
            fontSize={14}
            fontFamily={'Inter Variable'}
            fontWeight={400}
          />
        </Layout>
      </Layout>,
    );
  }

  public *animateIn(duration: number = 0.8): ThreadGenerator {
    this.container().opacity(0);
    this.clipWidth(0);
    yield* all(
      tween(duration * 0.5, (v) => this.container().opacity(easeInOutCubic(v))),
      tween(duration, (v) => this.clipWidth(easeInOutCubic(v) * this.barWidth())),
    );
  }
}
`,
  },
  {
    id: "callout-badge",
    name: "Callout Badge",
    description: "Rounded pill with icon-style dot and label — great for tags, statuses, CTAs",
    category: "overlay",
    componentName: "CalloutBadge",
    inputDefs: [
      { name: "text", type: "string", default: "NEW", label: "Text" },
      { name: "badgeColor", type: "color", default: "#22c55e", label: "Color" },
      { name: "textSize", type: "number", default: 16, label: "Font Size" },
    ],
    code: `import { Circle, Layout, Rect, Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, createSignal, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface CalloutBadgeProps extends NodeProps {
  text?: SignalValue<string>;
  badgeColor?: SignalValue<PossibleColor>;
  textSize?: SignalValue<number>;
}

export class CalloutBadge extends Node {
  @initial('NEW') @signal()
  public declare readonly text: SimpleSignal<string, this>;

  @initial('#22c55e') @colorSignal()
  public declare readonly badgeColor: ColorSignal<this>;

  @initial(16) @signal()
  public declare readonly textSize: SimpleSignal<number, this>;

  private readonly scaleVal = createSignal(0);

  public constructor(props?: CalloutBadgeProps) {
    super({ ...props });
    this.add(
      <Layout
        layout
        gap={8}
        padding={[8, 18]}
        alignItems={'center'}
        scale={() => this.scaleVal()}
      >
        <Rect
          fill={() => \`\${this.badgeColor()}22\`}
          radius={999}
          padding={[8, 18]}
          layout
          gap={8}
          alignItems={'center'}
        >
          <Circle
            width={10} height={10}
            fill={() => this.badgeColor()}
          />
          <Txt
            text={() => this.text()}
            fill={() => this.badgeColor()}
            fontSize={() => this.textSize()}
            fontFamily={'Inter Variable'}
            fontWeight={700}
          />
        </Rect>
      </Layout>,
    );
  }

  public *popIn(duration: number = 0.4): ThreadGenerator {
    this.scaleVal(0);
    yield* tween(duration, (v) => {
      const t = easeInOutCubic(v);
      this.scaleVal(t > 1 ? 1 : t);
    });
  }
}
`,
  },
];

/** Group templates by category for the picker UI. */
export function groupTemplatesByCategory() {
  const groups: Record<string, ComponentTemplate[]> = {};
  for (const t of COMPONENT_TEMPLATES) {
    (groups[t.category] ??= []).push(t);
  }
  return groups;
}

/** Category labels for display. */
export const CATEGORY_LABELS: Record<string, string> = {
  text: "Text & Typography",
  data: "Data & Charts",
  shape: "Shapes & Decorative",
  overlay: "Overlays & Lower Thirds",
};
