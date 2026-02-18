import type { ComponentType } from 'react';
import type { PinnablePanel, DockSide } from '../types';
import { PinnedPanelWrapper } from './PinnedPanelWrapper';
import { SkillPanel } from './SkillPanel';
import { cn } from '../lib/cn';

const PANEL_META: Record<PinnablePanel, { title: string; accent: string; component: ComponentType }> = {
  skills: { title: 'Skills', accent: '#50fa7b', component: () => <SkillPanel mode="pinned" /> },
};

interface PinnedRegionProps {
  side: DockSide;
  panels: PinnablePanel[];
  onUnpin: (panel: PinnablePanel) => void;
  onSwapSide: (panel: PinnablePanel) => void;
}

export function PinnedRegion({ side, panels, onUnpin, onSwapSide }: PinnedRegionProps) {
  if (panels.length === 0) return null;

  return (
    <div
      className={cn(
        'pinned-region flex flex-col overflow-hidden bg-bg-primary',
        side === 'left'
          ? 'pinned-region-left border-r border-border-subtle'
          : 'pinned-region-right border-l border-border-subtle',
      )}
      style={{ width: 320 }}
    >
      {panels.map((panelId, i) => {
        const { title, accent, component: PanelComponent } = PANEL_META[panelId];
        return (
          <div
            key={panelId}
            className={cn(
              'flex-1 flex flex-col overflow-hidden min-h-0',
              i < panels.length - 1 && 'border-b border-border-subtle',
            )}
          >
            <PinnedPanelWrapper
              title={title}
              side={side}
              accent={accent}
              onUnpin={() => onUnpin(panelId)}
              onSwapSide={() => onSwapSide(panelId)}
            >
              <PanelComponent />
            </PinnedPanelWrapper>
          </div>
        );
      })}
    </div>
  );
}
