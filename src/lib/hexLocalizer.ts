/**
 * Hex localizer — decides where the player is after each survey.
 *
 * Strategy ("paint & correlate"):
 *  - Every survey shows a patch of 1/7/19 hexes of terrain around the player.
 *  - A FIFO queue of pending movement commands predicts where the player
 *    should be.
 *  - The patch is correlated against the already-painted map at the
 *    predicted position, the current position, and all 6 neighbors. The
 *    best-matching shift wins — so the mapper self-corrects even when
 *    commands are lost, movement is forced (follow/flee), or spammed.
 *  - When nothing fits (teleport/recall/login elsewhere), the localizer goes
 *    "lost" and attempts global relocalization by searching the whole map
 *    for a unique patch match. If none exists, mapping continues on a fresh
 *    island that merges back into the main map when a later survey matches.
 */

import type { Direction, HexCoord } from './hexUtils';
import { applyDirection, parseDirection } from './hexUtils';
import type { HexTerrainType } from './hexTerrainPatterns';
import type { ParsedHexArt } from './hexArtParser';
import { HexMapStore, type HexPos } from './hexMap';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Pending moves older than this are dropped (ms) */
const QUEUE_MAX_AGE = 20_000;
/** Max queued pending moves */
const QUEUE_MAX_LEN = 12;
/** Minimum known (already-painted) overlap hexes required to judge a candidate */
const MIN_EVIDENCE = 3;
/** Minimum overlap for a global relocalization match */
const RELOC_MIN_OVERLAP = 6;
/** A queued move consumed by an identity match must be at least this stale (ms) */
const STALE_MOVE_AGE = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingMove {
  dir: Direction;
  at: number;
}

export interface SurveyInput {
  /** Parsed hex art, or null when the survey produced no readable art (blind) */
  art: ParsedHexArt | null;
  description: string;
  now: number;
}

export type ResolutionKind =
  | 'first' // very first survey — map origin established
  | 'expected' // matched the queue prediction
  | 'stationary' // identity match (look/manual survey)
  | 'corrected' // view correlation overrode the prediction
  | 'frontier' // no painted evidence nearby — trusted the movement chain
  | 'ambiguous' // several positions fit — trusted the movement chain
  | 'relocalized' // was lost; found a unique global match
  | 'new-island' // was lost; started a fresh island
  | 'blind' // no art — advanced along the movement chain
  | 'lost'; // could not resolve; position unknown until relocalized

export interface SurveyResolution {
  kind: ResolutionKind;
  pos: HexPos | null;
  moved: Direction | null;
  /** Number of already-painted hexes that disagreed with this survey */
  conflicts: number;
  /** Islands merged during this survey (from → into) */
  merged?: { from: number; into: number };
}

// ---------------------------------------------------------------------------
// Localizer
// ---------------------------------------------------------------------------

export class HexLocalizer {
  private queue: PendingMove[] = [];
  lost = false;

  constructor(private map: HexMapStore) {}

  get pendingMoves(): readonly PendingMove[] {
    return this.queue;
  }

