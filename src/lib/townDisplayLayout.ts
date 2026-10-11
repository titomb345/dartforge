/**
 * Town map DISPLAY geometry — presentation-only helpers for TownMapCanvas.
 *
 * The store's coordinates (townMap.ts) are the localizer's working grid and
 * are never rewritten for looks: frontier/near reuse, the floor filter and
 * stretch placement are all tuned on them (written back into the store at
 * load time, the compaction measured suspect duplicate creations 111→118
 * and jumped floaters 18→26 in corpus replay, under the half-plane stretch
 * of the time). Everything here works on COPIES and is consumed only by the
 * canvas — drawing, hit-testing, centering, search focus and the walk
 * overlay all read one display layout, so what you click is always what
 * you see.
 */

import { TOWN_REVERSE, type TownDir } from './townParser';
import type { TownRoom } from './townMap';

// ---------------------------------------------------------------------------
// Display layout (gap compaction)
// ---------------------------------------------------------------------------

/** The room fields the display layout reads (TownRoom satisfies it) */
export type LayoutRoom = Pick<TownRoom, 'id' | 'x' | 'y' | 'z' | 'links'>;

export interface DisplayCell {
  readonly x: number;
  readonly y: number;
}

export interface TownDisplayLayout {
  /** Display cell of a room; its floor is unchanged (still room.z) */
  pos(roomId: number): DisplayCell | undefined;
  /** The room drawn on display cell (x,y) of floor z */
  roomAt(x: number, y: number, z: number): number | undefined;
  /** Gap-closing pulls applied (0 = the display matches the store) */
  readonly pulls: number;
}

/** Unit grid step of every direction (u/d have no lateral component) */
const DIR_VEC: Record<TownDir, readonly [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
  u: [0, 0],
  d: [0, 0],
};

