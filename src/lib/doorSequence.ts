/**
 * Door-passage direction vocabulary for the /door built-in and the town
 * auto-walker. The command sequence itself is executed by DoorRunner
 * (doorRunner.ts), which reads the MUD's replies to pick the right key
 * and leave doors as it found them, instead of firing every keyring slot
 * blind:
 *
 *   unlock w door with key [2…]   (until "You unlock the …")
 *   open w door
 *   w
 *   close e door
 *   lock e door with key N        (the key that worked)
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
 * Resolve a direction word (any long/short direction, plus in/out) to the
 * short form used in door commands and its opposite (the side the door is
 * closed/locked from after stepping through). Null for unknown words.
 */
export function resolveDoorDir(dirWord: string): { dir: string; opp: string } | null {
  const dir = DOOR_DIR_ALIASES[dirWord.trim().toLowerCase()];
  if (!dir) return null;
  return { dir, opp: DOOR_OPPOSITE[dir] };
}
