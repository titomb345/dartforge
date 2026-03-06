export type ClassMode = 'mage' | 'fighter' | 'multi';

export type AnnounceMode = 'off' | 'on' | 'brief' | 'verbose';

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
  | 'scripts'
  | 'settings'
  // | 'map' // automapper disabled
  | 'alloc'
  | 'currency'
  | 'who'
  | 'babel'
  | 'logs'
  | 'macros'
  | 'help';

export type PinnablePanel =
  | 'skills'
  | 'chat'
  | 'counter'
  | 'notes'
  // | 'map' // automapper disabled
  | 'alloc'
  | 'currency'
  | 'who'
  | 'babel';
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
export type { QuickButtonId, QuickButton } from './quickButton';
export type { MacroId, Macro, HotkeyCombo } from './macro';
export { formatHotkey, hotkeyToString, hotkeyFromEvent, isReservedHotkey, isNumpadKey } from './macro';

export interface MudOutputPayload {
  data: string;
  ga: boolean;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  message: string;
}
