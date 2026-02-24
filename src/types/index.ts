export type ClassMode = 'mage' | 'fighter' | 'multi';

export type Panel =
  | 'appearance'
  | 'skills'
  | 'chat'
  | 'counter'
  | 'aliases'
  | 'triggers'
  | 'timers'
  | 'variables'
  | 'notes'
  | 'settings'
  | 'map'
  | 'alloc'
  | 'currency'
  | 'who'
  | 'help';

export type PinnablePanel =
  | 'skills'
  | 'chat'
  | 'counter'
  | 'notes'
  | 'map'
  | 'alloc'
  | 'currency'
  | 'who';
export type DockSide = 'left' | 'right';

export interface PanelLayout {
  left: PinnablePanel[];
  right: PinnablePanel[];
}

/** Shared props for panels that support pinning/docking. */
export interface PinnablePanelProps {
  mode?: 'slideout' | 'pinned';
}

export type { SkillTier, SkillRecord, CharacterSkillFile, SkillMatchResult } from './skills';

export interface MudOutputPayload {
  data: string;
  ga: boolean;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  message: string;
}
