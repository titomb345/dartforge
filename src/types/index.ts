export type ClassMode = 'mage' | 'fighter' | 'multi';

export type Panel = 'appearance' | 'skills' | 'chat' | 'settings';

export type PinnablePanel = 'skills' | 'chat';
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
