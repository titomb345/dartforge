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
}: CollapsedPanelStripProps) {
  const [openPanel, setOpenPanel] = useState<PinnablePanel | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

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
        overlayRef.current && !overlayRef.current.contains(target) &&
        stripRef.current && !stripRef.current.contains(target)
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
                isActive
                  ? 'border-current'
                  : 'hover:bg-white/5',
              )}
              style={{
                color: meta.accent,
                ...(isActive ? {
                  background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
                  filter: `drop-shadow(0 0 4px color-mix(in srgb, ${meta.accent} 40%, transparent))`,
                } : {}),
              }}
            >
              {meta.icon(13)}
            </button>
          );
        })}
      </div>

      {/* Overlay panel */}
      {openPanel && (() => {
        const meta = PANEL_META[openPanel];
        const i = panels.indexOf(openPanel);
        return (
          <div
            ref={overlayRef}
            className={cn(
              'absolute top-0 bottom-0 z-[90] transition-transform duration-200 ease-out',
              side === 'left' ? 'left-[40px]' : 'right-[40px]',
            )}
            style={{ width: panelWidth }}
          >
            <div className="h-full flex flex-col rounded-lg bg-bg-primary overflow-hidden shadow-xl shadow-black/30 border border-border-subtle">
              <PinnedControlsProvider value={{
                side,
                onUnpin: () => { setOpenPanel(null); onUnpin(openPanel); },
                onSwapSide: canSwapSide ? () => { setOpenPanel(null); onSwapSide(openPanel); } : undefined,
                onMoveUp: i > 0 ? () => onMovePanel(openPanel, 'up') : undefined,
                onMoveDown: i < panels.length - 1 ? () => onMovePanel(openPanel, 'down') : undefined,
                canMoveUp: i > 0,
                canMoveDown: i < panels.length - 1,
                otherSidePanels: !canSwapSide ? otherSidePanels : undefined,
                onSwapWith: !canSwapSide ? (target: PinnablePanel) => { setOpenPanel(null); onSwapWith(openPanel, target); } : undefined,
              }}>
                {meta.render()}
              </PinnedControlsProvider>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
