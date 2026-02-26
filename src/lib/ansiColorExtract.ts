import type { ThemeColorKey } from './defaultTheme';

// ---------------------------------------------------------------------------
// ANSI SGR → ThemeColorKey mapping
// ---------------------------------------------------------------------------

const ANSI_BASE: ThemeColorKey[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];
const ANSI_BRIGHT: ThemeColorKey[] = [
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

/** Convert raw ANSI SGR parameter string (e.g. "1;32") to a ThemeColorKey. */
export function ansiParamsToThemeKey(params: string): ThemeColorKey | null {
  const parts = params.split(';').map(Number);
  let bold = false;
  let fg = -1;

  for (const p of parts) {
    if (p === 0) {
      bold = false;
      fg = -1;
    } else if (p === 1) {
      bold = true;
    } else if (p >= 30 && p <= 37) {
      fg = p - 30;
    } else if (p >= 90 && p <= 97) {
      fg = p - 90;
      bold = true;
    }
  }

  if (fg < 0) return null;
  return bold ? ANSI_BRIGHT[fg] : ANSI_BASE[fg];
}

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/**
 * Extract the ANSI color active at the position of `target` in the raw line.
 * Walks the raw line tracking visible character position and last ANSI code.
 */
export function extractAnsiColor(rawLine: string, target: string): ThemeColorKey | null {
  // Find the target position in visible text
  const visible = rawLine.replace(ANSI_RE, '');
  const targetIdx = visible.indexOf(target);
  if (targetIdx < 0) return null;

  let visPos = 0;
  let lastAnsi: string | null = null;
  let i = 0;

  while (i < rawLine.length) {
    const m = rawLine.slice(i).match(/^\x1b\[([0-9;]*)m/);
    if (m) {
      if (visPos <= targetIdx) lastAnsi = m[1];
      i += m[0].length;
      continue;
    }
    visPos++;
    if (visPos > targetIdx) break;
    i++;
  }

  return lastAnsi ? ansiParamsToThemeKey(lastAnsi) : null;
}
