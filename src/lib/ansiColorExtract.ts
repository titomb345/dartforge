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

/** 6x6x6 color cube component levels used by xterm for indices 16-231. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** Convert a 256-color palette index (16-255) to RGB. */
function paletteToRgb(idx: number): [number, number, number] {
  if (idx >= 232) {
    const v = 8 + (idx - 232) * 10;
    return [v, v, v];
  }
  const n = idx - 16;
  return [
    CUBE_LEVELS[Math.floor(n / 36) % 6],
    CUBE_LEVELS[Math.floor(n / 6) % 6],
    CUBE_LEVELS[n % 6],
  ];
}

/** Above this component value a color reads as the bright variant of its hue. */
const BRIGHT_THRESHOLD = 224;
/** Below this relative saturation a color is treated as a shade of gray. */
const GRAY_SATURATION = 0.25;

/**
 * Snap an arbitrary RGB triple to one of the 16 standard palette slots.
 *
 * Straight Euclidean/luma nearest-neighbour matching pulls pale colors toward
 * white (a 256-color pink lands closer to white than to magenta), which is
 * exactly the case the who list cares about. So this matches on hue instead:
 * which channels are dominant decides the color, and overall intensity decides
 * normal vs bright.
 */
function nearestBase16(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max === 0) return 0; // black
  const bright = max >= BRIGHT_THRESHOLD;

  if ((max - min) / max < GRAY_SATURATION) {
    if (max < 48) return 0; // black
    if (max < 128) return 8; // brightBlack (dark gray)
    return bright ? 15 : 7; // brightWhite / white
  }

  // A channel counts toward the hue when it's in the upper half of the range.
  const cutoff = min + (max - min) / 2;
  const idx = (r >= cutoff ? 1 : 0) | (g >= cutoff ? 2 : 0) | (b >= cutoff ? 4 : 0);
  return bright ? idx + 8 : idx;
}

// ---------------------------------------------------------------------------
// MudColor — the color a piece of MUD text is actually drawn in
// ---------------------------------------------------------------------------

/**
 * Either one of the 16 theme slots (so the panel follows the user's terminal
 * theme, exactly like the terminal itself does) or a literal `#rrggbb` for
 * 256-color / truecolor values, which xterm renders from the fixed standard
 * palette and are therefore not themeable.
 */
export type MudColor = ThemeColorKey | string;

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

/** Resolve a MudColor to a CSS color, looking theme slots up in the live theme. */
export function mudColorToCss(
  color: MudColor | null | undefined,
  theme: Record<string, string>
): string | undefined {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  return theme[color];
}

// ---------------------------------------------------------------------------
// SGR state machine
// ---------------------------------------------------------------------------

/** Running foreground state while walking a line's SGR sequences. */
export interface SgrFgState {
  bold: boolean;
  /** 0-255 palette index, or null when no explicit color is active */
  idx: number | null;
  /** Truecolor value from `38;2;r;g;b`, or null */
  rgb: [number, number, number] | null;
}

export function newSgrState(): SgrFgState {
  return { bold: false, idx: null, rgb: null };
}

function resetSgr(state: SgrFgState): void {
  state.bold = false;
  state.idx = null;
  state.rgb = null;
}

/**
 * Apply one SGR sequence's parameters to the running state.
 * Parameters are consumed in order so extended-color forms
 * (`38;5;N`, `38;2;R;G;B`, and their `48;…` background equivalents)
 * don't leak their arguments into the simple 30-37 branch.
 */
export function applySgrParams(state: SgrFgState, params: string): void {
  // An empty parameter list (ESC[m) means reset.
  if (params === '') {
    resetSgr(state);
    return;
  }

  const parts = params.split(';').map((p) => (p === '' ? 0 : Number(p)));

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    if (p === 0) {
      resetSgr(state);
    } else if (p === 1) {
      state.bold = true;
    } else if (p === 22) {
      state.bold = false;
    } else if (p >= 30 && p <= 37) {
      state.idx = p - 30;
      state.rgb = null;
    } else if (p >= 90 && p <= 97) {
      state.idx = p - 90 + 8;
      state.rgb = null;
    } else if (p === 39) {
      state.idx = null;
      state.rgb = null;
    } else if (p === 38 || p === 48) {
      const mode = parts[i + 1];
      if (mode === 5) {
        if (p === 38) {
          state.idx = parts[i + 2] ?? null;
          state.rgb = null;
        }
        i += 2;
      } else if (mode === 2) {
        if (p === 38) {
          state.rgb = [parts[i + 2] ?? 0, parts[i + 3] ?? 0, parts[i + 4] ?? 0];
          state.idx = null;
        }
        i += 4;
      } else {
        // Unknown extended-color form; skip the mode selector so its
        // arguments can't be misread as separate SGR codes.
        i += 1;
      }
    }
    // Everything else (backgrounds, italics, reverse video, …) is ignored.
  }
}

