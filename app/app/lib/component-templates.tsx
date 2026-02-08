/**
 * Premade Motion Canvas component templates.
 *
 * Each template includes the full TSX source, the exported class name,
 * input definitions, and metadata for the template picker UI.
 */

import type { ComponentInputDef } from "@/app/types/assets";
import type { ReactNode } from "react";
import { AFRICA_PATH } from "@/app/lib/geo/africa-path";

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
  /** Inline SVG/CSS preview for the template picker (viewBox 0 0 72 40) */
  preview?: () => ReactNode;
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
    preview: () => (
      <svg viewBox="0 0 72 40" className="w-full h-full">
        <text x="6" y="24" fontSize="11" fontFamily="monospace" fontWeight="600" fill="#fff">Hello_</text>
        <rect x="47" y="14" width="7" height="13" fill="#68ABDF" opacity="0.8">
          <animate attributeName="opacity" values="0.8;0;0.8" dur="1s" repeatCount="indefinite" />
        </rect>
      </svg>
    ),
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
    const dur = (duration != null && duration > 0)
      ? duration
      : this.fullText().length * this.charDelay();
    yield* tween(dur, (v) => this.progress(easeInOutCubic(v)));
  }

  /** Timeline entry point — calls reveal. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.reveal(duration);
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
    preview: () => (
      <svg viewBox="0 0 72 40" className="w-full h-full">
        <circle cx="36" cy="20" r="14" fill="none" stroke="#333" strokeWidth="3" />
        <circle cx="36" cy="20" r="14" fill="none" stroke="#68ABDF" strokeWidth="3" strokeLinecap="round" strokeDasharray="66" strokeDashoffset="16.5" transform="rotate(-90 36 20)" />
        <text x="36" y="23" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="#fff" textAnchor="middle">75%</text>
      </svg>
    ),
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

  /** Timeline entry point — calls animateIn. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.animateIn(duration ?? 1.5);
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
    preview: () => (
      <svg viewBox="0 0 72 40" className="w-full h-full">
        <text x="36" y="26" fontSize="18" fontFamily="sans-serif" fontWeight="800" fill="#fff" textAnchor="middle">1,000</text>
        <text x="36" y="35" fontSize="6" fontFamily="sans-serif" fill="#666" textAnchor="middle">counting up</text>
      </svg>
    ),
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

  /** Called by the timeline; counts up from 0 to target over the clip duration. */
  public *animateIn(duration?: number): ThreadGenerator {
    yield* this.countUp(duration);
  }

  /** Timeline entry point — calls animateIn. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.animateIn(duration);
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
    preview: () => (
      <svg viewBox="0 0 72 40" className="w-full h-full">
        <circle cx="36" cy="20" r="10" fill="#22c55e" opacity="0.2">
          <animate attributeName="r" values="10;16;10" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.25;0.08;0.25" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="36" cy="20" r="6" fill="#22c55e" />
      </svg>
    ),
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

const PULSE_CYCLE = 1.6;

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

  /** Pulse for the given duration (finite cycles); used by the timeline. */
  public *animateIn(duration: number = 2): ThreadGenerator {
    const cycles = Math.max(1, Math.ceil(duration / PULSE_CYCLE));
    yield* loop(cycles, function* (this: PulsingDot) {
      yield* tween(0.8, (v) => this.glowScale(1 + easeInOutSine(v) * 0.6));
      yield* tween(0.8, (v) => this.glowScale(1.6 - easeInOutSine(v) * 0.6));
    }.bind(this));
  }

  /** Timeline entry point — calls animateIn. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.animateIn(duration ?? 2);
  }
}
`,
  },

  // ---------------------------------------------------------------------------
  // WORLD MAP (Mercator + animated region outline)
  // ---------------------------------------------------------------------------
  {
    id: "world-map-africa-outline",
    name: "World Map (Africa Outline)",
    description: "Mercator-style world map with animated outline around Africa",
    category: "shape",
    componentName: "WorldMapAfricaOutline",
    preview: () => (
      <svg viewBox="-200 -100 400 200" className="w-full h-full">
        <rect x={-200} y={-100} width={400} height={200} fill="#1a365d" />
        <path d={AFRICA_PATH} fill="none" stroke="#68ABDF" strokeWidth={4} />
      </svg>
    ),
    inputDefs: [
      { name: "mapWidth", type: "number", default: 480, label: "Map Width" },
      { name: "outlineColor", type: "color", default: "#68ABDF", label: "Outline Color" },
      { name: "outlineWidth", type: "number", default: 3, label: "Outline Width" },
      { name: "oceanColor", type: "color", default: "#1a365d", label: "Ocean Color" },
    ],
    code: `import { Node, NodeProps, Rect, Path, signal, initial, colorSignal } from '@motion-canvas/2d';
import {
  SignalValue, SimpleSignal, ColorSignal, PossibleColor,
  createRef, tween, easeInOutCubic,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface WorldMapAfricaOutlineProps extends NodeProps {
  mapWidth?: SignalValue<number>;
  outlineColor?: SignalValue<PossibleColor>;
  outlineWidth?: SignalValue<number>;
  oceanColor?: SignalValue<PossibleColor>;
}

// Natural Earth 110m, Mercator. Regenerate: node scripts/generate-africa-path.mjs
const AFRICA_PATH = ${JSON.stringify(AFRICA_PATH)};

export class WorldMapAfricaOutline extends Node {
  @initial(480) @signal()
  public declare readonly mapWidth: SimpleSignal<number, this>;

  @initial('#68ABDF') @colorSignal()
  public declare readonly outlineColor: ColorSignal<this>;

  @initial(3) @signal()
  public declare readonly outlineWidth: SimpleSignal<number, this>;

  @initial('#1a365d') @colorSignal()
  public declare readonly oceanColor: ColorSignal<this>;

  private readonly africaPath = createRef<Path>();

  public constructor(props?: WorldMapAfricaOutlineProps) {
    super({ ...props });
    const w = this.mapWidth();
    const h = w / 2;

    this.add([
      <Rect
        width={w}
        height={h}
        fill={() => this.oceanColor()}
        stroke={'#2d3748'}
        lineWidth={2}
        radius={4}
      />,
      <Path
        ref={this.africaPath}
        data={AFRICA_PATH}
        stroke={() => this.outlineColor()}
        lineWidth={() => this.outlineWidth()}
        fill={null}
        lineCap={'round'}
        lineJoin={'round'}
        end={0}
        scale={w / 400}
      />,
    ]);
  }

  /** Animate drawing the outline around Africa. */
  public *animateIn(duration: number = 2): ThreadGenerator {
    this.africaPath().end(0);
    yield* this.africaPath().end(1, duration, easeInOutCubic);
  }

  /** Timeline entry point — calls animateIn. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.animateIn(duration ?? 2);
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
    preview: () => (
      <svg viewBox="0 0 72 40" className="w-full h-full">
        <rect x="6" y="12" width="32" height="3" rx="1.5" fill="#4285F4" />
        <text x="6" y="24" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="#fff">Jane Doe</text>
        <text x="6" y="32" fontSize="6" fontFamily="sans-serif" fill="#888">CEO &amp; Founder</text>
      </svg>
    ),
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

  /** Timeline entry point — calls animateIn. */
  public *animate(duration?: number): ThreadGenerator {
    yield* this.animateIn(duration ?? 0.8);
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
