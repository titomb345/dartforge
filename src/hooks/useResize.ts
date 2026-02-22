import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizeOptions {
  side: 'left' | 'right';
  initialWidth: number;
  min?: number;
  max?: number;
  onWidthChange: (width: number) => void;
}

export function useResize({
  side,
  initialWidth,
  min = 300,
  max = 600,
  onWidthChange,
}: UseResizeOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = initialWidth;
      setIsDragging(true);
    },
    [initialWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = side === 'left'
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;
      const newWidth = Math.round(Math.min(max, Math.max(min, startWidthRef.current + delta)));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, side, min, max, onWidthChange]);

  return { handleMouseDown, isDragging };
}
