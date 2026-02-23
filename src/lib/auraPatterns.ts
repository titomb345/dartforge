import type { ThemeColorKey } from './defaultTheme';

/** A single aura state with display metadata */
export interface AuraLevel {
  key: string;
  label: string;
  descriptor: string; // the text inside "Your aura appears to be <descriptor>."
  /** ANSI theme color key — fallback if color is not set */
  themeColor: ThemeColorKey;
  severity: number; // 0 = best (Scintillating), 26 = worst (None)
  /** Direct CSS color for the status bar readout */
  color: string;
}

/**
 * All aura states from best to worst.
 * 27 levels sourced from DartMudlet's Aura_Triggers.lua and verified against logs.
 * Theme colors map the aura color name to the closest terminal ANSI color.
 */
export const AURA_LEVELS: AuraLevel[] = [
  { key: 'scintillating', label: 'Scintillating', descriptor: 'scintillating', themeColor: 'brightWhite', severity: 0, color: '#ffffff' },
  { key: 'intense-octarine', label: 'Intense Octarine', descriptor: 'intense octarine', themeColor: 'brightCyan', severity: 1, color: '#e0b0ff' },
  { key: 'octarine', label: 'Octarine', descriptor: 'octarine', themeColor: 'brightCyan', severity: 2, color: '#c890e0' },
  { key: 'dim-octarine', label: 'Dim Octarine', descriptor: 'dim octarine', themeColor: 'cyan', severity: 3, color: '#b088d0' },
  { key: 'intense-violet', label: 'Intense Violet', descriptor: 'intense violet', themeColor: 'brightMagenta', severity: 4, color: '#d070ff' },
  { key: 'violet', label: 'Violet', descriptor: 'violet', themeColor: 'brightMagenta', severity: 5, color: '#b050ff' },
  { key: 'dim-violet', label: 'Dim Violet', descriptor: 'dim violet', themeColor: 'magenta', severity: 6, color: '#9040e0' },
  { key: 'intense-indigo', label: 'Intense Indigo', descriptor: 'intense indigo', themeColor: 'brightBlue', severity: 7, color: '#9999ff' },
  { key: 'indigo', label: 'Indigo', descriptor: 'indigo', themeColor: 'brightBlue', severity: 8, color: '#7878f0' },
  { key: 'dim-indigo', label: 'Dim Indigo', descriptor: 'dim indigo', themeColor: 'blue', severity: 9, color: '#5858cc' },
  { key: 'intense-blue', label: 'Intense Blue', descriptor: 'intense blue', themeColor: 'brightBlue', severity: 10, color: '#50a0ff' },
  { key: 'blue', label: 'Blue', descriptor: 'blue', themeColor: 'blue', severity: 11, color: '#4088e8' },
  { key: 'greenish-blue', label: 'Greenish-Blue', descriptor: 'greenish-blue', themeColor: 'cyan', severity: 12, color: '#30b8b8' },
  { key: 'bluish-green', label: 'Bluish-Green', descriptor: 'bluish-green', themeColor: 'cyan', severity: 13, color: '#30c898' },
  { key: 'green', label: 'Green', descriptor: 'green', themeColor: 'brightGreen', severity: 14, color: '#30c030' },
  { key: 'yellowish-green', label: 'Yellowish-Green', descriptor: 'yellowish-green', themeColor: 'brightGreen', severity: 15, color: '#80c020' },
  { key: 'greenish-yellow', label: 'Greenish-Yellow', descriptor: 'greenish-yellow', themeColor: 'brightYellow', severity: 16, color: '#b0d020' },
  { key: 'yellow', label: 'Yellow', descriptor: 'yellow', themeColor: 'brightYellow', severity: 17, color: '#e0e020' },
  { key: 'orangish-yellow', label: 'Orangish-Yellow', descriptor: 'orangish-yellow', themeColor: 'yellow', severity: 18, color: '#e0b020' },
  { key: 'yellowish-orange', label: 'Yellowish-Orange', descriptor: 'yellowish-orange', themeColor: 'yellow', severity: 19, color: '#e09020' },
  { key: 'orange', label: 'Orange', descriptor: 'orange', themeColor: 'yellow', severity: 20, color: '#e07020' },
  { key: 'reddish-orange', label: 'Reddish-Orange', descriptor: 'reddish-orange', themeColor: 'brightRed', severity: 21, color: '#e04020' },
  { key: 'orangish-red', label: 'Orangish-Red', descriptor: 'orangish-red', themeColor: 'brightRed', severity: 22, color: '#d02020' },
  { key: 'red', label: 'Red', descriptor: 'red', themeColor: 'brightRed', severity: 23, color: '#d02020' },
  { key: 'dim-red', label: 'Dim Red', descriptor: 'dim red', themeColor: 'red', severity: 24, color: '#b03030' },
  { key: 'very-dim-red', label: 'Very Dim Red', descriptor: 'very dim red', themeColor: 'red', severity: 25, color: '#8a2020' },
  { key: 'none', label: 'None', descriptor: 'none', themeColor: 'brightBlack', severity: 26, color: '#808080' },
];

/** Result from matching an aura line */
export interface AuraMatch {
  level: AuraLevel;
  raw: string;
}

/** Lookup map for fast matching */
const AURA_LOOKUP = new Map<string, AuraLevel>();
for (const level of AURA_LEVELS) {
  AURA_LOOKUP.set(level.descriptor, level);
}

/**
 * Match a single ANSI-stripped line against known aura messages.
 *
 * Handles:
 * - "Your aura appears to be <color>."
 * - "Aura          : <color>." (score output, variable spacing)
 * - "You have no aura." / "You appear to have no aura." / "Aura          : None."
 */
export function matchAuraLine(line: string): AuraMatch | null {
  // Strip leading "> " prompts
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // "You have no aura." / "You appear to have no aura."
  if (cleaned === 'You have no aura.' || cleaned === 'You appear to have no aura.') {
    const level = AURA_LOOKUP.get('none');
    if (level) return { level, raw: cleaned };
  }

  // Strip optional "Aura : " prefix (score output keeps the full sentence after it)
  let text = cleaned;
  const prefixMatch = cleaned.match(/^Aura\s*:\s*(.+)$/i);
  if (prefixMatch) {
    text = prefixMatch[1].trim();
    // "Aura : None." / "Aura : You have no aura." / "Aura : You appear to have no aura."
    const lower = text.replace(/\.$/, '').toLowerCase();
    if (lower === 'none' || lower === 'you have no aura' || lower === 'you appear to have no aura') {
      const level = AURA_LOOKUP.get('none');
      if (level) return { level, raw: cleaned };
    }
  }

  // "Your aura appears to be <color>."
  const auraMatch = text.match(/^Your aura appears to be (.+)\.$/);
  if (auraMatch) {
    const descriptor = auraMatch[1].toLowerCase();
    const level = AURA_LOOKUP.get(descriptor);
    if (level) return { level, raw: cleaned };
  }

  return null;
}
