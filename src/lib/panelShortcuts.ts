import type { Panel } from '../types';

/**
 * Keyboard shortcuts for opening (and closing) panels.
 *
 * Ctrl+1 through Ctrl+9 follow the toolbar's Panels group left to right, so
 * the number printed in the corner of a toolbar button is its key. Ctrl+0 is
 * taken by the terminal's font-size reset, so Babel joins the Alt+letter set
 * used by the Tools and App groups. Matched on `code` (physical key) so the
 * digit row works regardless of layout, and never on the numpad, which is
 * reserved for movement.
 */
export interface PanelShortcut {
  panel: Panel;
  mod: 'ctrl' | 'alt';
  /** KeyboardEvent.code */
  code: string;
  /** What to print: the digit or letter */
  key: string;
}

export const PANEL_SHORTCUTS: PanelShortcut[] = [
  { panel: 'who', mod: 'ctrl', code: 'Digit1', key: '1' },
  { panel: 'chat', mod: 'ctrl', code: 'Digit2', key: '2' },
  { panel: 'counter', mod: 'ctrl', code: 'Digit3', key: '3' },
  { panel: 'skills', mod: 'ctrl', code: 'Digit4', key: '4' },
  { panel: 'notes', mod: 'ctrl', code: 'Digit5', key: '5' },
  { panel: 'map', mod: 'ctrl', code: 'Digit6', key: '6' },
  { panel: 'alloc', mod: 'ctrl', code: 'Digit7', key: '7' },
  { panel: 'loadout', mod: 'ctrl', code: 'Digit8', key: '8' },
  { panel: 'currency', mod: 'ctrl', code: 'Digit9', key: '9' },
  { panel: 'babel', mod: 'alt', code: 'KeyB', key: 'B' },
  { panel: 'aliases', mod: 'alt', code: 'KeyA', key: 'A' },
  { panel: 'triggers', mod: 'alt', code: 'KeyT', key: 'T' },
  { panel: 'timers', mod: 'alt', code: 'KeyI', key: 'I' },
  { panel: 'variables', mod: 'alt', code: 'KeyV', key: 'V' },
  { panel: 'macros', mod: 'alt', code: 'KeyM', key: 'M' },
  { panel: 'scripts', mod: 'alt', code: 'KeyC', key: 'C' },
  { panel: 'logs', mod: 'alt', code: 'KeyL', key: 'L' },
  { panel: 'appearance', mod: 'alt', code: 'KeyP', key: 'P' },
  { panel: 'settings', mod: 'alt', code: 'KeyS', key: 'S' },
  { panel: 'help', mod: 'alt', code: 'KeyG', key: 'G' },
];

export function shortcutFor(panel: Panel): PanelShortcut | undefined {
  return PANEL_SHORTCUTS.find((s) => s.panel === panel);
}

/** Human label for tooltips, e.g. "Ctrl+2" or "Alt+T". */
export function shortcutLabel(panel: Panel): string | null {
  const s = shortcutFor(panel);
  if (!s) return null;
  return `${s.mod === 'ctrl' ? 'Ctrl' : 'Alt'}+${s.key}`;
}

/** The panel a keydown asks for, or null if the event is not a panel shortcut. */
export function panelForKeyEvent(e: KeyboardEvent): Panel | null {
  if (e.shiftKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  let mod: 'ctrl' | 'alt';
  if (ctrl && !alt) mod = 'ctrl';
  else if (alt && !ctrl) mod = 'alt';
  else return null;
  const hit = PANEL_SHORTCUTS.find((s) => s.mod === mod && s.code === e.code);
  return hit ? hit.panel : null;
}
