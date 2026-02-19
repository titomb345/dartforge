export type ClassMode = 'mage' | 'fighter' | 'multi';

export type Panel = 'appearance' | 'skills' | 'chat' | 'counter' | 'aliases' | 'settings';

export type PinnablePanel = 'skills' | 'chat' | 'counter';
export type DockSide = 'left' | 'right';

export interface PanelLayout {
  left: PinnablePanel[];
  right: PinnablePanel[];
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
