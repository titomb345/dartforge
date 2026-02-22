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

interface PinnedRegionProps {
  side: DockSide;
  panels: PinnablePanel[];
  width: number;
  otherSidePanels: PinnablePanel[];
  onUnpin: (panel: PinnablePanel) => void;
  onSwapSide: (panel: PinnablePanel) => void;
  onSwapWith: (panel: PinnablePanel, target: PinnablePanel) => void;
  onMovePanel: (panel: PinnablePanel, direction: 'up' | 'down') => void;
}

export function PinnedRegion({ side, panels, width, otherSidePanels, onUnpin, onSwapSide, onSwapWith, onMovePanel }: PinnedRegionProps) {
  const { activePanel } = usePanelContext();

  if (panels.length === 0) return null;

  const canSwapSide = otherSidePanels.length < 3;

  return (
    <div
      className="flex flex-col gap-1 relative"
      style={{ width }}
    >
      {panels.map((panelId, i) => {
        const { render } = PANEL_META[panelId];
        return (
          <div
            key={panelId}
            className="flex-1 flex flex-col overflow-hidden min-h-0 rounded-lg bg-bg-primary"
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
