/**
 * Map marker/icon vocabulary shared by the hex map and the town map:
 * auto-classification rules (corpus-derived) and the canvas glyph painters
 * used both on the maps and in the Shift+click marker picker.
 *
 * Hex landmarks: DartMUD's hex art annotates cells with landmark text
 * ("O) a jagged cave in the side of a mountain"). Mining 5 years of logs
 * produced a small stable vocabulary — settlements, fortresses, towers,
 * caves/openings, temples, graveyards, camps/pavilions, farms, and
 * boats/landings — which auto-classifies to a distinct icon. Anything
 * else keeps the generic landmark diamond. Users can override any hex
 * from the picker; an explicit choice is never re-classified.
 *
 * Town rooms: classified from the room name (banks, shops, inns, temples,
 * smithies, stables) plus the description for bulletin boards.
 */

/** Landmark/POI gold — one source for the map glyphs, the picker swatches,
 *  and the legend, so retuning it can't leave them mismatched. */
export const MARKER_COLOR = '#e8c97a';

// ---------------------------------------------------------------------------
// Hex landmark markers
// ---------------------------------------------------------------------------

export type HexMarkerType =
  | 'town'
  | 'castle'
  | 'tower'
  | 'cave'
  | 'temple'
  | 'grave'
  | 'camp'
  | 'farm'
  | 'boat';

export const HEX_MARKER_TYPES: { type: HexMarkerType; label: string }[] = [
  { type: 'town', label: 'Town' },
  { type: 'castle', label: 'Castle' },
  { type: 'tower', label: 'Tower' },
  { type: 'cave', label: 'Cave' },
  { type: 'temple', label: 'Temple' },
  { type: 'grave', label: 'Graveyard' },
  { type: 'camp', label: 'Camp' },
  { type: 'farm', label: 'Farm' },
  { type: 'boat', label: 'Boat/Dock' },
];

/** Ordered — first match wins ("a path leading to a fortress" is a castle,
 *  not a path; settlements outrank the buildings that make them up). */
const HEX_MARKER_RULES: [HexMarkerType, RegExp][] = [
  ['town', /\b(?:town|village|city|hamlet)\b/i],
  ['castle', /\b(?:castle|fortress|keep|citadel|palace)\b/i],
  ['tower', /\b(?:tower|windmill|lighthouse)\b/i],
  ['temple', /\b(?:temple|shrine|abbey|monastery|church|cathedral)\b/i],
  ['grave', /\b(?:graveyard|cemetery|crypt|tombs?|barrow)\b/i],
  [
    'cave',
    /\b(?:caves?|cavern|chasm|crater|cave mouth|dark opening|opening in the (?:hills?|mountains?|rocks?)|cleft in the rocks?|gap in the hills?|hole nestled)\b/i,
  ],
  ['camp', /\b(?:tents?|pavilions?|campfire|encampment|camp)\b/i],
  ['farm', /\b(?:farms?|plantation|orchard|vineyard)\b/i],
  ['boat', /\b(?:rowboat|barge|dhow|ferry|dock|ship|galley|sloop)\b/i],
];

/** Classify a landmark description → marker type, or null (generic diamond). */
export function classifyLandmark(text: string): HexMarkerType | null {
  for (const [type, re] of HEX_MARKER_RULES) {
    if (re.test(text)) return type;
  }
  return null;
}

/** Classify a cell from all its landmarks — first classifiable one wins.
 *  (One definition, used by both live re-classification and load.) */
