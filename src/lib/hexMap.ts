/**
 * Hex map store — the global wilderness hex grid.
 *
 * The DartMUD wilderness is one fixed hex grid, so cells are keyed by
 * absolute axial coordinates. Every survey paints all visible hexes
 * (1, 7, or 19) onto this grid; the center hex is additionally marked
 * as visited.
 *
 * Islands: when the player teleports/recalls into unmapped territory and
 * the view can't be matched to any known position, mapping continues in a
 * fresh "island" (an independent coordinate frame). Islands merge back
 * into the main map when a survey inside one uniquely matches another.
 */

import type { Direction, HexCoord } from './hexUtils';
import { applyDirection, oppositeDirection, COMPASS_DIRECTIONS } from './hexUtils';
import type { HexTerrainType } from './hexTerrainPatterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HexPos {
  island: number;
  q: number;
  r: number;
}

/** Kinds of per-edge overlay marks a hex side can carry */
export type EdgeKind = 'river' | 'cliff' | 'bridge';

export interface HexCell {
  q: number;
  r: number;
  island: number;
  /** Terrain from hex art (authoritative; 'unknown' only if never resolved) */
  terrain: HexTerrainType;
  /** True if a river runs through this hex (overlay on top of terrain) */
  river: boolean;
  /** Hex sides a river runs along (drawn as blue edges) */
  riverEdges: Direction[];
  /** Hex sides with a cliff (climbing across costs concentration) */
  cliffEdges: Direction[];
  /** Hex sides with a bridge — a zero-concentration river crossing */
  bridgeEdges: Direction[];
  /** True if the player has stood in this hex */
  visited: boolean;
  visitCount: number;
  lastSeen: number;
  /** Landmark descriptions seen for this hex (deduped, capped) */
  landmarks: string[];
  /**
   * Point-of-interest marker. 'town' renders a house icon instead of the
   * landmark diamond; 'none' means the user explicitly unmarked it (auto
   * classification must not re-add); null = unclassified.
   */
  marker: 'town' | 'none' | null;
  notes: string;
  /** Directions confirmed blocked from this cell (failed moves) */
  blocked: Direction[];
  /** Last room description seen while standing here */
  description: string;
}

export interface SerializedHexMap {
  version: 2;
  cells: Record<string, HexCell>;
  pos: HexPos | null;
  nextIsland: number;
}

const MAX_LANDMARKS_PER_CELL = 4;

/** Landmark texts that clearly name a settlement → auto-mark as town */
const TOWN_RE = /\b(?:town|village|city|hamlet)\b/i;

/**
 * Movement is binary in DartMUD: a step either costs concentration or it
 * doesn't, and every concentration event (any rough hex, any river
 * crossing, any water swim) hurts the same. Routing therefore minimizes
 * the NUMBER of concentration events first — one event costs as much as
 * 1000 free steps, so no realistic detour length ever trades against an
 * extra hit — and uses free-step count only as a tiebreaker among routes
 * with equally many events. Free terrain stays at 1 (not 0) for exactly
 * that tiebreak, and so the A* distance heuristic remains admissible.
 */
const CONC_HIT = 1000;

// Concentration terrain (per Bill): mountains, hills, swamp, wasteland,
// desert — all identical. Plains, farmland, woods are free and equal.
const TERRAIN_COST: Record<HexTerrainType, number> = {
  plains: 1,
  farmland: 1,
  woods: 1,
  desert: CONC_HIT,
  hills: CONC_HIT,
  wasteland: CONC_HIT,
  swamp: CONC_HIT,
  mountains: CONC_HIT,
  river: CONC_HIT, // crossable (auto-swim) but a concentration event
  water: CONC_HIT, // swimming through — only reachable when visited
  ocean: CONC_HIT,
  unknown: 2,
};

/** Stepping across a river edge is a concentration event (swim across) */
const RIVER_CROSSING_COST = CONC_HIT;
/** A hex with a river through it likely means crossing it — same event */
const RIVER_INTERIOR_COST = CONC_HIT;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function cellKey(island: number, q: number, r: number): string {
  return `${island}:${q},${r}`;
}

