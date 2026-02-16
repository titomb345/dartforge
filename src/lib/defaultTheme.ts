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
  foreground: '#b0b8c0',
  black: '#000000',
  red: '#a83030',
  green: '#30a830',
  yellow: '#a8a830',
  blue: '#3040a8',
  magenta: '#8828a0',
  cyan: '#30a8a8',
  white: '#a8b0b4',
  brightBlack: '#506068',
  brightRed: '#d85050',
  brightGreen: '#50d850',
  brightYellow: '#d8d850',
  brightBlue: '#5060d8',
  brightMagenta: '#c050c8',
  brightCyan: '#50d8d8',
  brightWhite: '#d8e0e4',
};

/** Metadata for color settings UI */
export const THEME_COLOR_META: { key: ThemeColorKey; label: string; group: 'base' | 'normal' | 'bright' }[] = [
  { key: 'background', label: 'Background', group: 'base' },
  { key: 'foreground', label: 'Foreground', group: 'base' },
  { key: 'black', label: 'Black (0)', group: 'normal' },
  { key: 'red', label: 'Red (1)', group: 'normal' },
  { key: 'green', label: 'Green (2)', group: 'normal' },
  { key: 'yellow', label: 'Yellow (3)', group: 'normal' },
  { key: 'blue', label: 'Blue (4)', group: 'normal' },
  { key: 'magenta', label: 'Magenta (5)', group: 'normal' },
  { key: 'cyan', label: 'Cyan (6)', group: 'normal' },
  { key: 'white', label: 'White (7)', group: 'normal' },
  { key: 'brightBlack', label: 'Bright Black (8)', group: 'bright' },
  { key: 'brightRed', label: 'Bright Red (9)', group: 'bright' },
  { key: 'brightGreen', label: 'Bright Green (10)', group: 'bright' },
  { key: 'brightYellow', label: 'Bright Yellow (11)', group: 'bright' },
  { key: 'brightBlue', label: 'Bright Blue (12)', group: 'bright' },
  { key: 'brightMagenta', label: 'Bright Magenta (13)', group: 'bright' },
  { key: 'brightCyan', label: 'Bright Cyan (14)', group: 'bright' },
  { key: 'brightWhite', label: 'Bright White (15)', group: 'bright' },
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
