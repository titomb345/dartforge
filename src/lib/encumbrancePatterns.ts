import type { ThemeColorKey } from './defaultTheme';

/** A single encumbrance state with display metadata */
export interface EncumbranceLevel {
  key: string;
  label: string;
  descriptor: string;
  themeColor: ThemeColorKey;
  severity: number; // 0 = best (unburdened), 7 = worst (unable to move)
}

/**
 * All encumbrance states from lightest to heaviest.
 * Mined from 916 days of DartMUD logs.
 */
export const ENCUMBRANCE_LEVELS: EncumbranceLevel[] = [
  { key: 'unburdened', label: 'Unburdened', descriptor: 'You are completely unburdened.', themeColor: 'green', severity: 0 },
  { key: 'considerably', label: 'Very Light', descriptor: 'You can carry considerably more.', themeColor: 'brightGreen', severity: 1 },
  { key: 'a-lot', label: 'Light', descriptor: 'You can carry a lot more.', themeColor: 'brightGreen', severity: 2 },
  { key: 'easy', label: 'Easy to Move', descriptor: 'You find it easy to move.', themeColor: 'brightGreen', severity: 3 },
  { key: 'more', label: 'Can Carry More', descriptor: 'You can carry more.', themeColor: 'yellow', severity: 4 },
  { key: 'hardly', label: 'Near Capacity', descriptor: 'You can hardly carry anything more.', themeColor: 'red', severity: 5 },
  { key: 'struggling', label: 'Struggling', descriptor: 'You are struggling to move.', themeColor: 'red', severity: 6 },
  { key: 'unable', label: 'Immobile', descriptor: 'You are unable to move.', themeColor: 'red', severity: 7 },
];

/** Result from matching an encumbrance line */
export interface EncumbranceMatch {
  level: EncumbranceLevel;
  raw: string;
}

/** Lookup map for fast matching */
const ENCUMBRANCE_LOOKUP = new Map<string, EncumbranceLevel>();
for (const level of ENCUMBRANCE_LEVELS) {
  ENCUMBRANCE_LOOKUP.set(level.descriptor, level);
}

/**
 * Match a single ANSI-stripped line against known encumbrance messages.
 *
 * Handles:
 * - "Encumbrance   : You find it easy to move." (score output)
 * - "You find it easy to move." (standalone, if it exists)
 */
export function matchEncumbranceLine(line: string): EncumbranceMatch | null {
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // Strip optional "Encumbrance : " prefix (score output)
  let text = cleaned;
  const prefixMatch = cleaned.match(/^Encumbrance\s*:\s*(.+)$/i);
  if (prefixMatch) {
    text = prefixMatch[1].trim();
  }

  const level = ENCUMBRANCE_LOOKUP.get(text);
  if (level) return { level, raw: cleaned };

  return null;
}