export class HexMapStore {
  private cells = new Map<string, HexCell>();
  /** terrain → set of cell keys, for fast global relocalization */
  private terrainIndex = new Map<HexTerrainType, Set<string>>();
  pos: HexPos | null = null;
  nextIsland = 1;

  get size(): number {
    return this.cells.size;
  }

  get(island: number, q: number, r: number): HexCell | undefined {
    return this.cells.get(cellKey(island, q, r));
  }

  getAt(pos: HexPos): HexCell | undefined {
    return this.get(pos.island, pos.q, pos.r);
  }

  allCells(): IterableIterator<HexCell> {
    return this.cells.values();
  }

  cellsOfIsland(island: number): HexCell[] {
    const out: HexCell[] = [];
    for (const c of this.cells.values()) {
      if (c.island === island) out.push(c);
    }
    return out;
  }

  /** Distinct island ids present in the map, with cell counts */
  islandSizes(): Map<number, number> {
    const sizes = new Map<number, number>();
    for (const c of this.cells.values()) {
      sizes.set(c.island, (sizes.get(c.island) ?? 0) + 1);
    }
    return sizes;
  }

  /** The island with the most cells (the "main" map). Defaults to 0. */
  primaryIsland(): number {
    let best = 0;
    let bestCount = -1;
    for (const [island, count] of this.islandSizes()) {
      if (count > bestCount) {
        best = island;
        bestCount = count;
      }
    }
    return bestCount < 0 ? 0 : best;
  }

  /** Cell keys whose terrain matches (for relocalization candidate seeds) */
  keysWithTerrain(terrain: HexTerrainType): Set<string> | undefined {
    return this.terrainIndex.get(terrain);
  }

  parseKey(key: string): HexPos {
    const colon = key.indexOf(':');
    const comma = key.indexOf(',', colon);
    return {
      island: Number(key.slice(0, colon)),
      q: Number(key.slice(colon + 1, comma)),
      r: Number(key.slice(comma + 1)),
    };
  }

  /**
   * Paint terrain onto a cell, creating it if needed.
   * Returns true if this overwrote a *different* known terrain (a conflict).
   */
  paint(island: number, q: number, r: number, terrain: HexTerrainType, now: number): boolean {
    const key = cellKey(island, q, r);
    const existing = this.cells.get(key);
    if (!existing) {
      const cell: HexCell = {
        q,
        r,
        island,
        terrain,
        river: false,
        riverEdges: [],
        cliffEdges: [],
        bridgeEdges: [],
        marker: null,
        visited: false,
        visitCount: 0,
        lastSeen: now,
        landmarks: [],
        notes: '',
        blocked: [],
        description: '',
      };
      this.cells.set(key, cell);
      this.indexTerrain(key, terrain);
      return false;
    }

    existing.lastSeen = now;
    if (terrain === 'unknown' || existing.terrain === terrain) return false;

    const conflict = existing.terrain !== 'unknown';
    this.deindexTerrain(key, existing.terrain);
    existing.terrain = terrain;
    this.indexTerrain(key, terrain);
    return conflict;
  }

  /** Mark a river running through a cell (sticky — rivers don't move). */
  markRiver(island: number, q: number, r: number): void {
    const cell = this.cells.get(cellKey(island, q, r));
    if (cell) cell.river = true;
  }

  private edgesOf(cell: HexCell, kind: EdgeKind): Direction[] {
    if (kind === 'river') return cell.riverEdges;
    if (kind === 'cliff') return cell.cliffEdges;
    return cell.bridgeEdges;
  }

  private setEdgesOf(cell: HexCell, kind: EdgeKind, edges: Direction[]): void {
    if (kind === 'river') cell.riverEdges = edges;
    else if (kind === 'cliff') cell.cliffEdges = edges;
    else cell.bridgeEdges = edges;
  }