/** Fixed iteration order, so no result ever depends on object key order */
const DIR_ORDER: readonly TownDir[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw', 'u', 'd'];

const isCardinal = (dir: TownDir) => dir === 'n' || dir === 'e' || dir === 's' || dir === 'w';

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Close the gaps that collision stretches leave behind — for display only.
 *
 * A stretch (townMap.ts stretchToVacate) shifts the occupant's structure
 * one cell, and nothing ever shortens a link again: every link from a
 * shifted room back across the cut grows a cell, and repeated collisions
 * widen the gaps. Maps grown under the half-plane stretch that came before
 * it (which shifted EVERY room beyond the cut, on every floor) keep far
 * more: in Bill's live save 58 of Eris's n/s/e/w links span two cells
 * (Garrison Road's row, the 3x3 market on columns -4,-2,0); in replay
 * under that stretch, Garrison Road grew a 14-cell "street" (Ash Street to
 * the Intersection), the sum of 13 north stretches whose cuts fell between.
 * Measured here (links counted per direction): live Eris 58 → 30 long
 * links (the rest are real geometry, or gaps held open by duplicate rooms
 * sitting in them — the market's duplicate south row); the frozen-corpus
 * replay's maps under the bounded stretch, Mazorn 81 → 69 (Weathered
 * Gate's 5-cell Main Street → 3). At most 2 ms per real town (6 ms for a
 * 472-room one), and only when the layout signature changes.
 *
 * This is the inverse of a stretch. For each long, straight cardinal link
 * A→B, the structure behind B — rooms reachable from B over directional
 * links (u/d included, so stairs stay aligned across floors) without
 * crossing back over the cut through B — is pulled one cell toward A,
 * provided that
 *  - every pulled room lands on a free cell (or one a pulled room vacates);
 *  - no lateral link between a pulled and an unpulled room ends up less
 *    than one full cell along its own direction. That keeps every exact
 *    link exact (an exact east link would collide or turn vertical), an
 *    off-axis east exit still leaving eastward, and an exact diagonal from
 *    being bent into a straight line.
 * Pulls repeat until none applies. A pull shortens every link crossing its
 * cut by one cell and changes no other link, so the total link length
 * strictly falls (termination) and no link ever gets longer. Named links
 * are non-spatial and ignored; unlinked rooms never move but still block.
 * Rooms sharing a store cell (a corrupt save — none in the live save or any
 * replay map) never move either: the cell index holds one room per cell, so
 * pulling the indexed one away would leave the other unseen by roomAt (no
 * hover, no right-click walk) and free for a later pull to land on.
 * (Also carrying along near-side rooms that hang only off the pulled
 * structure was tried: no better overall, and worse on the live save.)
 */
export function computeTownDisplayLayout(rooms: readonly LayoutRoom[]): TownDisplayLayout {
  const sorted = [...rooms].sort((a, b) => a.id - b.id);
  const index = new Map<number, number>();
  sorted.forEach((r, i) => index.set(r.id, i));
  const xs = sorted.map((r) => r.x);
  const ys = sorted.map((r) => r.y);
  const zs = sorted.map((r) => r.z);
  const cells = new Map<string, number>();
  /** Rooms on a store cell another room also occupies (pinned, see above) */
  const stacked = new Uint8Array(sorted.length);
  sorted.forEach((r, i) => {
    const key = cellKey(r.x, r.y, r.z);
    const first = cells.get(key);
    if (first === undefined) cells.set(key, i);
    else stacked[first] = stacked[i] = 1;
  });

  /** Undirected directional-link adjacency — what a pull drags along */
  const adj: number[][] = sorted.map(() => []);
  /** Lateral links [from, to, dx, dy] and, per room, the ones touching it */
  const lateral: [number, number, number, number][] = [];
  const touching: number[][] = sorted.map(() => []);
  /** Cardinal links — the only ones a pull shortens on purpose */
  const cardinal: [number, number, number, number][] = [];
  sorted.forEach((r, i) => {
    for (const dir of DIR_ORDER) {
      const id = r.links[dir];
      const j = id === undefined ? undefined : index.get(id);
      if (j === undefined || j === i) continue;
      adj[i].push(j);
      adj[j].push(i);
      const [dx, dy] = DIR_VEC[dir];
      if (dx === 0 && dy === 0) continue; // u/d: no lateral direction to keep
      touching[i].push(lateral.length);
      touching[j].push(lateral.length);
      lateral.push([i, j, dx, dy]);
      if (isCardinal(dir)) cardinal.push([i, j, dx, dy]);
    }
  });

  /** A→B runs straight along (vx,vy) for 2+ cells on one floor */
  const isLong = (a: number, b: number, vx: number, vy: number) => {
    if (zs[a] !== zs[b]) return false;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const along = dx * vx + dy * vy;
    return along >= 2 && dx === along * vx && dy === along * vy;
  };

  // Per-attempt membership stamps (no per-attempt Set allocation)
  const pulled = new Int32Array(sorted.length);
  let stamp = 0;

  /** Pull B's structure one cell back along (vx,vy) toward A, if legal */
  const tryPull = (b: number, vx: number, vy: number): boolean => {
    const cut = xs[b] * vx + ys[b] * vy;
    stamp++;
    pulled[b] = stamp;
    const group = [b];
    for (let g = 0; g < group.length; g++) {
      for (const n of adj[group[g]]) {
        if (pulled[n] === stamp || xs[n] * vx + ys[n] * vy < cut) continue;
        pulled[n] = stamp;
        group.push(n);
      }
    }
    // (A sits strictly before the cut, so it is never part of the group.)
    for (const m of group) {
      if (stacked[m]) return false;
      const occupant = cells.get(cellKey(xs[m] - vx, ys[m] - vy, zs[m]));
      if (occupant !== undefined && pulled[occupant] !== stamp) return false;
    }
    for (const m of group) {
      for (const k of touching[m]) {
        const [from, to, dx, dy] = lateral[k];
        const other = from === m ? to : from;
        if (pulled[other] === stamp) continue;
        // `other` is before the cut (else the flood would have taken it),
        // so the pulled end is 1+ cells ahead of it along the pull axis.
        // A link heading that way must still span a full cell afterwards.
        const heading = (to === m ? 1 : -1) * (dx * vx + dy * vy);
        const ahead = (xs[m] - xs[other]) * vx + (ys[m] - ys[other]) * vy;
        if (heading > 0 && ahead < 2) return false;
      }
    }
    for (const m of group) {
      const key = cellKey(xs[m], ys[m], zs[m]);
      if (cells.get(key) === m) cells.delete(key);
    }
    for (const m of group) {
      xs[m] -= vx;
      ys[m] -= vy;
      cells.set(cellKey(xs[m], ys[m], zs[m]), m);
    }
    return true;
  };

  let pulls = 0;
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (const [a, b, vx, vy] of cardinal) {
      while (isLong(a, b, vx, vy) && tryPull(b, vx, vy)) {
        pulls++;
        progressed = true;
      }
    }
  }

  const byId = new Map<number, DisplayCell>();
  sorted.forEach((r, i) => byId.set(r.id, { x: xs[i], y: ys[i] }));
  const byCell = new Map<string, number>();
  for (const [key, i] of cells) byCell.set(key, sorted[i].id);
  return {
    pos: (roomId) => byId.get(roomId),
    roomAt: (x, y, z) => byCell.get(cellKey(x, y, z)),
    pulls,
  };
}

/**
 * Cheap fingerprint of everything computeTownDisplayLayout reads (ids,
 * coordinates, directional links). Visits, descriptions, exits, icons and
 * renames don't change it, so the layout is NOT recomputed on every
 * syncState (two per room block, plus every survey) — only when a room is
 * added or deleted, a stretch/merge/relayout moves rooms, or a link
 * changes. Order-independent: per-room hashes are summed.
 */
export function townLayoutSignature(rooms: readonly LayoutRoom[]): string {
  // Two independent 32-bit mixes (FNV-1a and a murmur-style step) per room
  const fnv = (h: number, v: number) => Math.imul(h ^ (v | 0), 0x01000193);
  const mur = (h: number, v: number) => Math.imul(h ^ (v | 0), 0x5bd1e995) ^ (h >>> 13);
  let sumA = 0;
  let sumB = 0;
  for (const r of rooms) {
    let a = fnv(fnv(fnv(fnv(0x811c9dc5, r.id), r.x), r.y), r.z);
    let b = mur(mur(mur(mur(0x9747b28c, r.id), r.x), r.y), r.z);
    for (let d = 0; d < DIR_ORDER.length; d++) {
      const id = r.links[DIR_ORDER[d]];
      if (id === undefined) continue;
      a = fnv(fnv(a, d + 1), id);
      b = mur(mur(b, d + 1), id);
    }
    sumA = (sumA + a) | 0;
    sumB = (sumB + b) | 0;
  }
  return `${rooms.length}:${sumA >>> 0}:${sumB >>> 0}`;
}

export type TownDisplayLayoutCache = (
  townId: number,
  rooms: readonly LayoutRoom[]
) => TownDisplayLayout;

/**
 * Memoized layout per (town, layout signature). The returned layout is a
 * snapshot: it never reads the live (mutable) rooms after computing.
 */
export function createTownDisplayLayoutCache(): TownDisplayLayoutCache {
  let last: { townId: number; signature: string; layout: TownDisplayLayout } | null = null;
  return (townId, rooms) => {
    const signature = townLayoutSignature(rooms);
    if (last && last.townId === townId && last.signature === signature) return last.layout;
    const layout = computeTownDisplayLayout(rooms);
    last = { townId, signature, layout };
    return layout;
  };
}

// ---------------------------------------------------------------------------
// Link shapes, doors
// ---------------------------------------------------------------------------

/**
 * How a lateral link sits on the display grid. 'straight': exactly one cell
 * along its own direction, or a longer straight run across EMPTY cells (a
 * truthful long street). 'displaced': anything else — non-Euclidean
 * geometry, or a stretch/nudge left the endpoints off the exit's line.
 * Diagonals get the same test as cardinals: they are placement hints only
 * (townMap.ts), so stretches drift their endpoints too — in Bill's live
 * save 15 of 32 drawn diagonals no longer joined diagonal neighbours, and
 * 2 cut straight through another room's box.
 */
export function linkShape(
  from: DisplayCell,
  to: DisplayCell,
  dir: TownDir,
  occupied: (x: number, y: number) => boolean
): 'straight' | 'displaced' {
  const [vx, vy] = DIR_VEC[dir];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = vx !== 0 ? dx * vx : dy * vy;
  if (steps < 1 || dx !== steps * vx || dy !== steps * vy) return 'displaced';
  for (let i = 1; i < steps; i++) {
    if (occupied(from.x + vx * i, from.y + vy * i)) return 'displaced';
  }
  return 'straight';
}

/** A point in canvas pixels (a room's center is its display cell × pitch) */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The polyline a lateral link is stroked as, between two room centers. A
 * straight link runs center to center. A displaced one still leaves through
 * its own side of the room — a south exit from the bottom-middle edge, a
 * northeast one from the top-right corner — and arrives at the far room's
 * opposite side; only the middle segment angles across.
 */
export function linkPolyline(
  a: Point,
  b: Point,
  dir: TownDir,
  displaced: boolean,
  roomHalf: number
): Point[] {
  if (!displaced) return [a, b];
  const [vx, vy] = DIR_VEC[dir];
  const stub = roomHalf + (vx !== 0 && vy !== 0 ? 5 : 6);
  return [
    { x: a.x + vx * roomHalf, y: a.y + vy * roomHalf },
    { x: a.x + vx * stub, y: a.y + vy * stub },
    { x: b.x - vx * stub, y: b.y - vy * stub },
    { x: b.x - vx * roomHalf, y: b.y - vy * roomHalf },
  ];
}

/**
 * A door tick: `halfLength` either side of a stroked link's midpoint,
 * square to the segment it crosses there (the middle one — the polyline is
 * symmetric). Square to the center-to-center line instead, a displaced
 * link's tick sat askew on its angled middle: an east exit drawn to a room
 * one cell south-east has a nearly vertical middle, which that tick crossed
 * at 52 degrees.
 */
export function doorTick(path: readonly Point[], halfLength: number): [Point, Point] {
  const i = (path.length - 2) >> 1;
  const p = path[i];
  const q = path[i + 1];
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const nx = (-(q.y - p.y) / len) * halfLength;
  const ny = ((q.x - p.x) / len) * halfLength;
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  return [
    { x: mx - nx, y: my - ny },
    { x: mx + nx, y: my + ny },
  ];
}

/**
 * Does the link from→to (leaving `from` by `dir`) cross a door? A link is
 * drawn once, from one side only (the dedup rule), so the far side's exits
 * line counts too: its door in the reverse direction is this passage when
 * it links back to `from` or hasn't been walked yet. The far side counts
 * only when that door was read by the exits list grammar (parseTownExits).
 * The single-regex parse before it also flagged the bare exit after a door
 * phrase's "and" ("an open wrought iron gate leading east and west", "a
 * closed curtain leading backroom and west"), and rooms saved then keep
 * those phantom doors until their next sighting — recognizable because
 * every door the grammar reads gets its noun (doorNouns), and theirs have
 * none. Bill's live save (all saved before the grammar): the far side would
 * add 5 ticks, 3 of them phantoms (Garrison Plaza w, the church Nave's w,
 * Tricia's Traveling Trinkets' w) and 2 real doors on links to duplicate
 * rooms. On the frozen-corpus replay's maps it adds none: DartMUD names a
 * door on both of its sides. The drawing side's own doors count as before
 * (a phantom there heals when the room is next seen).
 */
export function linkHasDoor(
  from: Pick<TownRoom, 'id' | 'doorDirs'>,
  to: Pick<TownRoom, 'doorDirs' | 'doorNouns' | 'links'>,
  dir: TownDir
): boolean {
  if (from.doorDirs.includes(dir)) return true;
  const rev = TOWN_REVERSE[dir];
  const back = to.links[rev];
  return (
    to.doorDirs.includes(rev) &&
    to.doorNouns?.[rev] !== undefined &&
    (back === undefined || back === from.id)
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Width budget (px) for every room label on one floor. Labels are centred
 * under their box, so east-west neighbours one `pitch` apart share the span
 * between their centres: wA/2 + wB/2 + gap ≤ pitch. Each side may take half
 * (pitch - gap); a neighbour whose own label needs less lends it the rest.
 * Rooms with no east/west neighbour get `maxWidth`. (The old fixed
 * 14-character cut — up to ~67px of 8px Courier on a 46px pitch — left 63
 * of the 99 east-west neighbour pairs in Bill's live save overlapping or
 * under 6px apart; with these budgets, none.)
 */
export function labelBudgets(
  rooms: readonly Pick<TownRoom, 'id' | 'z'>[],
  layout: TownDisplayLayout,
  naturalWidth: (roomId: number) => number,
  pitch: number,
  gap: number,
  maxWidth: number
): Map<number, number> {
  const half = pitch - gap;
  const budgets = new Map<number, number>();
  for (const room of rooms) {
    const at = layout.pos(room.id);
    if (!at) continue;
    let budget = maxWidth;
    for (const side of [-1, 1]) {
      const neighbour = layout.roomAt(at.x + side, at.y, room.z);
      if (neighbour === undefined) continue;
      budget = Math.min(budget, 2 * half - Math.min(naturalWidth(neighbour), half));
    }
    budgets.set(room.id, budget);
  }
  return budgets;
}

/** Trim `name` with an ellipsis until it measures within `maxWidth` */
export function fitLabel(name: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(name) <= maxWidth) return name;
  for (let n = name.length - 1; n > 0; n--) {
    const label = name.slice(0, n).trimEnd() + '…';
    if (measure(label) <= maxWidth) return label;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

/**
 * Where double-clicking a stair room takes the view: the floor its
 * staircase leads to and, when the stair has been walked, the room it
 * arrives in (the floor's centroid, the old target, sat a median 1.4 and up
 * to 8.5 display cells from that room across the 32 walked stairs in Bill's
 * live save — z=1 holds both the keep and the inn). Up wins when a room has
 * both. An unwalked staircase still switches to the floor above/below when
 * that floor is mapped (roomId null).
 */
export function stairJumpTarget(
  room: Pick<TownRoom, 'z' | 'exits' | 'links'>,
  roomById: (id: number) => Pick<TownRoom, 'id' | 'z'> | undefined,
  floors: ReadonlySet<number>
): { z: number; roomId: number | null } | null {
  for (const dir of ['u', 'd'] as const) {
    const linkId = room.links[dir];
    if (!room.exits.includes(dir) && linkId === undefined) continue;
    const dest = linkId === undefined ? undefined : roomById(linkId);
    if (dest && dest.z !== room.z) return { z: dest.z, roomId: dest.id };
    const z = room.z + (dir === 'u' ? 1 : -1);
    if (floors.has(z)) return { z, roomId: null };
  }
  return null;
}
