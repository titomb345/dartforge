import type React from 'react';
import type { DockSide, PinnablePanel } from '../types';
import { SkillPanel } from './SkillPanel';
import { ChatPanel } from './ChatPanel';
import { CounterPanel } from './CounterPanel';


interface PinnedPanelRenderProps {
  side: DockSide;
  onUnpin: () => void;
  onSwapSide: () => void;
  canSwapSide: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const PANEL_META: Record<PinnablePanel, {
  render: (props: PinnedPanelRenderProps) => React.JSX.Element;
}> = {
  skills: {
    render: (props) => (
      <SkillPanel
        mode="pinned"
        side={props.side}
        onUnpin={props.onUnpin}
        onSwapSide={props.canSwapSide ? props.onSwapSide : undefined}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
        canMoveUp={props.canMoveUp}
        canMoveDown={props.canMoveDown}
      />
    ),
  },
  chat: {
    render: (props) => (
      <ChatPanel
        mode="pinned"
        side={props.side}
        onUnpin={props.onUnpin}
        onSwapSide={props.canSwapSide ? props.onSwapSide : undefined}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
        canMoveUp={props.canMoveUp}
        canMoveDown={props.canMoveDown}
      />
    ),
  },
  counter: {
    render: (props) => (
      <CounterPanel
        mode="pinned"
        side={props.side}
        onUnpin={props.onUnpin}
        onSwapSide={props.canSwapSide ? props.onSwapSide : undefined}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
        canMoveUp={props.canMoveUp}
        canMoveDown={props.canMoveDown}
      />
    ),
  },
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
            {render({
              side,
              onUnpin: () => onUnpin(panelId),
              onSwapSide: () => onSwapSide(panelId),
              canSwapSide,
              onMoveUp: i > 0 ? () => onMovePanel(panelId, 'up') : undefined,
              onMoveDown: i < panels.length - 1 ? () => onMovePanel(panelId, 'down') : undefined,
              canMoveUp: i > 0,
              canMoveDown: i < panels.length - 1,
            })}
          </div>
        );
      })}
    </div>
  );
}