  /**
   * Mark a river/cliff along one side of a cell, mirroring onto the
   * neighbor's opposite side (the edge is shared). Art detection is a
   * heuristic PREVIEW — it may only touch unvisited cells; visited cells'
   * edges are owned by their room descriptions (see setVisitedEdges).
   */
  markEdge(
    kind: EdgeKind,
    island: number,
    q: number,
    r: number,
    dir: Direction,
    source: 'art' | 'description' = 'description'
  ): void {
    const cell = this.cells.get(cellKey(island, q, r));
    const n = applyDirection({ q, r }, dir);
    const neighbor = this.cells.get(cellKey(island, n.q, n.r));
    const opp = oppositeDirection(dir);

    if (source === 'art') {
      // A shared edge is OWNED by whichever side has been visited — its
      // room description already ruled on it. Art previews may not add
      // what a visited side's description didn't confirm, on EITHER side.
      if (cell?.visited && !this.edgesOf(cell, kind).includes(dir)) return;
      if (neighbor?.visited && !this.edgesOf(neighbor, kind).includes(opp)) return;
    }

    if (cell && !this.edgesOf(cell, kind).includes(dir)) this.edgesOf(cell, kind).push(dir);
    if (neighbor && !this.edgesOf(neighbor, kind).includes(opp)) {
      this.edgesOf(neighbor, kind).push(opp);
    }
  }

  /**
   * Authoritatively set a VISITED cell's river/cliff edges from its room
   * description. The description lists every such side of the hex you're
   * standing on, so this REPLACES whatever art previews had painted —
   * wrong art-based marks disappear the moment you stand on the hex.
   * Edges confirmed by visited neighbors' own descriptions are kept, and
   * this cell's edges mirror onto its neighbors.
   */
  setVisitedEdges(
    kind: EdgeKind,
    island: number,
    q: number,
    r: number,
    dirs: Direction[]
  ): void {
    const cell = this.cells.get(cellKey(island, q, r));
    if (!cell) return;
    const edges = [...dirs];
    for (const dir of COMPASS_DIRECTIONS) {
      const n = applyDirection({ q, r }, dir);
      const neighbor = this.cells.get(cellKey(island, n.q, n.r));
      if (!neighbor) continue;
      const opp = oppositeDirection(dir);
      if (neighbor.visited) {
        // Keep edges confirmed by a visited neighbor's own description
        if (this.edgesOf(neighbor, kind).includes(opp) && !edges.includes(dir)) {
          edges.push(dir);
        }
      } else if (!dirs.includes(dir)) {
        // This description says NO river/cliff on that side — scrub the
        // stale mirror off the unvisited neighbor (art previews defer to us)
        this.setEdgesOf(
          neighbor,
          kind,
          this.edgesOf(neighbor, kind).filter((d) => d !== opp)
        );
      }
    }
    this.setEdgesOf(cell, kind, edges);
    for (const dir of dirs) {
      const n = applyDirection({ q, r }, dir);
      const neighbor = this.cells.get(cellKey(island, n.q, n.r));
      const opp = oppositeDirection(dir);
      if (neighbor && !this.edgesOf(neighbor, kind).includes(opp)) {
        this.edgesOf(neighbor, kind).push(opp);
      }
    }
  }

  /** Mark a cell visited (creates it if needed) and store its description. */
  markVisited(island: number, q: number, r: number, description: string, now: number): HexCell {
    this.paint(island, q, r, 'unknown', now);
    const cell = this.cells.get(cellKey(island, q, r))!;
    cell.visited = true;
    cell.visitCount += 1;
    cell.lastSeen = now;
    if (description) cell.description = description;
    return cell;
  }

  addLandmark(island: number, q: number, r: number, text: string, now: number): void {
    const trimmed = text.trim().replace(/\.$/, '');
    if (!trimmed) return;
    this.paint(island, q, r, 'unknown', now);
    const cell = this.cells.get(cellKey(island, q, r))!;
    // Auto-classify settlements (never overrides a user's explicit choice)
    if (cell.marker === null && TOWN_RE.test(trimmed)) cell.marker = 'town';
    const lower = trimmed.toLowerCase();
    if (cell.landmarks.some((l) => l.toLowerCase() === lower)) return;
    cell.landmarks.push(trimmed);
    if (cell.landmarks.length > MAX_LANDMARKS_PER_CELL) cell.landmarks.shift();
  }

