/**
 * Door-passage command sequence — DartMUD doors are opened/unlocked from
 * one side and closed/locked from the other after stepping through:
 *
 *   unlock w door with key … unlock w door with key N
 *   open w door
 *   w
 *   close e door
 *   lock e door with key … lock e door with key N
 *
 * Failed steps are harmless server-side ("The oak door has no lock!",
 * "You don't have one of those.") — the sequence fires blind, exactly like
 * the alias it replaces. Used by the /door built-in command and by the
 * town auto-walker when a route crosses a known door.
 */

const DOOR_DIR_ALIASES: Record<string, string> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  u: 'u',
  up: 'u',
  d: 'd',
  down: 'd',
  ne: 'ne',
  northeast: 'ne',
  nw: 'nw',
  northwest: 'nw',
  se: 'se',
  southeast: 'se',
  sw: 'sw',
  southwest: 'sw',
  in: 'in',
  out: 'out',
};

const DOOR_OPPOSITE: Record<string, string> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  u: 'd',
  d: 'u',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
  in: 'out',
  out: 'in',
};

/** Directions the /door command accepts (short forms) */
export const DOOR_DIRECTIONS = Object.keys(DOOR_OPPOSITE);

/**
 * The word a door command addresses a door by, from the noun its exits line
 * gives it (TownExits.doorNouns: door, doors, gate, gates, trapdoor,
 * curtain, hatch, grate, closet). "door" only finds things called a door:
 * "unlock d door" / "open d door" at an oak trapdoor drew "Unlock what?" /
 * "What ?" and the move bounced off it, as at the Bailey's cedar gate
 * (session_2026-07-06T00-03-28-376.log:2913-2924 and :3247-3256; "open
 * gate", "open u trapdoor" and "unlock w gate with key" work). A plural
 * noun names a door pair by its singular — "unlock w door with key"
 * answers "You unlock the pair of oak doors." (session_2026-06-19), while
 * the plural form was never sent.
 */
export function doorCommandNoun(noun: string | undefined): string {
  if (!noun) return 'door';
  if (noun === 'doors' || noun === 'gates') return noun.slice(0, -1);
  return noun;
}

/**
 * Build the full unlock→open→move→close→lock sequence for passing a door
 * in `dirWord` (any long/short direction, plus in/out), trying `keys`
 * keyring slots ("key", "key 2", … "key N") on both sides. `noun` is the
 * word for the door on this side, `farNoun` the same door's on the far side
 * (the walker reads both from the exits lines; the /door built-in, which
 * knows neither, says "door"). Returns null for unrecognized directions.
 */
export function buildDoorSequence(
  dirWord: string,
  keys: number,
  noun = 'door',
  farNoun = noun
): string[] | null {
  // (typeof: a plain-object table also answers inherited names — "/door
  // constructor" would have sent "unlock function Object() {...} door")
  const dir = DOOR_DIR_ALIASES[dirWord.trim().toLowerCase()];
  if (typeof dir !== 'string') return null;
  const opp = DOOR_OPPOSITE[dir];
  const n = Math.max(1, Math.min(10, Math.floor(keys) || 1));

  const keyName = (i: number) => (i === 1 ? 'key' : `key ${i}`);
  const cmds: string[] = [];
  for (let i = 1; i <= n; i++) cmds.push(`unlock ${dir} ${noun} with ${keyName(i)}`);
  cmds.push(`open ${dir} ${noun}`);
  cmds.push(dir);
  cmds.push(`close ${opp} ${farNoun}`);
  for (let i = 1; i <= n; i++) cmds.push(`lock ${opp} ${farNoun} with ${keyName(i)}`);
  return cmds;
}
