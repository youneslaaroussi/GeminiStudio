import {
  Circle,
  Node,
  NodeProps,
  Txt,
  signal,
  initial,
  colorSignal,
} from '@motion-canvas/2d';
import {
  SignalValue,
  SimpleSignal,
  createRef,
  createSignal,
  easeInOutCubic,
  tween,
  type ThreadGenerator,
  ColorSignal,
  PossibleColor,
} from '@motion-canvas/core';

export interface ProgressRingProps extends NodeProps {
  /** Progress value 0–100 */
  progress?: SignalValue<number>;
  /** Ring color */
  ringColor?: SignalValue<PossibleColor>;
  /** Label text */
  label?: SignalValue<string>;
  /** Ring size (diameter) */
  ringSize?: SignalValue<number>;
}

/**
 * An animated progress ring with a percentage label.
 * Demonstrates a custom Motion Canvas component with signal-based inputs.
 */
export class ProgressRing extends Node {
  @initial(75)
  @signal()
  public declare readonly progress: SimpleSignal<number, this>;

  @initial('#68ABDF')
  @colorSignal()
  public declare readonly ringColor: ColorSignal<this>;

  @initial('Progress')
  @signal()
  public declare readonly label: SimpleSignal<string, this>;

  @initial(200)
  @signal()
  public declare readonly ringSize: SimpleSignal<number, this>;

  private readonly currentProgress = createSignal(0);
  private readonly percentRef = createRef<Txt>();
  private readonly labelRef = createRef<Txt>();

  public constructor(props?: ProgressRingProps) {
    super({ ...props });

    // Initialize currentProgress to the target value so it shows immediately.
    // animateIn() can optionally tween from 0 for entrance animation.
    this.currentProgress(this.progress());

    const size = this.ringSize();
    const strokeWidth = size * 0.12;

    this.add([
      // Background ring
      <Circle
        width={size}
        height={size}
        stroke={'#333333'}
        lineWidth={strokeWidth}
      />,
      // Progress ring
      <Circle
        width={size}
        height={size}
        stroke={() => this.ringColor()}
        lineWidth={strokeWidth}
        startAngle={-90}
        endAngle={() => -90 + (this.currentProgress() / 100) * 360}
        lineCap={'round'}
      />,
      // Percentage text
      <Txt
        ref={this.percentRef}
        text={() => `${Math.round(this.currentProgress())}%`}
        fill={'#ffffff'}
        fontSize={size * 0.28}
        fontFamily={'Inter Variable'}
        fontWeight={700}
        y={-size * 0.05}
      />,
      // Label text
      <Txt
        ref={this.labelRef}
        text={() => this.label()}
        fill={'#aaaaaa'}
        fontSize={size * 0.13}
        fontFamily={'Inter Variable'}
        fontWeight={400}
        y={size * 0.18}
      />,
    ]);
  }

  /**
   * Animate the progress ring from 0 to the target value.
   */
  public *animateIn(duration: number = 1.5): ThreadGenerator {
    const target = this.progress();
    this.currentProgress(0);
    yield* tween(duration, (value) => {
      this.currentProgress(easeInOutCubic(value) * target);
    });
  }
}