  /**
   * Toggle a hex's town marker. Turning it off records 'none' so auto
   * classification won't re-add it.
   */
  toggleTownMarker(island: number, q: number, r: number): void {
    const cell = this.cells.get(cellKey(island, q, r));
    if (!cell) return;
    cell.marker = cell.marker === 'town' ? 'none' : 'town';
  }

  /** Record a blocked exit (both sides if the target cell exists). */
  markBlocked(pos: HexPos, dir: Direction): void {
    const cell = this.getAt(pos);
    if (cell && !cell.blocked.includes(dir)) cell.blocked.push(dir);
    const t = applyDirection(pos, dir);
    const target = this.get(pos.island, t.q, t.r);
    const opp = oppositeDirection(dir);
    if (target && !target.blocked.includes(opp)) target.blocked.push(opp);
  }

  /** Remove a blocked mark (both sides) — a move through it succeeded. */
  unmarkBlocked(pos: HexPos, dir: Direction): void {
    const cell = this.getAt(pos);
    if (cell) cell.blocked = cell.blocked.filter((d) => d !== dir);
    const t = applyDirection(pos, dir);
    const target = this.get(pos.island, t.q, t.r);
    const opp = oppositeDirection(dir);
    if (target) target.blocked = target.blocked.filter((d) => d !== opp);
  }

  /** Clear ALL blocked marks on a cell, including the mirrored neighbor sides. */
  clearBlocked(island: number, q: number, r: number): void {
    const cell = this.get(island, q, r);
    if (!cell) return;
    for (const dir of cell.blocked) {
      const t = applyDirection({ q, r }, dir);
      const target = this.get(island, t.q, t.r);
      if (target) {
        const opp = oppositeDirection(dir);
        target.blocked = target.blocked.filter((d) => d !== opp);
      }
    }
    cell.blocked = [];
  }

  /**
   * Clear river and cliff marks on a cell (interior + edges, including the
   * mirrored neighbor sides). Correct marks re-detect on the next survey.
   */
  clearOverlayMarks(island: number, q: number, r: number): void {
    const cell = this.get(island, q, r);
    if (!cell) return;
    for (const kind of ['river', 'cliff', 'bridge'] as const) {
      for (const dir of this.edgesOf(cell, kind)) {
        const t = applyDirection({ q, r }, dir);
        const target = this.get(island, t.q, t.r);
        if (target) {
          const opp = oppositeDirection(dir);
          this.setEdgesOf(
            target,
            kind,
            this.edgesOf(target, kind).filter((d) => d !== opp)
          );
        }
      }
      this.setEdgesOf(cell, kind, []);
    }
    cell.river = false;
  }

  setNotes(island: number, q: number, r: number, notes: string): void {
    const cell = this.cells.get(cellKey(island, q, r));
    if (cell) cell.notes = notes;
  }

  clear(): void {
    this.cells.clear();
    this.terrainIndex.clear();
    this.pos = null;
    this.nextIsland = 1;
  }

  // -------------------------------------------------------------------------
  // Island merging
  // -------------------------------------------------------------------------

