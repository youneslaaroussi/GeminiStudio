/**
 * Polyfill for makeComponent: creates a Motion Canvas component from a function.
 *
 * Use when the AI or user provides a function component (e.g. using createSignal
 * and returning JSX). Not exported by @motion-canvas/core; this helper allows
 * such code to compile and run.
 */

import { Node, type NodeProps } from '@motion-canvas/2d';

export type MakeComponentProps = Record<string, unknown>;

/**
 * Wraps a function (props) => JSX in a class that extends Node so it can be
 * used as a custom component (e.g. in the timeline).
 */
export function makeComponent<P extends MakeComponentProps = MakeComponentProps>(
  fn: (props: P & NodeProps) => Parameters<Node['add']>[0],
): new (props?: P & NodeProps) => Node {
  return class MakeComponentNode extends Node {
    constructor(props?: P & NodeProps) {
      super((props ?? {}) as NodeProps);
      const content = fn({ ...props } as P & NodeProps);
      if (content !== undefined && content !== null) {
        this.add(content);
      }
    }
  } as new (props?: P & NodeProps) => Node;
}
