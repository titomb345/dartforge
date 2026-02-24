/**
 * Hex grid math — flat-top axial coordinate system for DartMUD wilderness.
 *
 * DartMUD hexes use 6 directions only: N, S, NE, NW, SE, SW (no east/west).
 * N and S are direct hex neighbors (single-step), not two-step jumps.
 *
 * Axial coordinates (q, r):
 *   q = column, r = row (diagonal)
 *
 * Offsets:
 *   n:  ( 0, -1)    s:  ( 0, +1)
 *   ne: (+1, -1)    sw: (-1, +1)
 *   se: (+1,  0)    nw: (-1,  0)
 */

export interface HexCoord {
  q: number;
  r: number;
}

/** The 6 hex movement directions DartMUD supports */
export type Direction = 'n' | 's' | 'ne' | 'nw' | 'se' | 'sw';

/** Full direction names → short codes */
const DIR_ALIASES: Record<string, Direction> = {
  north: 'n',
  south: 's',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  n: 'n',
  s: 's',
  ne: 'ne',
  nw: 'nw',
  se: 'se',
  sw: 'sw',
};

/**
 * Parse a string into a Direction, or null if not a hex direction.
 */
export function parseDirection(input: string): Direction | null {
  return DIR_ALIASES[input.toLowerCase().trim()] ?? null;
}

/**
 * Axial offset for each direction on a flat-top hex grid.
 *
 *   n:  ( 0, -1)    s:  ( 0, +1)
 *   ne: (+1, -1)    sw: (-1, +1)
 *   se: (+1,  0)    nw: (-1,  0)
 */
const DIR_OFFSETS: Record<Direction, { dq: number; dr: number }> = {
  n: { dq: 0, dr: -1 },
  s: { dq: 0, dr: 1 },
  ne: { dq: 1, dr: -1 },
  sw: { dq: -1, dr: 1 },
  se: { dq: 1, dr: 0 },
  nw: { dq: -1, dr: 0 },
};

/** Opposite direction mapping */
const OPPOSITE: Record<Direction, Direction> = {
  n: 's',
  s: 'n',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
};

export function oppositeDirection(dir: Direction): Direction {
  return OPPOSITE[dir];
}

/**
 * Apply a direction to a hex coordinate.
 */
export function applyDirection(coord: HexCoord, dir: Direction): HexCoord {
  const offset = DIR_OFFSETS[dir];
  return {
    q: coord.q + offset.dq,
    r: coord.r + offset.dr,
  };
}

/**
 * Get offset for a direction.
 */
export function getDirectionOffset(dir: Direction): { dq: number; dr: number } {
  return DIR_OFFSETS[dir];
}

/**
 * Convert axial hex coordinate to pixel position (flat-top layout).
 * @param q axial column
 * @param r axial row
 * @param size hex radius (center to vertex)
 * @returns pixel { x, y } for the hex center
 */
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * (3 / 2) * q;
  const y = size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
  return { x, y };
}

/**
 * Convert pixel position to the nearest axial hex coordinate.
 */
export function pixelToHex(px: number, py: number, size: number): { q: number; r: number } {
  const q = ((2 / 3) * px) / size;
  const r = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / size;
  return hexRound(q, r);
}

/**
 * Round fractional axial coordinates to the nearest hex.
 */
function hexRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

/**
 * Get the 6 flat-top hex vertices (for drawing).
 */
export function hexCorners(cx: number, cy: number, size: number): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

/**
 * Create a coordinate key for use as a map key.
 */
export function coordKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

/**
 * Direction label for display.
 */
const DIR_LABELS: Record<Direction, string> = {
  n: 'N',
  ne: 'NE',
  se: 'SE',
  s: 'S',
  sw: 'SW',
  nw: 'NW',
};

export function directionLabel(dir: Direction): string {
  return DIR_LABELS[dir];
}

/** All 6 hex compass directions for rendering exit lines */
export const COMPASS_DIRECTIONS: Direction[] = ['n', 'ne', 'se', 's', 'sw', 'nw'];