  /**
   * Merge island `from` into island `into`, translating all cells so that
   * `fromAnchor` (a position in `from`) lands on `intoAnchor` (in `into`).
   * Cell data at colliding coordinates is merged (visited wins, landmarks union).
   */
  mergeIslands(from: number, fromAnchor: HexCoord, into: number, intoAnchor: HexCoord): void {
    if (from === into) return;
    const dq = intoAnchor.q - fromAnchor.q;
    const dr = intoAnchor.r - fromAnchor.r;

    const moving = this.cellsOfIsland(from);
    for (const cell of moving) {
      this.cells.delete(cellKey(from, cell.q, cell.r));
      this.deindexTerrain(cellKey(from, cell.q, cell.r), cell.terrain);
      const nq = cell.q + dq;
      const nr = cell.r + dr;
      const targetKey = cellKey(into, nq, nr);
      const existing = this.cells.get(targetKey);
      if (!existing) {
        cell.q = nq;
        cell.r = nr;
        cell.island = into;
        this.cells.set(targetKey, cell);
        this.indexTerrain(targetKey, cell.terrain);
      } else {
        // Merge: prefer the fresher terrain, keep visited status from either
        if (cell.lastSeen > existing.lastSeen && cell.terrain !== 'unknown') {
          this.deindexTerrain(targetKey, existing.terrain);
          existing.terrain = cell.terrain;
          this.indexTerrain(targetKey, existing.terrain);
        }
        existing.river = existing.river || cell.river;
        for (const re of cell.riverEdges) {
          if (!existing.riverEdges.includes(re)) existing.riverEdges.push(re);
        }
        for (const ce of cell.cliffEdges) {
          if (!existing.cliffEdges.includes(ce)) existing.cliffEdges.push(ce);
        }
        for (const be of cell.bridgeEdges) {
          if (!existing.bridgeEdges.includes(be)) existing.bridgeEdges.push(be);
        }
        existing.visited = existing.visited || cell.visited;
        existing.visitCount += cell.visitCount;
        existing.lastSeen = Math.max(existing.lastSeen, cell.lastSeen);
        for (const l of cell.landmarks) {
          if (!existing.landmarks.some((e) => e.toLowerCase() === l.toLowerCase())) {
            existing.landmarks.push(l);
          }
        }
        existing.landmarks = existing.landmarks.slice(-MAX_LANDMARKS_PER_CELL);
        if (existing.marker === null) existing.marker = cell.marker;
        if (!existing.notes) existing.notes = cell.notes;
        if (!existing.description) existing.description = cell.description;
        for (const b of cell.blocked) {
          if (!existing.blocked.includes(b)) existing.blocked.push(b);
        }
      }
    }

    if (this.pos && this.pos.island === from) {
      this.pos = { island: into, q: this.pos.q + dq, r: this.pos.r + dr };
    }
  }

  // -------------------------------------------------------------------------
  // Pathfinding — A* over known cells
  // -------------------------------------------------------------------------

