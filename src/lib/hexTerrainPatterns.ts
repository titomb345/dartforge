/**
 * Hex terrain types and their ASCII hex art characters:
 *   plains(`.`), mountains(`^`), water/ocean(`~`), river(`!`), farmland(`"`),
 *   woods(`w`), hills(`h`), swamp(`s`), desert(`-`), wasteland(`x`)
 *
 * Terrain is read exclusively from hex art — descriptions vary with weather
 * and season (snow is an effect layered over the underlying hex, not a
 * terrain), while art chars stay stable year-round.
 */

export type HexTerrainType =
  | 'plains'
  | 'mountains'
  | 'water'
  | 'river'
  | 'ocean'
  | 'farmland'
  | 'woods'
  | 'hills'
  | 'swamp'
  | 'desert'
  | 'wasteland'
  | 'unknown';

/** Map ASCII hex art character to terrain type */
export const TERRAIN_CHAR_MAP: Record<string, HexTerrainType> = {
  '.': 'plains',
  '^': 'mountains',
  '~': 'water',
  '!': 'river',
  '"': 'farmland',
  w: 'woods',
  h: 'hills',
  s: 'swamp',
  '-': 'desert',
  x: 'wasteland',
};

/** Short labels for display inside hexes */
export const TERRAIN_LABELS: Record<HexTerrainType, string> = {
  plains: 'Plains',
  mountains: 'Mtns',
  water: 'Water',
  river: 'River',
  ocean: 'Ocean',
  farmland: 'Farm',
  woods: 'Woods',
  hills: 'Hills',
  swamp: 'Swamp',
  desert: 'Desert',
  wasteland: 'Waste',
  unknown: '?',
};
