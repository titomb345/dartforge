import type { ThemeColorKey } from './defaultTheme';
import { extractAnsiColor, withMudColor, type MudColor } from './ansiColorExtract';
import { cleanLine, stripScorePrefix } from './lineUtils';

/** A single concentration state with display metadata */
export interface ConcentrationLevel {
  key: string;
  label: string;
  message: string;
  /** Fallback color, used only when the line arrives without ANSI coloring */
  themeColor: ThemeColorKey;
  /** The color the MUD actually drew this message in, when the raw line is available */
  mudColor?: MudColor | null;
  severity: number; // 0 = best, 8 = worst
}

/**
 * All concentration states from best to worst.
 * `themeColor` is only a fallback for uncolored output — the displayed color is
 * read straight off the MUD's own ANSI codes whenever the raw line is at hand.
 */
export const CONCENTRATION_LEVELS: ConcentrationLevel[] = [
  {
    key: 'bebt',
    label: 'Bright-Eyed',
    message: "You're bright-eyed and bushy-tailed.",
    themeColor: 'green',
    severity: 0,
  },
  {
    key: 'bob',
    label: 'Bit Off Balance',
    message: "You're a bit off balance.",
    themeColor: 'brightGreen',
    severity: 1,
  },
  {
    key: 'sd',
    label: 'Somewhat Distracted',
    message: "You're somewhat distracted.",
    themeColor: 'brightGreen',
    severity: 2,
  },
  {
    key: 'qd',
    label: 'Quite Distracted',
    message: "You're quite distracted.",
    themeColor: 'brightYellow',
    severity: 3,
  },
  {
    key: 'ob',
    label: 'Off Balance',
    message: "You're off balance.",
    themeColor: 'brightYellow',
    severity: 4,
  },
  {
    key: 'daob',
    label: 'Distracted',
    message: "You're distracted and off balance.",
    themeColor: 'red',
    severity: 5,
  },
  {
    key: 'shot',
    label: 'Shot to Hell',
    message: 'Your concentration is shot to hell.',
    themeColor: 'red',
    severity: 6,
  },
  {
    key: 'tctrn',
    label: 'Too Confused',
    message: "You're too confused to remember your name.",
    themeColor: 'red',
    severity: 7,
  },
  {
    key: 'unconscious',
    label: 'Unconscious',
    message: 'You fall unconscious!',
    themeColor: 'red',
    severity: 8,
  },
];

/** Result from matching a concentration line */
export interface ConcentrationMatch {
  level: ConcentrationLevel;
  raw: string;
}

/** Pre-built lookup map for O(1) concentration message matching. */
const CONCENTRATION_LOOKUP = new Map<string, ConcentrationLevel>();
for (const level of CONCENTRATION_LEVELS) {
  CONCENTRATION_LOOKUP.set(level.message, level);
}

/**
 * Match a single ANSI-stripped line against known concentration messages.
 * Handles optional "> " prompt prefix and "Concentration : " prefix.
 *
 * Pass `rawLine` (the same line with its ANSI codes intact) to pick up the
 * color the MUD drew the message in.
 */
export function matchConcentrationLine(line: string, rawLine?: string): ConcentrationMatch | null {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;

  const withoutPrefix = stripScorePrefix(cleaned, 'Concentration');
  const level = CONCENTRATION_LOOKUP.get(withoutPrefix);
  if (!level) return null;

  const mudColor = rawLine ? extractAnsiColor(rawLine, withoutPrefix) : null;
  return { level: withMudColor(level, mudColor), raw: cleaned };
}
