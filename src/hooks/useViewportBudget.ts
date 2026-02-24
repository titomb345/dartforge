import { useLayoutEffect, useState } from 'react';
import type { PanelLayout } from '../types';

const MIN_TERMINAL_WIDTH = 700;
const MIN_PANEL_WIDTH = 300;
export { MIN_TERMINAL_WIDTH };

interface ViewportBudget {
  effectiveLeftWidth: number;
  effectiveRightWidth: number;
  maxLeftWidth: number;
  maxRightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export function useViewportBudget(
  pinnedWidths: { left: number; right: number },
  panelLayout: PanelLayout
): ViewportBudget {
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);

  useLayoutEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hasLeft = panelLayout.left.length > 0;
  const hasRight = panelLayout.right.length > 0;

  const desiredLeft = hasLeft ? pinnedWidths.left : 0;
  const desiredRight = hasRight ? pinnedWidths.right : 0;

  // Gaps: base padding (8) + per-side gap for resize handle area (8 each)
  const gapsForSides = (hasLeft ? 8 : 0) + (hasRight ? 8 : 0);
  const baseGap = 8;
  const available = viewportWidth - baseGap - gapsForSides;

  let effectiveLeft = desiredLeft;
  let effectiveRight = desiredRight;
  let leftCollapsed = false;
  let rightCollapsed = false;

  const terminalBudget = available - effectiveLeft - effectiveRight;

  if (terminalBudget < MIN_TERMINAL_WIDTH && (hasLeft || hasRight)) {
    if (hasLeft && hasRight) {
      // Both sides pinned — collapse both to icon strips simultaneously
      effectiveLeft = 0;
      effectiveRight = 0;
      leftCollapsed = true;
      rightCollapsed = true;
    } else {
      // Only one side pinned — shrink it, but collapse if it would go below minimum
      const maxForPanel = available - MIN_TERMINAL_WIDTH;
      if (maxForPanel < MIN_PANEL_WIDTH) {
        effectiveLeft = 0;
        effectiveRight = 0;
        leftCollapsed = hasLeft;
        rightCollapsed = hasRight;
      } else {
        if (hasLeft) effectiveLeft = Math.min(desiredLeft, maxForPanel);
        if (hasRight) effectiveRight = Math.min(desiredRight, maxForPanel);
      }
    }
  }

  // Dynamic max for resize handles: prevent dragging wider than viewport allows
  const otherLeft = hasRight ? effectiveRight : 0;
  const otherRight = hasLeft ? effectiveLeft : 0;
  const currentAvailable = viewportWidth - baseGap - gapsForSides;
  const maxLeftWidth = hasLeft
    ? Math.max(MIN_PANEL_WIDTH, currentAvailable - otherLeft - MIN_TERMINAL_WIDTH)
    : 0;
  const maxRightWidth = hasRight
    ? Math.max(MIN_PANEL_WIDTH, currentAvailable - otherRight - MIN_TERMINAL_WIDTH)
    : 0;

  return {
    effectiveLeftWidth: effectiveLeft,
    effectiveRightWidth: effectiveRight,
    maxLeftWidth: Math.min(600, maxLeftWidth),
    maxRightWidth: Math.min(600, maxRightWidth),
    leftCollapsed,
    rightCollapsed,
  };
}
