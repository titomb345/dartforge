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

export interface AnsiColorSegment {
  text: string;
  color: ThemeColorKey;
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

/**
 * Extract per-character ANSI colors for `target` in the raw line,
 * grouped into segments of consecutive characters sharing the same color.
 * Returns null when there is only one color (the existing mudColor handles that).
 * Tracks cumulative bold/fg state across multiple ANSI sequences.
 */
export function extractAnsiColorSegments(
  rawLine: string,
  target: string,
): AnsiColorSegment[] | null {
  const visible = rawLine.replace(ANSI_RE, '');
  const targetIdx = visible.indexOf(target);
  if (targetIdx < 0) return null;
  const targetEnd = targetIdx + target.length;

  let visPos = 0;
  let bold = false;
  let fg = -1;
  let i = 0;

  const charKeys: (ThemeColorKey | null)[] = [];

  while (i < rawLine.length && visPos < targetEnd) {
    const m = rawLine.slice(i).match(/^\x1b\[([0-9;]*)m/);
    if (m) {
      const parts = m[1].split(';').map(Number);
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
      i += m[0].length;
      continue;
    }

    if (visPos >= targetIdx) {
      charKeys.push(fg >= 0 ? (bold ? ANSI_BRIGHT[fg] : ANSI_BASE[fg]) : null);
    }

    visPos++;
    i++;
  }

  if (charKeys.length === 0) return null;

  // Group consecutive characters with the same color
  const segments: AnsiColorSegment[] = [];
  let curColor = charKeys[0];
  let curText = target[0];

  for (let j = 1; j < charKeys.length; j++) {
    if (charKeys[j] === curColor) {
      curText += target[j];
    } else {
      segments.push({ text: curText, color: curColor ?? 'white' });
      curColor = charKeys[j];
      curText = target[j];
    }
  }
  segments.push({ text: curText, color: curColor ?? 'white' });

  // Only useful when there are multiple distinct colors
  if (segments.length <= 1) return null;
  return segments;
}
