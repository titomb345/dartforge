import { useRef, useEffect } from 'react';
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
 * Closes on outside click while letting the click pass through to the target.
 */
export function SlideOut({ panel, pinnable, children }: SlideOutProps) {
  const { activePanel, togglePanel, isPinned } = usePanelContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const isPinnedPanel = pinnable != null && isPinned(pinnable);
  const isOpen = !isPinnedPanel && activePanel === panel;

  // Close on outside click — mousedown so the click still reaches its target
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      // Ignore clicks on the spotlight overlay (portal on document.body)
      if ((e.target as Element)?.closest?.('.spotlight-overlay')) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        togglePanel(panel);
        // Only swallow the click if it landed on THIS panel's own toolbar button,
        // to prevent the toggle from immediately re-opening it. Clicks on other
        // panel buttons pass through so they open the new panel in one click.
        const targetBtn = (e.target as Element)?.closest?.('button[data-panel]');
        if (targetBtn && targetBtn.getAttribute('data-panel') === panel) {
          document.addEventListener('click', (ev) => ev.stopPropagation(), {
            capture: true,
            once: true,
          });
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, panel, togglePanel]);

  if (isPinnedPanel) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {children}
    </div>
  );
}
