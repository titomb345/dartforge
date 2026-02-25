/** Movement mode types and utilities for DartMUD direction prefixing. */

export type MovementMode = 'normal' | 'leading' | 'rowing' | 'sneaking';

/** Ordered list of all modes (sneaking filtered at runtime based on skill). */
const ALL_MODES: MovementMode[] = ['normal', 'leading', 'rowing', 'sneaking'];

/** Prefix prepended to direction commands for each mode. */
const MODE_PREFIX: Record<MovementMode, string> = {
  normal: '',
  leading: 'lead',
  rowing: 'row',
  sneaking: 'sneak',
};

/** Set of bare direction commands that get the mode prefix. */
const MOVEMENT_DIRECTIONS = new Set([
  // Short cardinal / diagonal
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
  // Vertical / special
  'u',
  'd',
  'back',
  'in',
  'out',
  'enter',
  'exit',
  // Long forms
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down',
]);

/** Cycle to the next available movement mode. */
export function getNextMode(current: MovementMode, hasSneaking: boolean): MovementMode {
  const available = hasSneaking ? ALL_MODES : ALL_MODES.filter((m) => m !== 'sneaking');
  const idx = available.indexOf(current);
  return available[(idx + 1) % available.length];
}

/**
 * If `command` is a bare direction and mode is not normal, return the prefixed
 * command (e.g. "lead e"). Otherwise return the original command unchanged.
 */
export function applyMovementMode(command: string, mode: MovementMode): string {
  if (mode === 'normal') return command;
  const trimmed = command.trim().toLowerCase();
  if (MOVEMENT_DIRECTIONS.has(trimmed)) {
    return `${MODE_PREFIX[mode]} ${command.trim()}`;
  }
  return command;
}

/** Human-readable label for the badge (capitalized mode name). */
export function movementModeLabel(mode: MovementMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
