import type { ITheme } from '@xterm/xterm';

/** The subset of ITheme keys that represent the 16 ANSI colors + bg/fg */
export type ThemeColorKey =
  | 'background'
  | 'foreground'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

export type TerminalTheme = Record<ThemeColorKey, string>;

export const DEFAULT_THEME: TerminalTheme = {
  background: '#000000',
  foreground: '#c0c0c0',
  black: '#000000',
  red: '#8b0000',
  green: '#008000',
  yellow: '#ff8c00',
  blue: '#1e90ff',
  magenta: '#800080',
  cyan: '#008b8b',
  white: '#c0c0c0',
  brightBlack: '#808080',
  brightRed: '#ff0000',
  brightGreen: '#00ff00',
  brightYellow: '#ffff00',
  brightBlue: '#0000ff',
  brightMagenta: '#ff00ff',
  brightCyan: '#00ffff',
  brightWhite: '#ffffff',
};

/** Metadata for color settings UI */
export const THEME_COLOR_META: { key: ThemeColorKey; label: string; group: 'base' | 'normal' | 'bright' }[] = [
  { key: 'background', label: 'Background', group: 'base' },
  { key: 'foreground', label: 'Foreground', group: 'base' },
  { key: 'black', label: 'Black', group: 'normal' },
  { key: 'red', label: 'Red', group: 'normal' },
  { key: 'green', label: 'Green', group: 'normal' },
  { key: 'yellow', label: 'Yellow', group: 'normal' },
  { key: 'blue', label: 'Blue', group: 'normal' },
  { key: 'magenta', label: 'Magenta', group: 'normal' },
  { key: 'cyan', label: 'Cyan', group: 'normal' },
  { key: 'white', label: 'White', group: 'normal' },
  { key: 'brightBlack', label: 'Bright Black', group: 'bright' },
  { key: 'brightRed', label: 'Bright Red', group: 'bright' },
  { key: 'brightGreen', label: 'Bright Green', group: 'bright' },
  { key: 'brightYellow', label: 'Bright Yellow', group: 'bright' },
  { key: 'brightBlue', label: 'Bright Blue', group: 'bright' },
  { key: 'brightMagenta', label: 'Bright Magenta', group: 'bright' },
  { key: 'brightCyan', label: 'Bright Cyan', group: 'bright' },
  { key: 'brightWhite', label: 'Bright White', group: 'bright' },
];

/** Build a full ITheme from our customizable colors */
export function buildXtermTheme(colors: TerminalTheme): ITheme {
  return {
    ...colors,
    cursor: '#000000',
    cursorAccent: '#000000',
    selectionBackground: '#3e4452',
  };
}
