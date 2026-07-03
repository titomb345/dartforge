/**
 * Hex art parser — extracts terrain data from DartMUD ASCII hex art.
 *
 * DartMUD renders hex wilderness as ASCII art after "You gaze at your surroundings."
 * The art shows a hex grid with terrain characters inside each hex cell.
 * This parser extracts the terrain type for each visible hex relative to the center.
 *
 * Hex art structure:
 *   - Borders: 5-char sequences of '-' and/or '*' (paths can replace border dashes)
 *   - Terrain chars: . (plains), ^ (mountains), ~ (water/ocean), " (farmland),
 *     w (woods), h (hills), s (swamp), x (wasteland), - (desert, when not a border)
 *   - Landmarks: letters/numbers placed inside hex content (e.g., O, S, C, 1, 2)
 *   - Path markers: * inside hex content
 *
 * Variable ring sizes based on night vision:
 *   - 0 rings = 1 hex (just center)
 *   - 1 ring = 7 hexes (center + 6 neighbors)
 *   - 2 rings = 19 hexes (center + 6 + 12 outer)
 */

import { TERRAIN_CHAR_MAP, type HexTerrainType } from './hexTerrainPatterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedHexArt {
  /** Terrain of each visible hex, keyed by "q,r" relative to center */
  hexes: Map<string, HexTerrainType>;
  /**
   * Hexes (by "q,r" rel key) containing river marks ('!'). Rivers run
   * THROUGH hexes of other terrain, so they're an overlay, not a terrain —
   * majority voting would otherwise hide them entirely.
   */
  rivers: string[];
  /** Number of rings visible (0, 1, or 2) */
  rings: number;
  /**
   * Landmark entries found in the art legend. q/r are the landmark's hex
   * relative to center, or null when the label char couldn't be located
   * unambiguously in the art.
   */
  landmarks: { label: string; description: string; q: number | null; r: number | null }[];
  /** The raw art lines (for debugging) */
  rawLines: string[];
  /** Which parser produced this result (template = high confidence) */
  source: 'template' | 'search';
}

/** A detected hex border in the art */
interface Border {
  line: number;
  col: number;
}

