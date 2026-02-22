export type ClassMode = 'mage' | 'fighter' | 'multi';

export type Panel = 'appearance' | 'skills' | 'chat' | 'counter' | 'aliases' | 'triggers' | 'variables' | 'notes' | 'settings' | 'map' | 'alloc' | 'currency' | 'help';

export type PinnablePanel = 'skills' | 'chat' | 'counter' | 'notes' | 'map' | 'alloc' | 'currency';
export type DockSide = 'left' | 'right';

export interface PanelLayout {
  left: PinnablePanel[];
  right: PinnablePanel[];
}

/** Shared props for panels that support pinning/docking. */
export interface PinnablePanelProps {
  mode?: 'slideout' | 'pinned';
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
