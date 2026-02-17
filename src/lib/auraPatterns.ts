import type { ThemeColorKey } from './defaultTheme';

/** A single aura state with display metadata */
export interface AuraLevel {
  key: string;
  label: string;
  descriptor: string; // the text inside "Your aura appears to be <descriptor>."
  /** ANSI theme color key — resolved at render time from the user's terminal theme */
  themeColor: ThemeColorKey;
  severity: number; // 0 = best (Scintillating), 26 = worst (None)
}

/**
 * All aura states from best to worst.
 * 27 levels sourced from DartMudlet's Aura_Triggers.lua and verified against logs.
 * Theme colors map the aura color name to the closest terminal ANSI color.
 */
export const AURA_LEVELS: AuraLevel[] = [
  { key: 'scintillating', label: 'Scintillating', descriptor: 'scintillating', themeColor: 'brightWhite', severity: 0 },
  { key: 'intense-octarine', label: 'Intense Octarine', descriptor: 'intense octarine', themeColor: 'brightCyan', severity: 1 },
  { key: 'octarine', label: 'Octarine', descriptor: 'octarine', themeColor: 'brightCyan', severity: 2 },
  { key: 'dim-octarine', label: 'Dim Octarine', descriptor: 'dim octarine', themeColor: 'cyan', severity: 3 },
  { key: 'intense-violet', label: 'Intense Violet', descriptor: 'intense violet', themeColor: 'brightMagenta', severity: 4 },
  { key: 'violet', label: 'Violet', descriptor: 'violet', themeColor: 'brightMagenta', severity: 5 },
  { key: 'dim-violet', label: 'Dim Violet', descriptor: 'dim violet', themeColor: 'magenta', severity: 6 },
  { key: 'intense-indigo', label: 'Intense Indigo', descriptor: 'intense indigo', themeColor: 'brightBlue', severity: 7 },
  { key: 'indigo', label: 'Indigo', descriptor: 'indigo', themeColor: 'brightBlue', severity: 8 },
  { key: 'dim-indigo', label: 'Dim Indigo', descriptor: 'dim indigo', themeColor: 'blue', severity: 9 },
  { key: 'intense-blue', label: 'Intense Blue', descriptor: 'intense blue', themeColor: 'brightBlue', severity: 10 },
  { key: 'blue', label: 'Blue', descriptor: 'blue', themeColor: 'blue', severity: 11 },
  { key: 'greenish-blue', label: 'Greenish-Blue', descriptor: 'greenish-blue', themeColor: 'cyan', severity: 12 },
  { key: 'bluish-green', label: 'Bluish-Green', descriptor: 'bluish-green', themeColor: 'cyan', severity: 13 },
  { key: 'green', label: 'Green', descriptor: 'green', themeColor: 'brightGreen', severity: 14 },
  { key: 'yellowish-green', label: 'Yellowish-Green', descriptor: 'yellowish-green', themeColor: 'brightGreen', severity: 15 },
  { key: 'greenish-yellow', label: 'Greenish-Yellow', descriptor: 'greenish-yellow', themeColor: 'brightYellow', severity: 16 },
  { key: 'yellow', label: 'Yellow', descriptor: 'yellow', themeColor: 'brightYellow', severity: 17 },
  { key: 'orangish-yellow', label: 'Orangish-Yellow', descriptor: 'orangish-yellow', themeColor: 'yellow', severity: 18 },
  { key: 'yellowish-orange', label: 'Yellowish-Orange', descriptor: 'yellowish-orange', themeColor: 'yellow', severity: 19 },
  { key: 'orange', label: 'Orange', descriptor: 'orange', themeColor: 'yellow', severity: 20 },
  { key: 'reddish-orange', label: 'Reddish-Orange', descriptor: 'reddish-orange', themeColor: 'brightRed', severity: 21 },
  { key: 'orangish-red', label: 'Orangish-Red', descriptor: 'orangish-red', themeColor: 'brightRed', severity: 22 },
  { key: 'red', label: 'Red', descriptor: 'red', themeColor: 'brightRed', severity: 23 },
  { key: 'dim-red', label: 'Dim Red', descriptor: 'dim red', themeColor: 'red', severity: 24 },
  { key: 'very-dim-red', label: 'Very Dim Red', descriptor: 'very dim red', themeColor: 'red', severity: 25 },
  { key: 'none', label: 'None', descriptor: 'none', themeColor: 'brightBlack', severity: 26 },
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
 * - "You have no aura." / "Aura          : None."
 */
export function matchAuraLine(line: string): AuraMatch | null {
  // Strip leading "> " prompts
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // "You have no aura."
  if (cleaned === 'You have no aura.') {
    const level = AURA_LOOKUP.get('none');
    if (level) return { level, raw: cleaned };
  }

  // Strip optional "Aura : " prefix (score output keeps the full sentence after it)
  let text = cleaned;
  const prefixMatch = cleaned.match(/^Aura\s*:\s*(.+)$/i);
  if (prefixMatch) {
    text = prefixMatch[1].trim();
    // "Aura : None."
    if (text.replace(/\.$/, '').toLowerCase() === 'none') {
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
