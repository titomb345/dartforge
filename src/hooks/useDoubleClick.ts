import { useCallback, useRef } from 'react';

/**
 * Discriminates single-click from double-click on the same element.
 * Single-click is delayed by `delay` ms; if a second click arrives
 * within that window, only the double-click handler fires.
 */
export function useDoubleClick(
  onClick?: () => void,
  onDoubleClick?: () => void,
  delay = 250,
): (e: React.MouseEvent) => void {
  const timerRef = useRef<number | null>(null);

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (timerRef.current !== null) {
      // Second click within window — double click
      clearTimeout(timerRef.current);
      timerRef.current = null;
      onDoubleClick?.();
    } else {
      // First click — wait for possible second
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onClick?.();
      }, delay);
    }
  }, [onClick, onDoubleClick, delay]);
}
