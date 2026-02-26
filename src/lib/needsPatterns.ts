import type { ThemeColorKey } from './defaultTheme';

/** A single hunger or thirst state */
export interface NeedLevel {
  key: string;
  label: string;
  descriptor: string; // the text inside "You are <descriptor>."
  themeColor: ThemeColorKey;
  severity: number;
}

/**
 * Hunger states from best to worst.
 * "well fed" added as a state above "not hungry" in recent DartMUD updates.
 */
export const HUNGER_LEVELS: NeedLevel[] = [
  { key: 'well-fed', label: 'Well Fed', descriptor: 'well fed', themeColor: 'green', severity: 0 },
  {
    key: 'not-hungry',
    label: 'Not Hungry',
    descriptor: 'not hungry',
    themeColor: 'brightGreen',
    severity: 1,
  },
  {
    key: 'slightly-hungry',
    label: 'Slightly Hungry',
    descriptor: 'slightly hungry',
    themeColor: 'brightYellow',
    severity: 2,
  },
  { key: 'hungry', label: 'Hungry', descriptor: 'hungry', themeColor: 'brightYellow', severity: 3 },
  {
    key: 'quite-hungry',
    label: 'Quite Hungry',
    descriptor: 'quite hungry',
    themeColor: 'brightYellow',
    severity: 4,
  },
  {
    key: 'famished',
    label: 'Famished',
    descriptor: 'famished',
    themeColor: 'brightYellow',
    severity: 5,
  },
  {
    key: 'faint-hunger',
    label: 'Faint from Hunger',
    descriptor: 'faint from hunger',
    themeColor: 'brightYellow',
    severity: 6,
  },
  { key: 'starving', label: 'Starving', descriptor: 'starving', themeColor: 'red', severity: 7 },
  {
    key: 'starving-death',
    label: 'Starving to Death',
    descriptor: 'starving to death',
    themeColor: 'red',
    severity: 8,
  },
];

/**
 * Thirst states from best to worst.
 * "well slaked" added as a state above "not thirsty" in recent DartMUD updates.
 */
export const THIRST_LEVELS: NeedLevel[] = [
  {
    key: 'well-slaked',
    label: 'Well Slaked',
    descriptor: 'well slaked',
    themeColor: 'green',
    severity: 0,
  },
  {
    key: 'not-thirsty',
    label: 'Not Thirsty',
    descriptor: 'not thirsty',
    themeColor: 'brightGreen',
    severity: 1,
  },
  {
    key: 'slightly-thirsty',
    label: 'Slightly Thirsty',
    descriptor: 'slightly thirsty',
    themeColor: 'brightYellow',
    severity: 2,
  },
  {
    key: 'thirsty',
    label: 'Thirsty',
    descriptor: 'thirsty',
    themeColor: 'brightYellow',
    severity: 3,
  },
  {
    key: 'quite-thirsty',
    label: 'Quite Thirsty',
    descriptor: 'quite thirsty',
    themeColor: 'brightYellow',
    severity: 4,
  },
  {
    key: 'parched',
    label: 'Parched',
    descriptor: 'parched',
    themeColor: 'brightYellow',
    severity: 5,
  },
  {
    key: 'faint-thirst',
    label: 'Faint from Thirst',
    descriptor: 'faint from thirst',
    themeColor: 'brightYellow',
    severity: 6,
  },
  {
    key: 'dehydrated',
    label: 'Dehydrated',
    descriptor: 'completely dehydrated',
    themeColor: 'red',
    severity: 7,
  },
  {
    key: 'dying-thirst',
    label: 'Dying of Thirst',
    descriptor: 'dying of thirst',
    themeColor: 'red',
    severity: 8,
  },
];

/** Lookup maps for fast matching */
const HUNGER_LOOKUP = new Map<string, NeedLevel>();
for (const level of HUNGER_LEVELS) HUNGER_LOOKUP.set(level.descriptor, level);

const THIRST_LOOKUP = new Map<string, NeedLevel>();
for (const level of THIRST_LEVELS) THIRST_LOOKUP.set(level.descriptor, level);

export interface NeedsMatch {
  hunger?: NeedLevel;
  thirst?: NeedLevel;
}

/**
 * Match a single ANSI-stripped line against hunger/thirst patterns.
 *
 * Handles:
 * - Combined: "You are hungry, and thirsty."
 * - Combined with prefix: "Needs : You are hungry, and thirsty."
 * - Individual: "You are hungry." / "You are well fed."
 */
export function matchNeedsLine(line: string): NeedsMatch | null {
  // Strip leading "> " prompts
  let cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  // Strip optional "Needs" prefix (score output: "Needs         : You are ...")
  cleaned = cleaned.replace(/^Needs\s*:\s*/i, '');

  if (!cleaned.startsWith('You are ')) return null;
  const body = cleaned.slice(8).replace(/\.$/, ''); // strip "You are " and trailing "."

  // Try combined: "<hunger>, and <thirst>"
  const comboIdx = body.indexOf(', and ');
  if (comboIdx >= 0) {
    const hungerText = body.substring(0, comboIdx);
    const thirstText = body.substring(comboIdx + 6);
    const hunger = HUNGER_LOOKUP.get(hungerText);
    const thirst = THIRST_LOOKUP.get(thirstText);
    if (hunger || thirst) {
      return { hunger: hunger ?? undefined, thirst: thirst ?? undefined };
    }
  }

  // Try individual hunger
  const hunger = HUNGER_LOOKUP.get(body);
  if (hunger) return { hunger };

  // Try individual thirst
  const thirst = THIRST_LOOKUP.get(body);
  if (thirst) return { thirst };

  return null;
}
