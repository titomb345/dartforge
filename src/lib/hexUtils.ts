/**
 * Hex grid math — flat-top axial coordinate system.
 *
 * DartMUD uses a hex-based world with 8 compass directions (N, NE, E, SE, S, SW, W, NW)
 * plus up/down. The hex grid is flat-top, where the natural 6 neighbors are
 * E, W, NE, NW, SE, SW. N and S map to two-hex vertical jumps.
 *
 * Axial coordinates (q, r):
 *   q = column (east-west), r = row (diagonal)
 */

export interface HexCoord {
  q: number;
  r: number;
  z: number; // vertical layer (for up/down)
}

/** All movement directions the MUD supports */
export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'u' | 'd';

/** Full direction names → short codes */
const DIR_ALIASES: Record<string, Direction> = {
  north: 'n', northeast: 'ne', east: 'e', southeast: 'se',
  south: 's', southwest: 'sw', west: 'w', northwest: 'nw',
  up: 'u', down: 'd',
  n: 'n', ne: 'ne', e: 'e', se: 'se',
  s: 's', sw: 'sw', w: 'w', nw: 'nw',
  u: 'u', d: 'd',
};

/**
 * Parse a string into a Direction, or null if not a direction.
 */
export function parseDirection(input: string): Direction | null {
  return DIR_ALIASES[input.toLowerCase().trim()] ?? null;
}

/**
 * Axial offset for each direction on a flat-top hex grid.
 *
 * Flat-top hex neighbors (6 natural):
 *   E:  (+1,  0)    W:  (-1,  0)
 *   NE: (+1, -1)    NW: ( 0, -1)
 *   SE: ( 0, +1)    SW: (-1, +1)
 *
 * N and S are not natural flat-top neighbors. We map them to
 * vertical two-step offsets to keep the grid consistent:
 *   N:  ( 0, -2)    S:  ( 0, +2)
 *
 * Up/Down change the z-layer.
 */
const DIR_OFFSETS: Record<Direction, { dq: number; dr: number; dz: number }> = {
  e:  { dq:  1, dr:  0, dz: 0 },
  w:  { dq: -1, dr:  0, dz: 0 },
  ne: { dq:  1, dr: -1, dz: 0 },
  nw: { dq:  0, dr: -1, dz: 0 },
  se: { dq:  0, dr:  1, dz: 0 },
  sw: { dq: -1, dr:  1, dz: 0 },
  n:  { dq:  0, dr: -2, dz: 0 },
  s:  { dq:  0, dr:  2, dz: 0 },
  u:  { dq:  0, dr:  0, dz: 1 },
  d:  { dq:  0, dr:  0, dz: -1 },
};

/** Opposite direction mapping */
const OPPOSITE: Record<Direction, Direction> = {
  n: 's', s: 'n', e: 'w', w: 'e',
  ne: 'sw', sw: 'ne', nw: 'se', se: 'nw',
  u: 'd', d: 'u',
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
    z: coord.z + offset.dz,
  };
}

/**
 * Get offset for a direction.
 */
export function getDirectionOffset(dir: Direction): { dq: number; dr: number; dz: number } {
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
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

/**
 * Convert pixel position to the nearest axial hex coordinate.
 */
export function pixelToHex(px: number, py: number, size: number): { q: number; r: number } {
  const q = (2 / 3 * px) / size;
  const r = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / size;
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
  return `${coord.q},${coord.r},${coord.z}`;
}

export function coordKeyQR(q: number, r: number, z: number): string {
  return `${q},${r},${z}`;
}

/**
 * Direction label for display.
 */
const DIR_LABELS: Record<Direction, string> = {
  n: 'N', ne: 'NE', e: 'E', se: 'SE',
  s: 'S', sw: 'SW', w: 'W', nw: 'NW',
  u: 'Up', d: 'Down',
};

export function directionLabel(dir: Direction): string {
  return DIR_LABELS[dir];
}

/** All compass directions (excluding up/down) for rendering exit lines */
export const COMPASS_DIRECTIONS: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
