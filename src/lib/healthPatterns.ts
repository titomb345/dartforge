import type { ThemeColorKey } from './defaultTheme';

/** A single health state with display metadata */
export interface HealthLevel {
  key: string;
  label: string;
  message: string;
  /** ANSI theme color key — resolved at render time from the user's terminal theme */
  themeColor: ThemeColorKey;
  severity: number; // 0 = best, 8 = worst
}

/**
 * All health states from best to worst.
 * Mined from 916 days of DartMUD logs.
 */
export const HEALTH_LEVELS: HealthLevel[] = [
  {
    key: 'perfect',
    label: 'Perfect Health',
    message: 'You are in perfect health.',
    themeColor: 'green',
    severity: 0,
  },
  {
    key: 'very-healthy',
    label: 'Very Healthy',
    message: 'You are very healthy.',
    themeColor: 'brightGreen',
    severity: 1,
  },
  {
    key: 'healthy',
    label: 'Healthy',
    message: 'You are healthy.',
    themeColor: 'brightGreen',
    severity: 2,
  },
  {
    key: 'fairly',
    label: 'Fairly Healthy',
    message: 'You are fairly healthy.',
    themeColor: 'brightYellow',
    severity: 3,
  },
  { key: 'bad-off', label: 'Bad Off', message: 'You are bad off.', themeColor: 'red', severity: 4 },
  {
    key: 'very-bad-off',
    label: 'Very Bad Off',
    message: 'You are very bad off.',
    themeColor: 'red',
    severity: 5,
  },
  {
    key: 'near-death',
    label: 'Near Death',
    message: 'You are near death.',
    themeColor: 'red',
    severity: 6,
  },
  {
    key: 'almost-dead',
    label: 'Almost Dead',
    message: 'You are almost dead.',
    themeColor: 'red',
    severity: 7,
  },
  {
    key: 'very-near-death',
    label: 'Very Near Death',
    message: 'You are very near death.',
    themeColor: 'red',
    severity: 8,
  },
  { key: 'dead', label: 'Dead', message: 'You have died!', themeColor: 'red', severity: 9 },
];

/**
 * Extract the health descriptor from a cleaned line, handling both
 * "You are <state>." and "You are now <state>." formats.
 */
function extractHealthText(cleaned: string): string | null {
  // "You are now <state>." (healing transitions)
  const nowMatch = cleaned.match(/^You are now (.+)\.$/);
  if (nowMatch) return nowMatch[1];

  // "You are <state>." (hp command response)
  const match = cleaned.match(/^You are (.+)\.$/);
  if (match) return match[1];

  return null;
}

/** Result from matching a health line */
export interface HealthMatch {
  level: HealthLevel;
  raw: string;
}

/** Map from health descriptor text to its level (for fast lookup) */
const HEALTH_LOOKUP = new Map<string, HealthLevel>();
for (const level of HEALTH_LEVELS) {
  // Extract descriptor from the message (e.g., "in perfect health" from "You are in perfect health.")
  const match = level.message.match(/^You are (.+)\.$/);
  if (match) {
    HEALTH_LOOKUP.set(match[1], level);
  }
}

/** The death level (matched separately since it doesn't follow "You are..." format) */
const DEAD_LEVEL = HEALTH_LEVELS.find((l) => l.key === 'dead')!;

/**
 * Match a single ANSI-stripped line against known health messages.
 * Handles "You are <state>.", "You are now <state>.", and "You have died!".
 */
export function matchHealthLine(line: string): HealthMatch | null {
  // Strip leading "> " prompts
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // Death
  if (cleaned === 'You have died!') {
    return { level: DEAD_LEVEL, raw: cleaned };
  }

  const descriptor = extractHealthText(cleaned);
  if (!descriptor) return null;

  const level = HEALTH_LOOKUP.get(descriptor);
  if (!level) return null;

  return { level, raw: cleaned };
}