  /**
   * Track an outgoing command. Recognizes bare hex directions and
   * prefixed movement forms ("lead ne", "row s", "sneak nw", "swim se").
   */
  trackCommand(command: string, now: number): boolean {
    const trimmed = command.trim().toLowerCase();
    let dirWord = trimmed;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 0) {
      const prefix = trimmed.slice(0, spaceIdx);
      if (
        prefix !== 'lead' &&
        prefix !== 'row' &&
        prefix !== 'sneak' &&
        prefix !== 'swim' &&
        prefix !== 'go'
      ) {
        return false;
      }
      dirWord = trimmed.slice(spaceIdx + 1).trim();
    }
    const dir = parseDirection(dirWord);
    if (!dir) return false;
    this.pushMove(dir, now);
    return true;
  }

  /** A forced movement happened (led/dragged by another player). */
  trackForcedMove(dir: Direction, now: number): void {
    this.pushMove(dir, now);
  }

  private pushMove(dir: Direction, now: number): void {
    this.queue.push({ dir, at: now });
    if (this.queue.length > QUEUE_MAX_LEN) this.queue.shift();
  }

  /**
   * A movement-failure message arrived — drop the oldest pending move.
   * Hard failures (physical terrain) also record a blocked edge.
   */
  onMoveFailed(hard: boolean): Direction | null {
    const failed = this.queue.shift();
    if (hard && failed && this.map.pos && !this.lost) {
      this.map.markBlocked(this.map.pos, failed.dir);
    }
    return failed?.dir ?? null;
  }

  /**
   * A non-hex room (town/dungeon) was entered — any pending hex moves were
   * consumed by indoor movement and would poison the next wilderness survey.
   */
  onTownRoom(): void {
    this.queue = [];
  }

  /** Reset transient state (new connection/character). Map data is untouched. */
  reset(): void {
    this.queue = [];
    this.lost = false;
  }

  /**
   * Resolve a survey. This is the single entry point that updates position
   * and paints the map.
   */
  onSurvey(input: SurveyInput): SurveyResolution {
    const { art, description, now } = input;
    this.expireQueue(now);

    // --- Blind survey (no art): advance along the chain without painting ---
    if (!art || art.hexes.size === 0) {
      const move = this.queue.shift();
      if (move && this.map.pos && !this.lost) {
        const n = applyDirection(this.map.pos, move.dir);
        this.map.pos = { island: this.map.pos.island, q: n.q, r: n.r };
        return { kind: 'blind', pos: this.map.pos, moved: move.dir, conflicts: 0 };
      }
      return { kind: this.lost ? 'lost' : 'blind', pos: this.map.pos, moved: null, conflicts: 0 };
    }

    const patch = art.hexes;

    // --- First survey ever: establish origin ---
    if (this.map.size === 0) {
      this.map.pos = { island: 0, q: 0, r: 0 };
      this.queue.shift();
      const conflicts = this.paint(patch, art, description, now);
      return { kind: 'first', pos: this.map.pos, moved: null, conflicts };
    }

    // --- No position (fresh session on an existing map) or lost: relocalize ---
    if (!this.map.pos || this.lost) {
      return this.relocalize(patch, art, description, now);
    }

    const pos = this.map.pos;

    // --- Score candidate shifts ---
    const expectedDir = this.queue.length > 0 ? this.queue[0].dir : null;
    const expected: HexCoord = expectedDir ? applyDirection(pos, expectedDir) : pos;

    interface Candidate {
      coord: HexCoord;
      dir: Direction | null;
      known: number;
      match: number;
    }

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const addCandidate = (coord: HexCoord, dir: Direction | null) => {
      const key = `${coord.q},${coord.r}`;
      if (seen.has(key)) return;
      seen.add(key);
      const { known, match } = this.score(pos.island, coord, patch);
      candidates.push({ coord, dir, known, match });
    };

    addCandidate(pos, null);
    for (const dir of ['n', 'ne', 'se', 's', 'sw', 'nw'] as Direction[]) {
      addCandidate(applyDirection(pos, dir), dir);
    }

    const tolerance = (known: number) => (known >= 6 ? 1 : 0);
    const isGood = (c: Candidate) => c.known >= MIN_EVIDENCE && c.known - c.match <= tolerance(c.known);

    const expectedCand = candidates.find(
      (c) => c.coord.q === expected.q && c.coord.r === expected.r
    )!;
    const good = candidates.filter(isGood);

    let accepted: Candidate;
    let kind: ResolutionKind;

    if (isGood(expectedCand)) {
      accepted = expectedCand;
      kind = expectedCand.dir === null ? 'stationary' : 'expected';
    } else if (good.length === 1) {
      accepted = good[0];
      kind = 'corrected';
    } else if (good.length === 0) {
      const maxKnown = Math.max(...candidates.map((c) => c.known));
      if (maxKnown < MIN_EVIDENCE) {
        // Frontier — nothing painted around here yet; trust the chain
        accepted = expectedCand;
        kind = 'frontier';
      } else {
        // Solid evidence contradicts every nearby position — we teleported
        return this.relocalize(patch, art, description, now);
      }
    } else {
      // Multiple positions fit (uniform terrain) — prefer the chain
      const identity = good.find((c) => c.dir === null);
      accepted = good.find((c) => c.coord.q === expected.q && c.coord.r === expected.r) ?? identity ?? good[0];
      kind = 'ambiguous';
    }

    // --- Reconcile the queue with what actually happened ---
    if (this.queue.length > 0) {
      if (accepted.dir !== null) {
        // Find the accepted direction near the head of the queue and drop
        // everything up to and including it. This resyncs after a missed
        // survey or an unrecognized silent failure instead of staying
        // permanently one move behind.
        const searchDepth = Math.min(this.queue.length, 3);
        let matched = -1;
        for (let i = 0; i < searchDepth; i++) {
          if (this.queue[i].dir === accepted.dir) {
            matched = i;
            break;
          }
        }
        if (matched >= 0) this.queue.splice(0, matched + 1);
        else this.queue.shift(); // forced/unexpected move — drop the stale head
      } else if (now - this.queue[0].at > STALE_MOVE_AGE) {
        this.queue.shift(); // move silently failed / never happened
      }
    }

    this.map.pos = { island: pos.island, q: accepted.coord.q, r: accepted.coord.r };
    // Landmarks scatter when placed from low-confidence positions; terrain
    // painting self-heals, landmark placement doesn't — so gate it.
    const confident = kind !== 'ambiguous' && kind !== 'frontier';
    const conflicts = this.paint(patch, art, description, now, confident);

    // While on a secondary island, probe for a merge with the rest of the map
    const merged = this.tryMergeProbe(patch, now);

    return { kind, pos: this.map.pos, moved: accepted.dir, conflicts, ...(merged ? { merged } : {}) };
  }

  // -------------------------------------------------------------------------
  // Correlation scoring
  // -------------------------------------------------------------------------

  /**
   * Compare the patch against the painted map centered at `center`.
   * Returns how many patch hexes were already known and how many matched.
   */
  private score(
    island: number,
    center: HexCoord,
    patch: Map<string, HexTerrainType>
  ): { known: number; match: number } {
    let known = 0;
    let match = 0;
    for (const [rel, terrain] of patch) {
      if (terrain === 'unknown') continue;
      const comma = rel.indexOf(',');
      const dq = Number(rel.slice(0, comma));
      const dr = Number(rel.slice(comma + 1));
      const cell = this.map.get(island, center.q + dq, center.r + dr);
      if (!cell || cell.terrain === 'unknown') continue;
      known++;
      if (cell.terrain === terrain) match++;
    }
    return { known, match };
  }

  // -------------------------------------------------------------------------
  // Global relocalization & islands
  // -------------------------------------------------------------------------

  /** Is this patch distinctive enough to identify a position globally? */
  private isDistinctive(patch: Map<string, HexTerrainType>): boolean {
    if (patch.size < 7) return false;
    const terrains = new Set<HexTerrainType>();
    for (const t of patch.values()) {
      if (t !== 'unknown') terrains.add(t);
    }
    return terrains.size >= 2;
  }

  /**
   * Search the map for positions matching the patch.
   * `onlyIsland` restricts the search to one island; `excludeIsland` skips one.
   * Returns matches capped at `limit` (early-exits once exceeded).
   */
  private globalMatches(
    patch: Map<string, HexTerrainType>,
    opts: { onlyIsland?: number; excludeIsland?: number },
    limit: number
  ): HexPos[] {
    const centerTerrain = patch.get('0,0');
    if (!centerTerrain || centerTerrain === 'unknown') return [];
    const seeds = this.map.keysWithTerrain(centerTerrain);
    if (!seeds) return [];

    const matches: HexPos[] = [];
    for (const key of seeds) {
      const cand = this.map.parseKey(key);
      if (opts.onlyIsland !== undefined && cand.island !== opts.onlyIsland) continue;
      if (opts.excludeIsland !== undefined && cand.island === opts.excludeIsland) continue;
      const { known, match } = this.score(cand.island, cand, patch);
      if (known >= RELOC_MIN_OVERLAP && known - match === 0) {
        matches.push(cand);
        if (matches.length > limit) break;
      }
    }
    return matches;
  }

  /**
   * Find a unique anchor position for the patch. The primary island is
   * consulted first — a unique match there wins even when duplicated
   * fragments exist on smaller islands. Falls back to a globally unique
   * match across all islands.
   */
  private findUniqueAnchor(
    patch: Map<string, HexTerrainType>,
    excludeIsland?: number
  ): HexPos | null {
    const primary = this.map.primaryIsland();
    if (excludeIsland === undefined || primary !== excludeIsland) {
      const inPrimary = this.globalMatches(patch, { onlyIsland: primary }, 1);
      if (inPrimary.length === 1) return inPrimary[0];
      if (inPrimary.length > 1) return null; // ambiguous even on the mainland
    }
    const anywhere = this.globalMatches(
      patch,
      excludeIsland === undefined ? {} : { excludeIsland },
      1
    );
    return anywhere.length === 1 ? anywhere[0] : null;
  }

  private relocalize(
    patch: Map<string, HexTerrainType>,
    art: ParsedHexArt,
    description: string,
    now: number
  ): SurveyResolution {
    if (this.isDistinctive(patch)) {
      const anchor = this.findUniqueAnchor(patch);
      if (anchor) {
        this.map.pos = anchor;
        this.lost = false;
        this.queue = [];
        const conflicts = this.paint(patch, art, description, now);
        return { kind: 'relocalized', pos: this.map.pos, moved: null, conflicts };
      }
      // No unique match — start a fresh island and keep mapping
      const island = this.map.nextIsland++;
      this.map.pos = { island, q: 0, r: 0 };
      this.lost = false;
      this.queue = [];
      const conflicts = this.paint(patch, art, description, now);
      return { kind: 'new-island', pos: this.map.pos, moved: null, conflicts };
    }

    // Patch too weak to identify anything — stay lost, don't paint
    this.lost = true;
    return { kind: 'lost', pos: null, moved: null, conflicts: 0 };
  }

  /**
   * While mapping on a secondary island, check whether the current patch
   * uniquely matches somewhere on another island; if so, merge.
   */
  private tryMergeProbe(
    patch: Map<string, HexTerrainType>,
    now: number
  ): { from: number; into: number } | undefined {
    const pos = this.map.pos;
    if (!pos) return undefined;
    const primary = this.map.primaryIsland();
    if (pos.island === primary) return undefined;
    if (!this.isDistinctive(patch)) return undefined;

    const target = this.findUniqueAnchor(patch, pos.island);
    if (!target) return undefined;

    const from = pos.island;
    this.map.mergeIslands(from, { q: pos.q, r: pos.r }, target.island, {
      q: target.q,
      r: target.r,
    });
    // mergeIslands translates this.map.pos for us
    void now;
    return { from, into: target.island };
  }

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  /** Paint the patch at the current position. Returns the conflict count. */
  private paint(
    patch: Map<string, HexTerrainType>,
    art: ParsedHexArt,
    description: string,
    now: number,
    withLandmarks = true
  ): number {
    const pos = this.map.pos;
    if (!pos) return 0;
    let conflicts = 0;

    for (const [rel, terrain] of patch) {
      if (terrain === 'unknown') continue;
      const comma = rel.indexOf(',');
      const dq = Number(rel.slice(0, comma));
      const dr = Number(rel.slice(comma + 1));
      if (this.map.paint(pos.island, pos.q + dq, pos.r + dr, terrain, now)) {
        conflicts++;
      }
    }

    this.map.markVisited(pos.island, pos.q, pos.r, description, now);

    if (withLandmarks) {
      for (const lm of art.landmarks) {
        if (lm.q === null || lm.r === null) continue;
        this.map.addLandmark(pos.island, pos.q + lm.q, pos.r + lm.r, lm.description, now);
      }
    }

    return conflicts;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private expireQueue(now: number): void {
    while (this.queue.length > 0 && now - this.queue[0].at > QUEUE_MAX_AGE) {
      this.queue.shift();
    }
  }
}