export function classifyLandmarks(texts: string[]): HexMarkerType | null {
  for (const text of texts) {
    const m = classifyLandmark(text);
    if (m) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Town room icons
// ---------------------------------------------------------------------------

export type RoomIconType = 'bank' | 'shop' | 'inn' | 'temple' | 'smithy' | 'stable' | 'board';

export const ROOM_ICON_TYPES: { type: RoomIconType; label: string }[] = [
  { type: 'bank', label: 'Bank' },
  { type: 'shop', label: 'Shop' },
  { type: 'inn', label: 'Inn/Tavern' },
  { type: 'temple', label: 'Temple' },
  { type: 'smithy', label: 'Smithy' },
  { type: 'stable', label: 'Stable' },
  { type: 'board', label: 'Bulletin Board' },
];

const ROOM_ICON_NAME_RULES: [RoomIconType, RegExp][] = [
  ['bank', /\bbank\b/i],
  ['inn', /\b(?:inn|tavern|taproom|pub|alehouse|common room)\b/i],
  ['temple', /\b(?:temple|church|shrine|chapel|abbey|cathedral|sanctuary)\b/i],
  ['smithy', /\b(?:smithy|forge|blacksmith|smith's)\b/i],
  ['stable', /\bstables?\b/i],
  [
    'shop',
    /\b(?:shop|store|market|bakery|butcher|tailor|outfitter|grocer|apothecary|alchemist|trading post|armou?ry|fletcher|jewell?er|emporium|clothier|tannery|pottery)\b/i,
  ],
];

/** Classify a room by name (and description, for bulletin boards). */
export function classifyRoomIcon(name: string, desc: string): RoomIconType | null {
  for (const [type, re] of ROOM_ICON_NAME_RULES) {
    if (re.test(name)) return type;
  }
  if (/\bbulletin board\b/i.test(name) || /\bbulletin board\b/i.test(desc)) return 'board';
  return null;
}

// ---------------------------------------------------------------------------
// Glyph painters
// ---------------------------------------------------------------------------

export type MarkerGlyph = HexMarkerType | RoomIconType;

/**
 * Paint a marker glyph centered at (x, y). `s` is the half-extent (the
 * hex map's town house uses ~HEX_SIZE*0.22). `color` is the icon color,
 * `bg` the map background (used to punch out doors/openings).
 */
export function paintMarkerGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: MarkerGlyph,
  x: number,
  y: number,
  s: number,
  color: string,
  bg: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (glyph) {
    case 'town': {
      // House: roof + walls + punched door
      const baseY = y + s * 0.9;
      const wallTop = y - s * 0.1;
      ctx.fillRect(x - s * 0.8, wallTop, s * 1.6, baseY - wallTop);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.1, wallTop);
      ctx.lineTo(x, y - s * 1.1);
      ctx.lineTo(x + s * 1.1, wallTop);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.22, baseY - s * 0.8, s * 0.44, s * 0.8);
      break;
    }
    case 'castle': {
      // Curtain wall with battlements and two flanking towers
      const baseY = y + s * 0.9;
      ctx.fillRect(x - s * 0.55, y - s * 0.4, s * 1.1, baseY - (y - s * 0.4));
      ctx.fillRect(x - s * 1.05, y - s * 0.75, s * 0.5, baseY - (y - s * 0.75));
      ctx.fillRect(x + s * 0.55, y - s * 0.75, s * 0.5, baseY - (y - s * 0.75));
      // Battlement notches (punched)
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.2, y - s * 0.4, s * 0.16, s * 0.22);
      ctx.fillRect(x + s * 0.06, y - s * 0.4, s * 0.16, s * 0.22);
      ctx.fillRect(x - s * 0.88, y - s * 0.75, s * 0.16, s * 0.22);
      ctx.fillRect(x + s * 0.72, y - s * 0.75, s * 0.16, s * 0.22);
      // Gate
      ctx.fillRect(x - s * 0.18, baseY - s * 0.6, s * 0.36, s * 0.6);
      break;
    }
    case 'tower': {
      // Single tall tower with battlements
      const baseY = y + s * 0.95;
      ctx.fillRect(x - s * 0.35, y - s * 0.85, s * 0.7, baseY - (y - s * 0.85));
      ctx.fillRect(x - s * 0.5, y - s * 1.05, s, s * 0.3);
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.12, y - s * 1.05, s * 0.24, s * 0.18);
      ctx.fillRect(x - s * 0.12, baseY - s * 0.45, s * 0.24, s * 0.45);
      break;
    }
    case 'cave': {
      // Hill arch with a punched dark mouth
      ctx.beginPath();
      ctx.moveTo(x - s * 1.05, y + s * 0.9);
      ctx.quadraticCurveTo(x, y - s * 1.25, x + s * 1.05, y + s * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.42, y + s * 0.9);
      ctx.quadraticCurveTo(x, y - s * 0.25, x + s * 0.42, y + s * 0.9);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'temple': {
      // Pediment over columns
      const colTop = y - s * 0.25;
      const baseY = y + s * 0.9;
      ctx.beginPath();
      ctx.moveTo(x - s * 1.05, colTop);
      ctx.lineTo(x, y - s * 1.05);
      ctx.lineTo(x + s * 1.05, colTop);
      ctx.closePath();
      ctx.fill();
      for (const cx of [-0.75, -0.25, 0.25, 0.75]) {
        ctx.fillRect(x + s * cx - s * 0.11, colTop + s * 0.12, s * 0.22, baseY - colTop - s * 0.12);
      }
      ctx.fillRect(x - s * 0.95, baseY - s * 0.12, s * 1.9, s * 0.16);
      break;
    }
    case 'grave': {
      // Tombstone with a punched cross
      const baseY = y + s * 0.9;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.55, baseY);
      ctx.lineTo(x - s * 0.55, y - s * 0.35);
      ctx.arc(x, y - s * 0.35, s * 0.55, Math.PI, 0);
      ctx.lineTo(x + s * 0.55, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 0.95, baseY - s * 0.1, s * 1.9, s * 0.14);
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.08, y - s * 0.62, s * 0.16, s * 0.75);
      ctx.fillRect(x - s * 0.3, y - s * 0.42, s * 0.6, s * 0.16);
      break;
    }
    case 'camp': {
      // Tent with a punched door flap
      ctx.beginPath();
      ctx.moveTo(x - s * 1.05, y + s * 0.9);
      ctx.lineTo(x, y - s * 0.95);
      ctx.lineTo(x + s * 1.05, y + s * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.28, y + s * 0.9);
      ctx.lineTo(x, y + s * 0.05);
      ctx.lineTo(x + s * 0.28, y + s * 0.9);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'farm': {
      // Barn with a silo
      const baseY = y + s * 0.9;
      const wallTop = y + s * 0.05;
      ctx.fillRect(x - s * 0.95, wallTop, s * 1.3, baseY - wallTop);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.1, wallTop);
      ctx.lineTo(x - s * 0.3, y - s * 0.65);
      ctx.lineTo(x + s * 0.5, wallTop);
      ctx.closePath();
      ctx.fill();
      // Silo
      ctx.fillRect(x + s * 0.55, y - s * 0.55, s * 0.5, baseY - (y - s * 0.55));
      ctx.beginPath();
      ctx.arc(x + s * 0.8, y - s * 0.55, s * 0.25, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'boat': {
      // Hull + mast + sail
      ctx.beginPath();
      ctx.moveTo(x - s * 1.0, y + s * 0.25);
      ctx.lineTo(x + s * 1.0, y + s * 0.25);
      ctx.lineTo(x + s * 0.55, y + s * 0.85);
      ctx.lineTo(x - s * 0.55, y + s * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 0.06, y - s * 1.0, s * 0.12, s * 1.25);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.1, y - s * 0.95);
      ctx.lineTo(x + s * 0.85, y + s * 0.05);
      ctx.lineTo(x + s * 0.1, y + s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bank': {
      // Coin: disc with a punched slot
      ctx.beginPath();
      ctx.arc(x, y, s * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x - s * 0.12, y - s * 0.45, s * 0.24, s * 0.9);
      break;
    }
    case 'shop': {
      // Storefront with a scalloped awning
      const baseY = y + s * 0.9;
      ctx.fillRect(x - s * 0.8, y - s * 0.1, s * 1.6, baseY - (y - s * 0.1));
      ctx.fillRect(x - s * 1.0, y - s * 0.5, s * 2.0, s * 0.42);
      ctx.beginPath();
      for (const cx of [-0.67, 0, 0.67]) {
        ctx.moveTo(x + s * cx + s * 0.33, y - s * 0.08);
        ctx.arc(x + s * cx, y - s * 0.08, s * 0.33, 0, Math.PI);
      }
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.5, y + s * 0.15, s * 1.0, s * 0.45);
      break;
    }
    case 'inn': {
      // Tankard: mug with a handle and a foam line
      ctx.fillRect(x - s * 0.7, y - s * 0.65, s * 1.15, s * 1.55);
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.beginPath();
      ctx.arc(x + s * 0.62, y + s * 0.1, s * 0.42, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.7, y - s * 0.38, s * 1.15, s * 0.14);
      break;
    }
    case 'smithy': {
      // Anvil
      ctx.fillRect(x - s * 0.85, y - s * 0.55, s * 1.7, s * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.85, y - s * 0.55);
      ctx.quadraticCurveTo(x - s * 1.15, y - s * 0.15, x - s * 0.55, y - s * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 0.28, y - s * 0.05, s * 0.56, s * 0.55);
      ctx.fillRect(x - s * 0.6, y + s * 0.5, s * 1.2, s * 0.3);
      break;
    }
    case 'stable': {
      // Horseshoe
      ctx.lineWidth = Math.max(1, s * 0.34);
      ctx.beginPath();
      ctx.arc(x, y - s * 0.05, s * 0.62, Math.PI * 0.85, Math.PI * 0.15, false);
      ctx.stroke();
      ctx.fillRect(x - s * 0.85, y + s * 0.32, s * 0.36, s * 0.32);
      ctx.fillRect(x + s * 0.49, y + s * 0.32, s * 0.36, s * 0.32);
      break;
    }
    case 'board': {
      // Bulletin board with punched notes
      ctx.fillRect(x - s * 0.95, y - s * 0.8, s * 1.9, s * 1.3);
      ctx.fillRect(x - s * 0.1, y + s * 0.5, s * 0.2, s * 0.45);
      ctx.fillStyle = bg;
      ctx.fillRect(x - s * 0.65, y - s * 0.5, s * 0.5, s * 0.45);
      ctx.fillRect(x + s * 0.1, y - s * 0.45, s * 0.45, s * 0.6);
      break;
    }
  }
  ctx.restore();
}
