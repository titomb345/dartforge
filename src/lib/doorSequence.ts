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
 * Build the full unlock→open→move→close→lock sequence for passing a door
 * in `dirWord` (any long/short direction, plus in/out), trying `keys`
 * keyring slots ("key", "key 2", … "key N") on both sides.
 * Returns null for unrecognized directions.
 */
export function buildDoorSequence(dirWord: string, keys: number): string[] | null {
  const dir = DOOR_DIR_ALIASES[dirWord.trim().toLowerCase()];
  if (!dir) return null;
  const opp = DOOR_OPPOSITE[dir];
  const n = Math.max(1, Math.min(10, Math.floor(keys) || 1));

  const keyName = (i: number) => (i === 1 ? 'key' : `key ${i}`);
  const cmds: string[] = [];
  for (let i = 1; i <= n; i++) cmds.push(`unlock ${dir} door with ${keyName(i)}`);
  cmds.push(`open ${dir} door`);
  cmds.push(dir);
  cmds.push(`close ${opp} door`);
  for (let i = 1; i <= n; i++) cmds.push(`lock ${opp} door with ${keyName(i)}`);
  return cmds;
}
