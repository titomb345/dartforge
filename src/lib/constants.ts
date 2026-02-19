import type { ClassMode } from '../types';

/**
 * Valid movement directions in DartMUD.
 * Sorted longest-first for correct regex alternation (e.g., "out" before "o", "ne" before "n").
 */
export const DIRECTIONS = [
  'out', 'ne', 'nw', 'se', 'sw', 'in',
  'n', 's', 'e', 'w', 'u', 'd',
] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** Map each direction to its opposite. */
export const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  n: 's', s: 'n', e: 'w', w: 'e',
  ne: 'sw', sw: 'ne', nw: 'se', se: 'nw',
  u: 'd', d: 'u', in: 'out', out: 'in',
};

export const CLASS_MODES: { key: ClassMode; label: string; shortLabel: string }[] = [
  { key: 'mage', label: 'Mage', shortLabel: 'M' },
  { key: 'fighter', label: 'Fighter', shortLabel: 'F' },
  { key: 'multi', label: 'Multi', shortLabel: 'X' },
];

export const CLASS_COLORS: Record<ClassMode, string> = {
  mage: '#a78bfa',
  fighter: '#f59e0b',
  multi: '#10b981',
};