/** Map a 0-15 palette index (plus the bold flag) to its theme slot. */
function base16ToThemeKey(idx: number, bold: boolean): ThemeColorKey {
  if (idx >= 8) return ANSI_BRIGHT[idx - 8];
  // Bold promotes a normal color to its bright variant, matching terminals.
  return bold ? ANSI_BRIGHT[idx] : ANSI_BASE[idx];
}

/**
 * Resolve the current foreground state to the color the terminal actually
 * draws. Palette slots 0-15 stay symbolic so they follow the user's theme
 * (which is what xterm does with them); 256-color and truecolor values come
 * back as literal hex, since those are fixed and not themeable.
 */
export function resolveSgrFg(state: SgrFgState): MudColor | null {
  if (state.rgb) return toHex(state.rgb);
  if (state.idx === null) return null;
  if (state.idx >= 16 && state.idx <= 255) return toHex(paletteToRgb(state.idx));
  if (state.idx < 0 || state.idx > 15) return null;
  return base16ToThemeKey(state.idx, state.bold);
}

/**
 * Resolve to one of the 16 theme slots, snapping 256-color/truecolor values to
 * the closest slot by hue. Used where a color is a *category* rather than
 * something to display — the automapper telling rivers from paths, say.
 */
export function resolveSgrFgKey(state: SgrFgState): ThemeColorKey | null {
  if (state.rgb) return base16ToThemeKey(nearestBase16(state.rgb), false);
  if (state.idx === null) return null;
  if (state.idx >= 16 && state.idx <= 255) {
    return base16ToThemeKey(nearestBase16(paletteToRgb(state.idx)), false);
  }
  if (state.idx < 0 || state.idx > 15) return null;
  return base16ToThemeKey(state.idx, state.bold);
}

/** Convert raw ANSI SGR parameter string (e.g. "1;32", "38;5;213") to a color. */
export function ansiParamsToThemeKey(params: string): MudColor | null {
  const state = newSgrState();
  applySgrParams(state, params);
  return resolveSgrFg(state);
}

export interface AnsiColorSegment {
  text: string;
  color: MudColor;
}

/**
 * Per-visible-character foreground colors for a whole raw line.
 * Index i corresponds to character i of the ANSI-stripped line.
 * Used by the automapper to tell rivers (blue '*' edge chars) from
 * paths (same '*' char, different color) in hex art — so these are the
 * snapped 16-slot keys, which the terrain rules match against by name.
 */
export function lineFgColors(rawLine: string): (ThemeColorKey | null)[] {
  const colors: (ThemeColorKey | null)[] = [];
  const state = newSgrState();
  let i = 0;

  while (i < rawLine.length) {
    const m = rawLine.slice(i).match(/^\x1b\[([0-9;]*)m/);
    if (m) {
      applySgrParams(state, m[1]);
      i += m[0].length;
      continue;
    }
    colors.push(resolveSgrFgKey(state));
    i++;
  }

  return colors;
}

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/**
 * Extract the ANSI color active at the position of `target` in the raw line.
 * Walks the raw line tracking visible character position and SGR state.
 */
export function extractAnsiColor(rawLine: string, target: string): MudColor | null {
  // Find the target position in visible text
  const visible = rawLine.replace(ANSI_RE, '');
  const targetIdx = visible.indexOf(target);
  if (targetIdx < 0) return null;

  const state = newSgrState();
  let visPos = 0;
  let i = 0;

  while (i < rawLine.length) {
    const m = rawLine.slice(i).match(/^\x1b\[([0-9;]*)m/);
    if (m) {
      if (visPos <= targetIdx) applySgrParams(state, m[1]);
      i += m[0].length;
      continue;
    }
    visPos++;
    if (visPos > targetIdx) break;
    i++;
  }

  return resolveSgrFg(state);
}

/**
 * Extract per-character ANSI colors for `target` in the raw line,
 * grouped into segments of consecutive characters sharing the same color.
 * Returns null when there is only one color (the existing mudColor handles that).
 */
export function extractAnsiColorSegments(
  rawLine: string,
  target: string
): AnsiColorSegment[] | null {
  const visible = rawLine.replace(ANSI_RE, '');
  const targetIdx = visible.indexOf(target);
  if (targetIdx < 0) return null;
  const targetEnd = targetIdx + target.length;

  const state = newSgrState();
  let visPos = 0;
  let i = 0;

  const charKeys: (MudColor | null)[] = [];

  while (i < rawLine.length && visPos < targetEnd) {
    const m = rawLine.slice(i).match(/^\x1b\[([0-9;]*)m/);
    if (m) {
      applySgrParams(state, m[1]);
      i += m[0].length;
      continue;
    }

    if (visPos >= targetIdx) {
      charKeys.push(resolveSgrFg(state));
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
