export type MacroId = string;

export interface HotkeyCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface Macro {
  id: MacroId;
  name: string;
  hotkey: HotkeyCombo;
  body: string;
  bodyMode: 'commands' | 'script';
  enabled: boolean;
}

/** Format a hotkey combo for display, e.g. "Ctrl+Alt+F5" */
export function formatHotkey(h: HotkeyCombo): string {
  const parts: string[] = [];
  if (h.ctrl) parts.push('Ctrl');
  if (h.alt) parts.push('Alt');
  if (h.shift) parts.push('Shift');
  parts.push(prettyKeyName(h.key));
  return parts.join('+');
}

function prettyKeyName(key: string): string {
  // Function keys
  if (/^F\d+$/.test(key)) return key;
  // Single character
  if (key.length === 1) return key.toUpperCase();
  // Named keys
  const map: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
  };
  if (key in map) return map[key];
  // Strip "Key" / "Digit" prefix from event.code values
  if (key.startsWith('Key')) return key.slice(3);
  if (key.startsWith('Digit')) return key.slice(5);
  return key;
}

/** Build a canonical string key for lookup, e.g. "ctrl+alt+f5" */
export function hotkeyToString(h: HotkeyCombo): string {
  const parts: string[] = [];
  if (h.ctrl) parts.push('ctrl');
  if (h.alt) parts.push('alt');
  if (h.shift) parts.push('shift');
  parts.push(h.key.toLowerCase());
  return parts.join('+');
}

/** Build a HotkeyCombo from a keyboard event. Returns null for modifier-only keys. */
export function hotkeyFromEvent(e: KeyboardEvent): HotkeyCombo | null {
  // Ignore bare modifier presses
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  return {
    key: e.code || e.key,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
  };
}

/** Reserved combos that cannot be bound */
const RESERVED = new Set([
  'ctrl+c',         // copy
  'ctrl+f',         // search
  'ctrl+shift+s',   // screenshot
  'ctrl+equal',     // zoom in
  'ctrl+minus',     // zoom out
  'ctrl+digit0',    // zoom reset
  'tab',
  'escape',
  'enter',
  'shift+enter',
  'arrowup',
  'arrowdown',
]);

export function isReservedHotkey(h: HotkeyCombo): boolean {
  return RESERVED.has(hotkeyToString(h));
}

/** Check if a hotkey overlaps with numpad keys */
export function isNumpadKey(code: string): boolean {
  return code.startsWith('Numpad');
}
