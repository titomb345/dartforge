import type { ThemeColorKey } from './defaultTheme';

/** A single concentration state with display metadata */
export interface ConcentrationLevel {
  key: string;
  label: string;
  message: string;
  /** ANSI theme color key — resolved at render time from the user's terminal theme */
  themeColor: ThemeColorKey;
  severity: number; // 0 = best, 8 = worst
}

/**
 * All concentration states from best to worst.
 * Colors match the MUD's in-game ANSI colors, mapped to terminal theme keys.
 */
export const CONCENTRATION_LEVELS: ConcentrationLevel[] = [
  { key: 'bebt', label: 'Bright-Eyed', message: "You're bright-eyed and bushy-tailed.", themeColor: 'green', severity: 0 },
  { key: 'bob', label: 'Bit Off Balance', message: "You're a bit off balance.", themeColor: 'brightGreen', severity: 1 },
  { key: 'sd', label: 'Somewhat Distracted', message: "You're somewhat distracted.", themeColor: 'brightGreen', severity: 2 },
  { key: 'qd', label: 'Quite Distracted', message: "You're quite distracted.", themeColor: 'brightYellow', severity: 3 },
  { key: 'ob', label: 'Off Balance', message: "You're off balance.", themeColor: 'brightYellow', severity: 4 },
  { key: 'daob', label: 'Distracted', message: "You're distracted and off balance.", themeColor: 'red', severity: 5 },
  { key: 'shot', label: 'Shot to Hell', message: "Your concentration is shot to hell.", themeColor: 'red', severity: 6 },
  { key: 'tctrn', label: 'Too Confused', message: "You're too confused to remember your name.", themeColor: 'red', severity: 7 },
  { key: 'unconscious', label: 'Unconscious', message: 'You fall unconscious!', themeColor: 'red', severity: 8 },
];

/** Result from matching a concentration line */
export interface ConcentrationMatch {
  level: ConcentrationLevel;
  raw: string;
}

/**
 * Match a single ANSI-stripped line against known concentration messages.
 * Handles optional "> " prompt prefix and "Concentration : " prefix.
 */
export function matchConcentrationLine(line: string): ConcentrationMatch | null {
  // Strip leading "> " prompts
  let cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // Strip optional "Concentration : " prefix (MUD sometimes includes it)
  const withoutPrefix = cleaned.replace(/^Concentration\s*:\s*/i, '');

  for (const level of CONCENTRATION_LEVELS) {
    if (withoutPrefix === level.message) {
      return { level, raw: cleaned };
    }
  }

  return null;
}
