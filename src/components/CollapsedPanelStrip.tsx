import { useState, useRef, useEffect } from 'react';
import type { DockSide, PinnablePanel } from '../types';
import { PANEL_META } from './PinnedRegion';
import { PinnedControlsProvider } from '../contexts/PinnedControlsContext';
import { cn } from '../lib/cn';

interface CollapsedPanelStripProps {
  side: DockSide;
  panels: PinnablePanel[];
  panelWidth: number;
  otherSidePanels: PinnablePanel[];
  onUnpin: (panel: PinnablePanel) => void;
  onSwapSide: (panel: PinnablePanel) => void;
  onSwapWith: (panel: PinnablePanel, target: PinnablePanel) => void;
  onMovePanel: (panel: PinnablePanel, direction: 'up' | 'down') => void;
  /** Expand back to full panel (only shown for manual collapse, not viewport-forced) */
  onExpand?: () => void;
}

export function CollapsedPanelStrip({
  side,
  panels,
  panelWidth,
  otherSidePanels,
  onUnpin,
  onSwapSide,
  onSwapWith,
  onMovePanel,
  onExpand,
}: CollapsedPanelStripProps) {
  const [openPanel, setOpenPanel] = useState<PinnablePanel | null>(null);
  // Keep the last panel rendered during close animation so content doesn't vanish mid-slide
  const [renderedPanel, setRenderedPanel] = useState<PinnablePanel | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // When opening, update rendered panel immediately. When closing, let transition finish first.
  useEffect(() => {
    if (openPanel) {
      setRenderedPanel(openPanel);
    } else {
      const timer = setTimeout(() => setRenderedPanel(null), 300); // matches transition duration
      return () => clearTimeout(timer);
    }
  }, [openPanel]);

  // Clear overlay if the open panel was removed from this side (e.g. swapped or unpinned)
  useEffect(() => {
    if (openPanel && !panels.includes(openPanel)) setOpenPanel(null);
  }, [openPanel, panels]);

  const canSwapSide = otherSidePanels.length < 3;

  // Close overlay on outside click (ignore portal dropdowns like SwapPicker)
  useEffect(() => {
    if (!openPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target?.closest?.('[data-panel-dropdown]')) return;
      if (
        overlayRef.current &&
        !overlayRef.current.contains(target) &&
        stripRef.current &&
        !stripRef.current.contains(target)
      ) {
        setOpenPanel(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openPanel]);

  const toggleOverlay = (panelId: PinnablePanel) => {
    setOpenPanel((prev) => (prev === panelId ? null : panelId));
  };

  return (
    <div className="relative flex-shrink-0">
      {/* Icon strip */}
      <div
        ref={stripRef}
        className="w-[36px] flex flex-col gap-1 items-center py-1.5 bg-bg-primary rounded-lg self-stretch h-full"
      >
        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand panel"
            className="w-[28px] h-[28px] flex items-center justify-center rounded-[5px] cursor-pointer hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors duration-150 mb-0.5"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d={side === 'left' ? 'M4 1L9 6L4 11' : 'M8 1L3 6L8 11'}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {panels.map((panelId) => {
          const meta = PANEL_META[panelId];
          const isActive = openPanel === panelId;
          return (
            <button
              key={panelId}
              onClick={() => toggleOverlay(panelId)}
              title={meta.label}
              className={cn(
                'w-[28px] h-[28px] flex items-center justify-center rounded-[5px] transition-all duration-150 cursor-pointer',
                'border border-transparent',
                isActive ? 'border-current' : 'hover:bg-white/5'
              )}
              style={{
                color: meta.accent,
                ...(isActive
                  ? {
                      background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
                      filter: `drop-shadow(0 0 4px color-mix(in srgb, ${meta.accent} 40%, transparent))`,
                    }
                  : {}),
              }}
            >
              {meta.icon(13)}
            </button>
          );
        })}
      </div>

      {/* Clip container — hides the overlay behind the icon strip edge */}
      <div
        className={cn(
          'absolute top-0 bottom-0 z-[90] overflow-hidden',
          side === 'left' ? 'left-[40px]' : 'right-[40px]',
          !openPanel && 'pointer-events-none'
        )}
        style={{ width: panelWidth }}
      >
        {/* Overlay panel — slides in/out from the icon strip edge */}
        <div
          ref={overlayRef}
          className={cn(
            'h-full transition-transform duration-300 ease-in-out',
            openPanel
              ? 'translate-x-0'
              : side === 'left'
                ? '-translate-x-full pointer-events-none'
                : 'translate-x-full pointer-events-none'
          )}
        >
          {renderedPanel &&
            (() => {
              const meta = PANEL_META[renderedPanel];
              const i = panels.indexOf(renderedPanel);
              return (
                <div className="h-full flex flex-col rounded-lg bg-bg-primary overflow-hidden shadow-xl shadow-black/30 border border-border-subtle">
                  <PinnedControlsProvider
                    value={{
                      side,
                      onUnpin: () => {
                        setOpenPanel(null);
                        onUnpin(renderedPanel);
                      },
                      onSwapSide: canSwapSide
                        ? () => {
                            setOpenPanel(null);
                            onSwapSide(renderedPanel);
                          }
                        : undefined,
                      onMoveUp: i > 0 ? () => onMovePanel(renderedPanel, 'up') : undefined,
                      onMoveDown:
                        i < panels.length - 1
                          ? () => onMovePanel(renderedPanel, 'down')
                          : undefined,
                      canMoveUp: i > 0,
                      canMoveDown: i < panels.length - 1,
                      otherSidePanels: !canSwapSide ? otherSidePanels : undefined,
                      onSwapWith: !canSwapSide
                        ? (target: PinnablePanel) => {
                            setOpenPanel(null);
                            onSwapWith(renderedPanel, target);
                          }
                        : undefined,
                    }}
                  >
                    {meta.render()}
                  </PinnedControlsProvider>
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
