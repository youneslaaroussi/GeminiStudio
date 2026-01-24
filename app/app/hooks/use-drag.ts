import { useCallback, useEffect, useState } from 'react';

interface MoveCallback {
  (dx: number, dy: number, x: number, y: number): void;
}

interface DropCallback {
  (event: MouseEvent): void;
}

export function useDrag(
  onMove: MoveCallback,
  onDrop?: DropCallback,
  button: number | null = 0
): [(event: React.MouseEvent | MouseEvent) => void, boolean] {
  const [isDragging, setDragging] = useState(false);
  const [startPosition, setStartPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleUp = (event: MouseEvent) => {
      if (isDragging) {
        event.stopPropagation();
        setDragging(false);
        onDrop?.(event);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (isDragging) {
        event.stopPropagation();
      }
    };

    const handleMove = (event: MouseEvent) => {
      if (isDragging) {
        onMove(
          event.clientX - startPosition.x,
          event.clientY - startPosition.y,
          event.clientX,
          event.clientY
        );
        setStartPosition({ x: event.clientX, y: event.clientY });
      }
    };

    if (isDragging) {
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('click', handleClick, { capture: true });
      document.addEventListener('mousemove', handleMove);
    }

    return () => {
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('click', handleClick, { capture: true });
      document.removeEventListener('mousemove', handleMove);
    };
  }, [isDragging, onDrop, onMove, startPosition]);

  const handleDrag = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      if (button !== null && event.button !== button) return;
      event.preventDefault();
      event.stopPropagation();
      setStartPosition({ x: event.clientX, y: event.clientY });
      setDragging(true);
    },
    [button]
  );

  return [handleDrag, isDragging];
}
