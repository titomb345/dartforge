import type { ThemeColorKey } from './defaultTheme';

/** A single movement state with display metadata */
export interface MovementLevel {
  key: string;
  label: string;
  descriptor: string;
  themeColor: ThemeColorKey;
  severity: number; // 0 = best (ready for anything), 8 = worst (exhausted)
}

/**
 * All movement states from most rested to most tired.
 * Verified against recent (2025-2026) DartMUD logs.
 * Ordering informed by observed degradation sequences in logs.
 */
export const MOVEMENT_LEVELS: MovementLevel[] = [
  { key: 'anything', label: 'Ready', descriptor: 'Ready for anything!', themeColor: 'green', severity: 0 },
  { key: 'epic', label: 'Epic Adventure', descriptor: 'Ready for an epic adventure.', themeColor: 'green', severity: 1 },
  { key: 'trek', label: 'Long Trek', descriptor: 'Ready for a long trek.', themeColor: 'brightGreen', severity: 2 },
  { key: 'well-rested', label: 'Well Rested', descriptor: 'Well rested.', themeColor: 'brightGreen', severity: 3 },
  { key: 'spring', label: 'Spring in Step', descriptor: 'You have spring in your step.', themeColor: 'yellow', severity: 4 },
  { key: 'awhile', label: 'Travel a While', descriptor: 'You can travel a while longer.', themeColor: 'yellow', severity: 5 },
  { key: 'break', label: 'Need a Break', descriptor: 'You could use a break.', themeColor: 'red', severity: 6 },
  { key: 'there-yet', label: 'Are We There Yet', descriptor: 'Are we there yet?', themeColor: 'red', severity: 7 },
  { key: 'exhausted', label: 'Exhausted', descriptor: 'You are completely exhausted.', themeColor: 'magenta', severity: 8 },
];

/** Result from matching a movement line */
export interface MovementMatch {
  level: MovementLevel;
  raw: string;
}

/** Lookup map for fast matching */
const MOVEMENT_LOOKUP = new Map<string, MovementLevel>();
for (const level of MOVEMENT_LEVELS) {
  MOVEMENT_LOOKUP.set(level.descriptor, level);
}
// "You are too exhausted." is a gameplay message that maps to the exhausted state
MOVEMENT_LOOKUP.set('You are too exhausted.', MOVEMENT_LEVELS[MOVEMENT_LEVELS.length - 1]);

/**
 * Match a single ANSI-stripped line against known movement messages.
 *
 * Handles:
 * - "Movement      : Ready for anything!" (score output)
 * - "Ready for anything!" (standalone)
 * - "You are too exhausted." (gameplay block message)
 */
export function matchMovementLine(line: string): MovementMatch | null {
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // Strip optional "Movement : " prefix (score output)
  let text = cleaned;
  const prefixMatch = cleaned.match(/^Movement\s*:\s*(.+)$/i);
  if (prefixMatch) {
    text = prefixMatch[1].trim();
  }

  const level = MOVEMENT_LOOKUP.get(text);
  if (level) return { level, raw: cleaned };

  return null;
}
