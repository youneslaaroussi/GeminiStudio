import { Rect, makeScene2D } from '@motion-canvas/2d';
import { all, createRef, easeInOutCubic, useScene, waitFor } from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const square = createRef<Rect>();
  const scene = useScene();
  const squareColor = scene.variables.get('squareColor', '#e13238')();

  view.add(
    <Rect
      ref={square}
      width={120}
      height={120}
      fill={squareColor}
      radius={8}
      x={-300}
    />,
  );

  yield* waitFor(0.2);

  yield* all(
    square().position.x(300, 1.5, easeInOutCubic).to(-300, 1.5, easeInOutCubic),
    square().position.y(150, 1.5, easeInOutCubic).to(-150, 1.5, easeInOutCubic),
  );

  yield* waitFor(0.5);
});
