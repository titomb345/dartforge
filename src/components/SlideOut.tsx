import type { Panel, PinnablePanel } from '../types';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { cn } from '../lib/cn';

interface SlideOutProps {
  panel: Panel;
  pinnable?: PinnablePanel;
  children: React.ReactNode;
}

/**
 * Wrapper for slide-out panels. Handles the absolute positioning, show/hide
 * transition, and auto-hiding when the panel is pinned.
 */
export function SlideOut({ panel, pinnable, children }: SlideOutProps) {
  const { activePanel, isPinned } = usePanelContext();
  const isPinnedPanel = pinnable != null && isPinned(pinnable);
  const isOpen = !isPinnedPanel && activePanel === panel;

  if (isPinnedPanel) return null;

  return (
    <div
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {children}
    </div>
  );
}