/** A hex cell defined by its borders and position */
interface HexCell {
  topBorder: Border;
  bottomBorder: Border;
  displayCol: number; // column position in the art
  q: number;
  r: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Terrain characters that can appear inside hex cells */
const TERRAIN_CHARS = new Set(Object.keys(TERRAIN_CHAR_MAP));


/** Border pattern: 5 consecutive '-', '*', 'c' (cliff), or 'x' (cliff/wasteland edge) characters */
const BORDER_RE = /[-*cx]{5}/g;

/** Landmark annotation on the right side of hex art: "  X) description..." */
const LANDMARK_SUFFIX_RE = /\s+[A-Za-z0-9#+@?^~!]\)\s+\S.*$/;

/**
 * Continuation text from multi-line landmark descriptions, e.g.:
 *   `             /     \                 small holes.`
 * The right side has 8+ spaces then text (not hex art content).
 */
const CONTINUATION_SUFFIX_RE = /(?<=[/\\*\-=c])\s{8,}\S.*$/;

// ---------------------------------------------------------------------------
// Hex art detection
// ---------------------------------------------------------------------------

/**
 * Strip landmark annotations and continuation text from the right side of a hex art line.
 * Handles both initial annotations (`S) a large city.`) and wrapped continuations
 * (`                 small holes.`) that follow on the next line.
 */
function stripLandmarkSuffix(line: string): string {
  // First try the standard landmark pattern
  const stripped = line.replace(LANDMARK_SUFFIX_RE, '');
  if (stripped !== line) return stripped;
  // Then try continuation text: 8+ spaces after the last structural char, then text
  const stripped2 = line.replace(CONTINUATION_SUFFIX_RE, '');
  if (stripped2 !== line) return stripped2;
  // Last resort: if the trailing content after the last / or \ contains English words
  // (non-terrain letters like a,b,d,f,g,i,j,k,l,m,n,o,p,q,r,t,u,v,y,z),
  // strip it. This handles short-gap continuations like "\     water."
  const lastStructIdx = Math.max(line.lastIndexOf('/'), line.lastIndexOf('\\'));
  if (lastStructIdx > 0) {
    const trailing = line.slice(lastStructIdx + 1);
    // If trailing has 3+ spaces then text with non-terrain letters, strip it
    const wordMatch = trailing.match(/^(\s{3,})([a-z].*)/i);
    if (wordMatch) {
      const word = wordMatch[2];
      // Check for letters that AREN'T terrain chars (terrain: w, h, s, x)
      if (/[abdefgijklmnopqrtuvyz]/i.test(word)) {
        return line.slice(0, lastStructIdx + 1);
      }
    }
  }
  return line;
}

/**
 * Check if a line is part of hex art (contains borders or hex slope patterns).
 */
export function isHexArtLine(line: string): boolean {
  // Strip \r (Windows line endings) and landmark annotations before testing
  const cleaned = stripLandmarkSuffix(line.replace(/\r$/, ''));

  if (BORDER_RE.test(cleaned)) {
    BORDER_RE.lastIndex = 0;
    return true;
  }

  const trimmed = cleaned.trim();
  if (!trimmed) return false;

  // Structural chars: / \ * (paths) = (roads) c (cliffs) x (cliff edges) can form hex cell walls
  // Slope lines: start and end with structural characters
  if (/^[/\\*=cx]/.test(trimmed) && /[/\\*=cx]$/.test(trimmed)) return true;

  // Wide middle lines: start and end with - or * or = or c or x (length >= 5 for 0-ring art)
  if (/^[-*=cx]/.test(trimmed) && /[-*=cx]$/.test(trimmed) && trimmed.length >= 5) return true;

  // Short lines (0-1 ring art) that contain structural chars anywhere
  if (trimmed.length <= 12 && /[/\\]/.test(trimmed)) return true;

  // Slope lines with terrain spill at edges — the rightmost hex cell's terrain
  // chars can extend past the last structural char
  if (/^[/\\*=cx]/.test(trimmed) && /[/\\*=cx]/.test(trimmed)) {
    const lastStruct = Math.max(
      trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'),
      trimmed.lastIndexOf('*'), trimmed.lastIndexOf('='),
      trimmed.lastIndexOf('c'), trimmed.lastIndexOf('x'));
    const trailing = trimmed.slice(lastStruct + 1);
    if (trailing.length <= 8 && /^[.^~"whsx\-* =cx]*$/.test(trailing)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Border detection
// ---------------------------------------------------------------------------

/**
 * Relaxed border pattern: 5+ chars that are mostly border chars, allowing
 * up to 1 terrain char mixed in (e.g., `-*^**` where ^ is mountain terrain
 * bleeding into a path-heavy border).
 */
const RELAXED_BORDER_RE = /[-*cx]{2,}[.^~"whsx][-*cx]{2,}/g;

/**
 * Find all hex borders (5-char sequences of - and/or *) in the art lines.
 * Uses strict matching first, then falls back to relaxed matching if
 * not enough borders are found.
 */
function findBorders(lines: string[]): Border[] {
  const borders: Border[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    BORDER_RE.lastIndex = 0;
    let match;
    while ((match = BORDER_RE.exec(line)) !== null) {
      borders.push({ line: lineIdx, col: match.index });
    }
  }

  // If we don't have enough borders for even a single hex (need >= 2),
  // retry with relaxed matching that allows 1 terrain char in the border
  if (borders.length < 2) {
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      RELAXED_BORDER_RE.lastIndex = 0;
      let match;
      while ((match = RELAXED_BORDER_RE.exec(line)) !== null) {
        // Only add if we don't already have a border at this line+col
        const exists = borders.some(b => b.line === lineIdx && Math.abs(b.col - match!.index) <= 1);
        if (!exists) {
          borders.push({ line: lineIdx, col: match.index });
        }
      }
    }
  }

  return borders;
}

/**
 * Group borders by their column position.
 * Returns a map of column -> sorted list of line numbers.
 */
function groupBordersByColumn(borders: Border[]): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (const b of borders) {
    // Allow ±1 column tolerance for slight alignment variations
    let matched = false;
    for (const [col, lines] of groups) {
      if (Math.abs(b.col - col) <= 1) {
        lines.push(b.line);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(b.col, [b.line]);
    }
  }
  // Sort each group's lines
  for (const lines of groups.values()) {
    lines.sort((a, b) => a - b);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Coordinate mapping
// ---------------------------------------------------------------------------

/**
 * For a hex grid with `ringCount` rings, compute the expected r range for column q.
 */
function rRange(q: number, ringCount: number): { min: number; max: number } {
  return {
    min: Math.max(-ringCount, -ringCount - q),
    max: Math.min(ringCount, ringCount - q),
  };
}

/**
 * Map display columns to axial q values and assign r coordinates to hex cells.
 */
function assignCoordinates(
  columnGroups: Map<number, number[]>,
  ringCount: number
): HexCell[] {
  // Sort columns by position (left to right)
  const sortedCols = [...columnGroups.entries()].sort((a, b) => a[0] - b[0]);

  if (sortedCols.length === 0) return [];

  // The center column has the most borders (ringCount * 2 + 2 borders for ringCount + 1 cells)
  // Find the center column index
  let maxBorders = 0;
  let centerIdx = 0;
  for (let i = 0; i < sortedCols.length; i++) {
    if (sortedCols[i][1].length > maxBorders) {
      maxBorders = sortedCols[i][1].length;
      centerIdx = i;
    }
  }

  const cells: HexCell[] = [];

  for (let i = 0; i < sortedCols.length; i++) {
    const [displayCol, borderLines] = sortedCols[i];
    const q = i - centerIdx; // q=0 at center column

    // Get expected r range for this q
    const range = rRange(q, ringCount);

    // Each pair of consecutive borders defines a hex cell
    for (let j = 0; j < borderLines.length - 1; j++) {
      const r = range.min + j;
      if (r > range.max) break; // safety

      cells.push({
        topBorder: { line: borderLines[j], col: displayCol },
        bottomBorder: { line: borderLines[j + 1], col: displayCol },
        displayCol,
        q,
        r,
      });
    }
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Terrain extraction
// ---------------------------------------------------------------------------

/**
 * Extract terrain type from a hex cell by sampling characters between its
 * borders, along with any landmark label characters found inside the cell.
 */
function extractCellData(
  cell: HexCell,
  lines: string[]
): { terrain: HexTerrainType; river: boolean; labelChars: Map<string, number> } {
  const terrainCounts = new Map<string, number>();
  const labelChars = new Map<string, number>();

  // Sample 3 content lines between top and bottom borders
  const startLine = cell.topBorder.line + 1;
  const endLine = cell.bottomBorder.line;

  for (let lineIdx = startLine; lineIdx < endLine; lineIdx++) {
    if (lineIdx >= lines.length) break;
    const line = lines[lineIdx];

    // Sample characters in the column range of this hex
    // The hex content is roughly centered on the border position
    // Border is 5 chars wide, hex content extends ~1 char wider on each side
    const colStart = cell.topBorder.col - 1;
    const colEnd = cell.topBorder.col + 6;

    for (let col = colStart; col < colEnd && col < line.length; col++) {
      if (col < 0) continue;
      const ch = line[col];
      if (TERRAIN_CHARS.has(ch)) {
        terrainCounts.set(ch, (terrainCounts.get(ch) || 0) + 1);
      } else if (/[0-9A-Z#+]/.test(ch)) {
        labelChars.set(ch, (labelChars.get(ch) || 0) + 1);
      }
    }
  }

  // Find the most common terrain character
  let bestChar = '';
  let bestCount = 0;
  for (const [ch, count] of terrainCounts) {
    if (count > bestCount) {
      bestChar = ch;
      bestCount = count;
    }
  }

  const terrain =
    bestChar && TERRAIN_CHAR_MAP[bestChar] ? TERRAIN_CHAR_MAP[bestChar] : ('unknown' as const);
  return { terrain, river: (terrainCounts.get('!') ?? 0) >= 1, labelChars };
}

// ---------------------------------------------------------------------------
// Landmark parsing
// ---------------------------------------------------------------------------

/** Parse landmark legend from the right side of hex art lines */
function parseLandmarks(
  lines: string[]
): { label: string; description: string }[] {
  const landmarks: { label: string; description: string }[] = [];
  // Landmarks appear as "X) description" on the right side of art lines.
  // Labels can be digits, letters, or symbols — even terrain chars (^ ~ !).
  const LANDMARK_RE = /\s+([A-Za-z0-9#+@?^~!])\)\s+(\S.*)$/;

  for (const line of lines) {
    const match = LANDMARK_RE.exec(line);
    if (match) {
      landmarks.push({ label: match[1], description: match[2].trim() });
    }
  }

  return landmarks;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Template parser (primary)
// ---------------------------------------------------------------------------
//
// DartMUD renders hex art from a fixed template. For a view with R rings:
//   - the art is exactly 8R + 5 lines tall
//   - the top border of cell (q, r) sits at line 4R + 2q + 4r, column 6q + 6R + 2
//   - each border is 5 chars wide; cell content occupies the 3 lines between
//     consecutive borders
// This makes extraction deterministic and immune to terrain noise — critical
// in deserts, where the terrain char '-' is the same as the border char.

/** Border/structural chars that may appear at border positions */
const BORDER_CHARS = new Set(['-', '*', 'c', 'x', '=']);

/**
 * Try to parse hex art using the fixed template. Returns null when the art
 * doesn't validate against the template (caller falls back to search parsing).
 */
function parseHexArtTemplate(artLines: string[]): ParsedHexArt | null {
  if (artLines.length < 5) return null;

  // Locate the top border on the first line: a 5-char border run whose
  // column encodes the ring count (col = 6R + 2).
  const first = artLines[0];
  let topCol = -1;
  for (let col = 0; col + 5 <= first.length; col++) {
    if (
      BORDER_CHARS.has(first[col]) &&
      BORDER_CHARS.has(first[col + 1]) &&
      BORDER_CHARS.has(first[col + 2]) &&
      BORDER_CHARS.has(first[col + 3]) &&
      BORDER_CHARS.has(first[col + 4])
    ) {
      topCol = col;
      break;
    }
    if (first[col] !== ' ') return null; // unexpected leading content
  }
  if (topCol < 2 || (topCol - 2) % 6 !== 0) return null;

  const rings = (topCol - 2) / 6;
  if (rings > 4) return null;

  // Cell specs sorted by top-border line (top-to-bottom processing order)
  const cellsSpec: { q: number; r: number; line: number; col: number }[] = [];
  for (let q = -rings; q <= rings; q++) {
    const rMin = Math.max(-rings, -rings - q);
    const rMax = Math.min(rings, rings - q);
    for (let r = rMin; r <= rMax; r++) {
      cellsSpec.push({ q, r, line: 4 * rings + 2 * q + 4 * r, col: 6 * q + 6 * rings + 2 });
    }
  }
  cellsSpec.sort((a, b) => a.line - b.line || a.col - b.col);

  // Validate borders per cell (4 of 5 chars must be border chars — terrain
  // noise can bleed 1 char). Line fragmentation shifts every row after the
  // break, so stop at the first bad border row and keep only the clean top
  // portion of the art. This turns interrupted/truncated art into a correct
  // partial patch instead of a scrambled full one.
  const validBorderRow = (lineIdx: number, col: number): boolean => {
    const line = artLines[lineIdx];
    if (line === undefined) return false;
    let borderChars = 0;
    for (let i = 0; i < 5; i++) {
      const ch = line[col + i];
      if (ch !== undefined && BORDER_CHARS.has(ch)) borderChars++;
    }
    return borderChars >= 4;
  };

  let firstBadLine = Infinity;
  for (const spec of cellsSpec) {
    for (const borderLine of [spec.line, spec.line + 4]) {
      if (borderLine >= firstBadLine) continue;
      if (!validBorderRow(borderLine, spec.col)) {
        firstBadLine = Math.min(firstBadLine, borderLine);
      }
    }
  }

  const validCells = cellsSpec.filter((spec) => spec.line + 4 < firstBadLine);
  // Not enough clean structure to trust the template — let the caller fall back
  // (0-ring art has a single cell, so accept whatever the layout can hold)
  if (validCells.length < Math.min(4, cellsSpec.length)) return null;

  // Extract terrain + labels per cell
  const hexes = new Map<string, HexTerrainType>();
  const rivers: string[] = [];
  const labelOccurrences = new Map<string, { q: number; r: number; count: number }[]>();

  for (const spec of validCells) {
    const terrainCounts = new Map<string, number>();
    const cellLabels = new Map<string, number>();
    for (let lineIdx = spec.line + 1; lineIdx <= spec.line + 3; lineIdx++) {
      const line = artLines[lineIdx];
      if (line === undefined) continue;
      for (let col = spec.col - 1; col <= spec.col + 5; col++) {
        if (col < 0 || col >= line.length) continue;
        const ch = line[col];
        if (TERRAIN_CHARS.has(ch)) {
          terrainCounts.set(ch, (terrainCounts.get(ch) || 0) + 1);
        } else if (/[0-9A-Z#+@?o]/.test(ch)) {
          cellLabels.set(ch, (cellLabels.get(ch) || 0) + 1);
        }
      }
    }

    let bestChar = '';
    let bestCount = 0;
    for (const [ch, count] of terrainCounts) {
      if (count > bestCount) {
        bestChar = ch;
        bestCount = count;
      }
    }
    hexes.set(
      `${spec.q},${spec.r}`,
      bestChar && TERRAIN_CHAR_MAP[bestChar] ? TERRAIN_CHAR_MAP[bestChar] : 'unknown'
    );
    if ((terrainCounts.get('!') ?? 0) >= 1) rivers.push(`${spec.q},${spec.r}`);

    for (const [ch, count] of cellLabels) {
      const list = labelOccurrences.get(ch) ?? [];
      list.push({ q: spec.q, r: spec.r, count });
      labelOccurrences.set(ch, list);
    }
  }

  const rawLandmarks = parseLandmarks(artLines);
  const landmarks = rawLandmarks.map((l) => {
    const occurrences = labelOccurrences.get(l.label);
    if (occurrences && occurrences.length === 1 && occurrences[0].count === 1) {
      return { ...l, q: occurrences[0].q, r: occurrences[0].r };
    }
    return { ...l, q: null, r: null };
  });

  return { hexes, rivers, rings, landmarks, rawLines: artLines, source: 'template' };
}

/**
 * Parse DartMUD hex art lines into structured terrain data.
 * Uses the fixed-template parser first; falls back to search-based parsing
 * for art that doesn't match the template.
 *
 * @param artLines - The raw hex art lines (after "You gaze at your surroundings." and blank line)
 * @returns Parsed hex data with terrain for each visible hex, or null if parsing fails
 */
export function parseHexArt(artLines: string[]): ParsedHexArt | null {
  const templated = parseHexArtTemplate(artLines);
  if (templated) return templated;
  return parseHexArtSearch(artLines);
}

/**
 * Search-based fallback parser (the original implementation).
 */
function parseHexArtSearch(artLines: string[]): ParsedHexArt | null {
  if (artLines.length < 5) return null;

  // Step 0: Strip landmark annotations from art lines for parsing
  // (keep originals for landmark extraction and rawLines)
  const cleanedLines = artLines.map(stripLandmarkSuffix);

  // Step 1: Find all borders
  const borders = findBorders(cleanedLines);
  if (borders.length < 2) return null;

  // Step 2: Group borders by column
  const columnGroups = groupBordersByColumn(borders);
  if (columnGroups.size === 0) return null;

  // Step 3: Determine ring count from number of display columns
  // 1 column = 0 rings, 3 columns = 1 ring, 5 columns = 2 rings
  const numColumns = columnGroups.size;
  let ringCount: number;
  if (numColumns <= 1) {
    ringCount = 0;
  } else if (numColumns <= 3) {
    ringCount = 1;
  } else {
    ringCount = 2;
  }

  // Step 4: Assign coordinates to hex cells
  const cells = assignCoordinates(columnGroups, ringCount);
  if (cells.length === 0) return null;

  // Step 5: Extract terrain + label chars for each cell (use cleaned lines)
  const hexes = new Map<string, HexTerrainType>();
  const rivers: string[] = [];
  const labelOccurrences = new Map<string, { cell: HexCell; count: number }[]>();
  for (const cell of cells) {
    const { terrain, river, labelChars } = extractCellData(cell, cleanedLines);
    hexes.set(`${cell.q},${cell.r}`, terrain);
    if (river) rivers.push(`${cell.q},${cell.r}`);
    for (const [ch, count] of labelChars) {
      const list = labelOccurrences.get(ch) ?? [];
      list.push({ cell, count });
      labelOccurrences.set(ch, list);
    }
  }

  // Step 6: Parse landmarks and locate each label char in the art.
  // A landmark gets a position only when its label char appears in exactly
  // one cell (always true for digits/uppercase labels; lowercase labels that
  // collide with terrain chars stay unpositioned).
  const rawLandmarks = parseLandmarks(artLines);
  const landmarks = rawLandmarks.map((l) => {
    const occurrences = labelOccurrences.get(l.label);
    if (occurrences && occurrences.length === 1 && occurrences[0].count === 1) {
      return { ...l, q: occurrences[0].cell.q, r: occurrences[0].cell.r };
    }
    return { ...l, q: null, r: null };
  });

  return {
    hexes,
    rivers,
    rings: ringCount,
    landmarks,
    rawLines: artLines,
    source: 'search',
  };
}

/**
 * Extract hex art lines from MUD output starting after "You gaze at your surroundings."
 *
 * @param lines - Array of output lines
 * @param startIndex - Index of the "You gaze at your surroundings." line
 * @returns The hex art lines, or null if no valid art found
 */
export function extractHexArtLines(
  lines: string[],
  startIndex: number
): string[] | null {
  let i = startIndex + 1;

  // Skip blank lines and weather/status messages before hex art starts
  // (e.g., "You sweat in the heat." can appear between trigger and art)
  let skipped = 0;
  while (i < lines.length && skipped < 4) {
    const stripped = lines[i].replace(/\r$/, '').trim();
    if (stripped === '' || (!isHexArtLine(lines[i]) && stripped.length < 40 && !stripped.includes('-----'))) {
      i++;
      skipped++;
    } else {
      break;
    }
  }

  const artLines: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (isHexArtLine(line)) {
      // Store lines with \r stripped for consistent downstream processing
      artLines.push(line.replace(/\r$/, ''));
      i++;
    } else if (line.replace(/\r$/, '').trim() === '' && artLines.length > 0 && artLines.length < 3) {
      artLines.push(line.replace(/\r$/, ''));
      i++;
    } else {
      break;
    }
  }

  return artLines.length >= 5 ? artLines : null;
}

/**
 * Generate a terrain fingerprint string from parsed hex art.
 * Format: "center:ring1_N,ring1_NE,ring1_SE,ring1_S,ring1_SW,ring1_NW:ring2_..."
 * This can be used to uniquely identify a position on the hex map.
 */
export function generateFingerprint(parsed: ParsedHexArt): string {
  const center = parsed.hexes.get('0,0') || 'unknown';

  if (parsed.rings === 0) return center;

  // Ring 1 directions in order: N, NE, SE, S, SW, NW
  const ring1Coords: [number, number][] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];
  const ring1 = ring1Coords
    .map(([q, r]) => parsed.hexes.get(`${q},${r}`) || '?')
    .join(',');

  if (parsed.rings === 1) return `${center}:${ring1}`;

  // Ring 2 (12 hexes) in clockwise order starting from far north
  const ring2Coords: [number, number][] = [
    [0, -2],
    [1, -2],
    [2, -2],
    [2, -1],
    [2, 0],
    [1, 1],
    [0, 2],
    [-1, 2],
    [-2, 2],
    [-2, 1],
    [-2, 0],
    [-1, -1],
  ];
  const ring2 = ring2Coords
    .map(([q, r]) => parsed.hexes.get(`${q},${r}`) || '?')
    .join(',');

  return `${center}:${ring1}:${ring2}`;
}
