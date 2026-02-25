/**
 * Hex terrain detection — regex-based terrain classification from wilderness room text.
 *
 * DartMUD terrain types and their ASCII hex art characters:
 *   plains(`.`), mountains(`^`), water/ocean(`~`), farmland(`"`),
 *   woods(`w`), hills(`h`), swamp(`s`), desert(`-`), wasteland(`x`),
 *   snow (description only, no dedicated char)
 */

export type HexTerrainType =
  | 'plains'
  | 'mountains'
  | 'water'
  | 'ocean'
  | 'farmland'
  | 'woods'
  | 'hills'
  | 'swamp'
  | 'desert'
  | 'wasteland'
  | 'snow'
  | 'unknown';

/** Map ASCII hex art character to terrain type */
export const TERRAIN_CHAR_MAP: Record<string, HexTerrainType> = {
  '.': 'plains',
  '^': 'mountains',
  '~': 'water',
  '"': 'farmland',
  w: 'woods',
  h: 'hills',
  s: 'swamp',
  '-': 'desert',
  x: 'wasteland',
};

/** Terrain detection patterns — order matters, first match wins */
const TERRAIN_PATTERNS: [RegExp, HexTerrainType][] = [
  [/\bocean\b/i, 'ocean'],
  [/\bsea\b/i, 'ocean'],
  [/\bwater\b/i, 'water'],
  [/\briver\b/i, 'water'],
  [/\blake\b/i, 'water'],
  [/\bstream\b/i, 'water'],
  [/\bmountain/i, 'mountains'],
  [/\bpeak\b/i, 'mountains'],
  [/\bcrag\b/i, 'mountains'],
  [/\bcliff\b/i, 'mountains'],
  [/\bwood/i, 'woods'],
  [/\bforest/i, 'woods'],
  [/\btree/i, 'woods'],
  [/\bthicket/i, 'woods'],
  [/\bhill/i, 'hills'],
  [/\brolling\b/i, 'hills'],
  [/\bswamp/i, 'swamp'],
  [/\bbog\b/i, 'swamp'],
  [/\bmarsh/i, 'swamp'],
  [/\bfarm/i, 'farmland'],
  [/\bcrop/i, 'farmland'],
  [/\bfield\b.*\b(?:wheat|grain|corn|barley)/i, 'farmland'],
  [/\bplowed\b/i, 'farmland'],
  [/\bdesert/i, 'desert'],
  [/\bsand\b/i, 'desert'],
  [/\bdune/i, 'desert'],
  [/\barid\b/i, 'desert'],
  [/\bwasteland/i, 'wasteland'],
  [/\bbarren\b/i, 'wasteland'],
  [/\bdesolat/i, 'wasteland'],
  [/\bsnow/i, 'snow'],
  [/\bfrozen\b/i, 'snow'],
  [/\bice\b/i, 'snow'],
  [/\btundra/i, 'snow'],
  [/\bplain/i, 'plains'],
  [/\bgrassland/i, 'plains'],
  [/\bmeadow/i, 'plains'],
  [/\bprairie/i, 'plains'],
  [/\bopen\s+(?:field|ground|terrain)/i, 'plains'],
];

/**
 * Detect terrain type from a wilderness room description.
 */
export function detectHexTerrain(description: string): HexTerrainType {
  for (const [re, terrain] of TERRAIN_PATTERNS) {
    if (re.test(description)) return terrain;
  }
  return 'unknown';
}

/** Short labels for display inside hexes */
export const TERRAIN_LABELS: Record<HexTerrainType, string> = {
  plains: 'Plains',
  mountains: 'Mtns',
  water: 'Water',
  ocean: 'Ocean',
  farmland: 'Farm',
  woods: 'Woods',
  hills: 'Hills',
  swamp: 'Swamp',
  desert: 'Desert',
  wasteland: 'Waste',
  snow: 'Snow',
  unknown: '?',
};
