import { Circle, Node, NodeProps, Txt, signal, initial, colorSignal } from '@motion-canvas/2d';
import { SignalValue, SimpleSignal, ColorSignal, PossibleColor, createSignal, easeInOutCubic, tween, type ThreadGenerator } from '@motion-canvas/core';
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
        text={() => `${Math.round(this.currentProgress())}%`}
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
