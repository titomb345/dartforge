import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_FRACTION = 0.15;

function equalRatios(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}

interface UseVerticalResizeOptions {
  panelCount: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Total pixels consumed by resize handles between panels */
  handleGap: number;
  savedRatios?: number[];
  onRatiosChange?: (ratios: number[]) => void;
}

export function useVerticalResize({
  panelCount,
  containerRef,
  handleGap,
  savedRatios,
  onRatiosChange,
}: UseVerticalResizeOptions) {
  const [ratios, setRatiosState] = useState<number[]>(() => {
    if (savedRatios && savedRatios.length === panelCount) return savedRatios;
    return equalRatios(panelCount);
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState(-1);
  const startYRef = useRef(0);
  const startRatiosRef = useRef<number[]>([]);
  const prevCountRef = useRef(panelCount);

  // Reset to equal distribution when panel count changes
  useEffect(() => {
    if (panelCount !== prevCountRef.current) {
      const next = equalRatios(panelCount);
      setRatiosState(next);
      onRatiosChange?.(next);
      prevCountRef.current = panelCount;
    }
  }, [panelCount, onRatiosChange]);

  // Sync from saved ratios on load (only if they match current panel count)
  useEffect(() => {
    if (savedRatios && savedRatios.length === panelCount) {
      setRatiosState(savedRatios);
    }
  }, [savedRatios, panelCount]);

  const handleMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      startRatiosRef.current = [...ratios];
      setDragIndex(index);
      setIsDragging(true);
    },
    [ratios]
  );

  useEffect(() => {
    if (!isDragging || dragIndex < 0) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerHeight = container.clientHeight - handleGap;
      if (containerHeight <= 0) return;

      const deltaY = e.clientY - startYRef.current;
      const deltaFraction = deltaY / containerHeight;

      const next = [...startRatiosRef.current];
      const above = next[dragIndex];
      const below = next[dragIndex + 1];

      let newAbove = above + deltaFraction;
      let newBelow = below - deltaFraction;

      // Enforce minimums
      if (newAbove < MIN_FRACTION) {
        newAbove = MIN_FRACTION;
        newBelow = above + below - MIN_FRACTION;
      }
      if (newBelow < MIN_FRACTION) {
        newBelow = MIN_FRACTION;
        newAbove = above + below - MIN_FRACTION;
      }

      next[dragIndex] = newAbove;
      next[dragIndex + 1] = newBelow;
      setRatiosState(next);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragIndex(-1);
      // Persist on drag end
      setRatiosState((current) => {
        onRatiosChange?.(current);
        return current;
      });
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragIndex, containerRef, handleGap, onRatiosChange]);

  return { ratios, handleMouseDown, isDragging, dragIndex };
}