  /**
   * Find a path from `from` to `to` (same island) through known cells.
   * Water/ocean cells are only passable if previously visited.
   * Blocked edges are respected. Returns null if unreachable.
   *
   * Step costs are terrain-aware: swamp/hills/mountains/wasteland carry
   * concentration hits in DartMUD, so routes prefer plains/farmland/woods
   * and only cut through rough terrain when the detour would be far longer.
   * Costs are weights, not exclusions — if the only route is rough, it's
   * still taken. The minimum cost is 1, keeping the A* heuristic admissible.
   */
  findPath(from: HexPos, to: HexPos, maxNodes = 30000): Direction[] | null {
    if (from.island !== to.island) return null;
    if (from.q === to.q && from.r === to.r) return [];
    if (!this.get(to.island, to.q, to.r)) return null;

    const island = from.island;
    const startKey = `${from.q},${from.r}`;
    const goalKey = `${to.q},${to.r}`;

    const dist = (a: HexCoord, b: HexCoord) =>
      (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

    interface Node {
      q: number;
      r: number;
      g: number;
      f: number;
      parent: string | null;
      dir: Direction | null;
    }

    const open = new Map<string, Node>();
    const closed = new Map<string, Node>();
    open.set(startKey, { q: from.q, r: from.r, g: 0, f: dist(from, to), parent: null, dir: null });

    let explored = 0;
    while (open.size > 0 && explored < maxNodes) {
      // Extract min-f node (linear scan; open sets stay small in practice)
      let bestKey = '';
      let best: Node | null = null;
      for (const [k, n] of open) {
        if (!best || n.f < best.f) {
          best = n;
          bestKey = k;
        }
      }
      if (!best) break;
      open.delete(bestKey);
      closed.set(bestKey, best);
      explored++;

      if (bestKey === goalKey) {
        // Reconstruct
        const dirs: Direction[] = [];
        let cur: Node | null = best;
        while (cur && cur.dir) {
          dirs.unshift(cur.dir);
          cur = cur.parent ? (closed.get(cur.parent) ?? null) : null;
        }
        return dirs;
      }

      const cell = this.get(island, best.q, best.r);
      for (const dir of COMPASS_DIRECTIONS) {
        if (cell?.blocked.includes(dir)) continue;
        const n = applyDirection(best, dir);
        const nKey = `${n.q},${n.r}`;
        if (closed.has(nKey)) continue;
        const nCell = this.get(island, n.q, n.r);
        if (!nCell) continue;
        const isGoal = nKey === goalKey;
        // Water is only passable when visited (proven crossable), unless it's the goal
        if (!isGoal && (nCell.terrain === 'water' || nCell.terrain === 'ocean') && !nCell.visited) {
          continue;
        }
        let stepCost = TERRAIN_COST[nCell.terrain] ?? 2;
        if (nCell.river) stepCost += RIVER_INTERIOR_COST;
        const opp = oppositeDirection(dir);
        // Crossing a river edge (swim) or a cliff edge (climb) is a
        // concentration event, same as rough terrain — unless a bridge
        // spans the edge (a zero-concentration crossing).
        const bridged = cell?.bridgeEdges.includes(dir) || nCell.bridgeEdges.includes(opp);
        if (!bridged && (cell?.riverEdges.includes(dir) || nCell.riverEdges.includes(opp))) {
          stepCost += RIVER_CROSSING_COST;
        }
        if (!bridged && (cell?.cliffEdges.includes(dir) || nCell.cliffEdges.includes(opp))) {
          stepCost += CONC_HIT;
        }
        if (!nCell.visited) stepCost *= 1.15;
        const g = best.g + stepCost;
        const existing = open.get(nKey);
        if (!existing || g < existing.g) {
          open.set(nKey, {
            q: n.q,
            r: n.r,
            g,
            f: g + dist(n, to),
            parent: bestKey,
            dir,
          });
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): SerializedHexMap {
    const cells: Record<string, HexCell> = {};
    for (const [key, cell] of this.cells) {
      cells[key] = cell;
    }
    return { version: 2, cells, pos: this.pos, nextIsland: this.nextIsland };
  }

  static deserialize(data: unknown): HexMapStore {
    const store = new HexMapStore();
    if (!data || typeof data !== 'object') return store;
    const d = data as Partial<SerializedHexMap>;
    // Older formats (v1 room-graph maps) are discarded — they were built by
    // the broken pre-v2 mapper and contain no salvageable data.
    if (d.version !== 2 || !d.cells) return store;
    for (const [key, cell] of Object.entries(d.cells)) {
      if (!cell || typeof cell.q !== 'number' || typeof cell.r !== 'number') continue;
      const c: HexCell = {
        q: cell.q,
        r: cell.r,
        island: cell.island ?? 0,
        terrain: cell.terrain ?? 'unknown',
        river: !!cell.river,
        riverEdges: Array.isArray(cell.riverEdges) ? cell.riverEdges : [],
        cliffEdges: Array.isArray(cell.cliffEdges) ? cell.cliffEdges : [],
        bridgeEdges: Array.isArray(cell.bridgeEdges) ? cell.bridgeEdges : [],
        visited: !!cell.visited,
        visitCount: cell.visitCount ?? 0,
        lastSeen: cell.lastSeen ?? 0,
        landmarks: Array.isArray(cell.landmarks) ? cell.landmarks : [],
        // Classify pre-existing saved landmarks on first load after upgrade
        marker:
          cell.marker ??
          (Array.isArray(cell.landmarks) && cell.landmarks.some((l) => TOWN_RE.test(l))
            ? 'town'
            : null),
        notes: cell.notes ?? '',
        blocked: Array.isArray(cell.blocked) ? cell.blocked : [],
        description: cell.description ?? '',
      };
      store.cells.set(key, c);
      store.indexTerrain(key, c.terrain);
    }
    store.pos = d.pos ?? null;
    store.nextIsland = d.nextIsland ?? 1;
    return store;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private indexTerrain(key: string, terrain: HexTerrainType): void {
    if (terrain === 'unknown') return;
    let set = this.terrainIndex.get(terrain);
    if (!set) {
      set = new Set();
      this.terrainIndex.set(terrain, set);
    }
    set.add(key);
  }

  private deindexTerrain(key: string, terrain: HexTerrainType): void {
    this.terrainIndex.get(terrain)?.delete(key);
  }
}
