import React, { useRef } from 'react';
import type { DockSide, PinnablePanel } from '../types';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { cn } from '../lib/cn';
import { PinnedControlsProvider } from '../contexts/PinnedControlsContext';
import { SkillPanel } from './SkillPanel';
import { ChatPanel } from './ChatPanel';
import { CounterPanel } from './CounterPanel';
import { NotesPanel } from './NotesPanel';
import { MapPanel } from './MapPanel';
import { AllocPanel } from './AllocPanel';
import { CurrencyPanel } from './CurrencyPanel';
import { ChatIcon, CounterIcon, TrendingUpIcon, NotesIcon, MapIcon, AllocIcon, CoinIcon } from './icons';
import { useVerticalResize } from '../hooks/useVerticalResize';
import { VerticalResizeHandle } from './VerticalResizeHandle';

export const PANEL_META: Record<PinnablePanel, {
  render: () => React.JSX.Element;
  icon: (size?: number) => React.JSX.Element;
  accent: string;
  label: string;
}> = {
  chat:     { render: () => <ChatPanel mode="pinned" />,    icon: (s) => <ChatIcon size={s} />,       accent: '#8be9fd', label: 'Chat' },
  counter:  { render: () => <CounterPanel mode="pinned" />, icon: (s) => <CounterIcon size={s} />,    accent: '#f59e0b', label: 'Counters' },
  skills:   { render: () => <SkillPanel mode="pinned" />,   icon: (s) => <TrendingUpIcon size={s} />, accent: '#50fa7b', label: 'Skills' },
  notes:    { render: () => <NotesPanel mode="pinned" />,   icon: (s) => <NotesIcon size={s} />,      accent: '#fbbf24', label: 'Notes' },
  map:      { render: () => <MapPanel mode="pinned" />,     icon: (s) => <MapIcon size={s} />,        accent: '#e8a849', label: 'Map' },
  alloc:    { render: () => <AllocPanel mode="pinned" />,   icon: (s) => <AllocIcon size={s} />,      accent: '#e06c75', label: 'Allocations' },
  currency: { render: () => <CurrencyPanel mode="pinned" />, icon: (s) => <CoinIcon size={s} />,      accent: '#cd7f32', label: 'Currency' },
};

/** Height in px of each vertical resize handle (matches h-1 = 4px, same as horizontal ResizeHandle) */
const HANDLE_HEIGHT = 4;

interface PinnedRegionProps {
  side: DockSide;
  panels: PinnablePanel[];
  width: number;
  otherSidePanels: PinnablePanel[];
  onUnpin: (panel: PinnablePanel) => void;
  onSwapSide: (panel: PinnablePanel) => void;
  onSwapWith: (panel: PinnablePanel, target: PinnablePanel) => void;
  onMovePanel: (panel: PinnablePanel, direction: 'up' | 'down') => void;
  heightRatios?: number[];
  onHeightRatiosChange?: (ratios: number[]) => void;
}

export function PinnedRegion({ side, panels, width, otherSidePanels, onUnpin, onSwapSide, onSwapWith, onMovePanel, heightRatios, onHeightRatiosChange }: PinnedRegionProps) {
  const { activePanel } = usePanelContext();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCount = Math.max(0, panels.length - 1);
  const totalHandleGap = handleCount * HANDLE_HEIGHT;

  const { ratios, handleMouseDown, isDragging, dragIndex } = useVerticalResize({
    panelCount: panels.length,
    containerRef,
    handleGap: totalHandleGap,
    savedRatios: heightRatios,
    onRatiosChange: onHeightRatiosChange,
  });

  if (panels.length === 0) return null;

  const canSwapSide = otherSidePanels.length < 3;

  return (
    <div
      ref={containerRef}
      className="flex flex-col relative"
      style={{ width }}
    >
      {panels.map((panelId, i) => {
        const { render } = PANEL_META[panelId];
        // For a single panel, use flex-1. For multiple, use calculated height from ratios.
        const useFlex = panels.length === 1;
        const style: React.CSSProperties = useFlex
          ? { flex: 1, minHeight: 0 }
          : { flex: 'none', height: `calc((100% - ${totalHandleGap}px) * ${ratios[i] ?? (1 / panels.length)})`, minHeight: 0 };
        return (
          <React.Fragment key={panelId}>
            {i > 0 && (
              <VerticalResizeHandle
                index={i - 1}
                onMouseDown={handleMouseDown}
                isDragging={isDragging && dragIndex === i - 1}
              />
            )}
            <div
              className="flex flex-col overflow-hidden rounded-lg bg-bg-primary"
              style={style}
            >
              <PinnedControlsProvider value={{
                side,
                onUnpin: () => onUnpin(panelId),
                onSwapSide: canSwapSide ? () => onSwapSide(panelId) : undefined,
                onMoveUp: i > 0 ? () => onMovePanel(panelId, 'up') : undefined,
                onMoveDown: i < panels.length - 1 ? () => onMovePanel(panelId, 'down') : undefined,
                canMoveUp: i > 0,
                canMoveDown: i < panels.length - 1,
                otherSidePanels: !canSwapSide ? otherSidePanels : undefined,
                onSwapWith: !canSwapSide ? (target: PinnablePanel) => onSwapWith(panelId, target) : undefined,
              }}>
                {render()}
              </PinnedControlsProvider>
            </div>
          </React.Fragment>
        );
      })}
      {/* Blur overlay when a slide-out is open over the right pinned region */}
      {side === 'right' && (
        <div className={cn(
          'absolute inset-0 z-10 backdrop-blur-sm bg-bg-canvas/50 rounded-lg pointer-events-none transition-opacity duration-300',
          activePanel ? 'opacity-100' : 'opacity-0',
        )} />
      )}
    </div>
  );
}
