export type ClassMode = 'mage' | 'fighter' | 'multi';

export type Panel = 'appearance' | 'skills' | 'chat' | 'counter' | 'aliases' | 'triggers' | 'notes' | 'settings' | 'map';

export type PinnablePanel = 'skills' | 'chat' | 'counter' | 'notes' | 'map';
export type DockSide = 'left' | 'right';

export interface PanelLayout {
  left: PinnablePanel[];
  right: PinnablePanel[];
}

/** Shared props for panels that support pinning/docking. */
export interface PinnablePanelProps {
  mode?: 'slideout' | 'pinned';
  onPin?: (side: DockSide) => void;
  side?: DockSide;
  onUnpin?: () => void;
  onSwapSide?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export type {
  SkillTier,
  SkillRecord,
  CharacterSkillFile,
  SkillMatchResult,
} from './skills';

export interface MudOutputPayload {
  data: string;
  ga: boolean;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  message: string;
}
