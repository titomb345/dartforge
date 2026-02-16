export type ClassMode = 'mage' | 'fighter' | 'multi';

export type {
  SkillTier,
  SkillRecord,
  CharacterSkillFile,
  SkillMatchResult,
} from './skills';

export interface MudOutputPayload {
  data: string;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  message: string;
}
