import type { DockSide, PinnablePanel } from '../types';
import { PinnedControlsProvider } from '../contexts/PinnedControlsContext';
import { SkillPanel } from './SkillPanel';
import { ChatPanel } from './ChatPanel';
import { CounterPanel } from './CounterPanel';
import { NotesPanel } from './NotesPanel';
import { MapPanel } from './MapPanel';

const PANEL_META: Record<PinnablePanel, {
  render: () => React.JSX.Element;
}> = {
  skills: { render: () => <SkillPanel mode="pinned" /> },
  chat: { render: () => <ChatPanel mode="pinned" /> },
  counter: { render: () => <CounterPanel mode="pinned" /> },
  notes: { render: () => <NotesPanel mode="pinned" /> },
  map: { render: () => <MapPanel mode="pinned" /> },
};

interface PinnedRegionProps {
  side: DockSide;
  panels: PinnablePanel[];
  otherSidePanelCount: number;
  onUnpin: (panel: PinnablePanel) => void;
  onSwapSide: (panel: PinnablePanel) => void;
  onMovePanel: (panel: PinnablePanel, direction: 'up' | 'down') => void;
}

export function PinnedRegion({ side, panels, otherSidePanelCount, onUnpin, onSwapSide, onMovePanel }: PinnedRegionProps) {
  if (panels.length === 0) return null;

  const canSwapSide = otherSidePanelCount < 3;

  return (
    <div
      className="flex flex-col gap-1"
      style={{ width: 320 }}
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
            }}>
              {render()}
            </PinnedControlsProvider>
          </div>
        );
      })}
    </div>
  );
}
