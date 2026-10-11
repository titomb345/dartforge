/**
 * Regression test: town map DISPLAY geometry (src/lib/townDisplayLayout.ts),
 * the presentation-only layer TownMapCanvas draws, hit-tests and centers on.
 *
 *  1. Gap compaction through the REAL engine: a collision stretch leaves a
 *     western spur's link two cells long; the display pulls it back exact
 *     while the genuinely non-Euclidean street (two different "Road" rooms
 *     at one net coordinate) stays long — and the store is never written.
 *  2. Stairs: a pull drags the stair-linked structure on the floor above
 *     along (stairs stay aligned); a room in the way up there blocks that
 *     pull, and the gap closes from the other side instead.
 *  3. Guards: a pull may not bend an exact diagonal or turn an off-axis
 *     exit sideways; parallel streets tied together compact together; a
 *     link between floors is no street; rooms sharing a store cell (a
 *     corrupt save) stay put and stay hit-testable.
 *  4. Properties on randomly stretched towns — both the half-plane stretch
 *     older saves were grown under and today's bounded stretch: no shared
 *     cells, no link longer, exact links stay exact, every exit keeps
 *     heading its way, deterministic, idempotent, store untouched — and
 *     gaps do close.
 *  5. Memo: the layout signature ignores visits/descriptions/exits/icons
 *     (so syncs don't recompute) but sees moves and links; cache identity.
 *  6. Link shapes: a diagonal whose ends drifted is 'displaced' (it used to
 *     draw as a plain straight shortcut); a displaced link's stroke and its
 *     door tick (square to the segment it crosses).
 *  7. Door ticks from EITHER side of a link — the far side only when the
 *     exits list grammar read its door (a pre-grammar save's phantom
 *     "leading east and west" door must not tick).
 *  8. Labels: measured-width budgets never let east-west neighbours overlap.
 *  9. Stair double-click target: the linked room on the other floor.
 */
import { TownMapStore, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownDir, TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';
import {
  computeTownDisplayLayout,
  createTownDisplayLayoutCache,
  doorTick,
  fitLabel,
  labelBudgets,
  linkHasDoor,
  linkPolyline,
  linkShape,
  stairJumpTarget,
  townLayoutSignature,
  type LayoutRoom,
} from '../../src/lib/townDisplayLayout';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

// ---------------------------------------------------------------------------
// 1. Real engine: a stretch lengthens an unrelated spur; the display heals it
// ---------------------------------------------------------------------------

const map = new TownMapStore();
const loc = new TownLocalizer(map);
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are exits: ${exits}.`),
});
let t = 1000;
const step = (cmd: string | null, b: TownRoomBlock) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  loc.onRoomBlock(b, '0:0,0', (t += 1000));
  return map.pos!.roomId;
};

const CENTER = block('Center Square', 'north, east, south, and west', 'The center of town.');
const ROAD = block('Road', 'east and west', 'A cobblestone road running east to west.');
const FERRY = block('Ferry Landing', 'west', 'A landing at the river ferry.');
const WEST_GATE = block('West Gate', 'east and south', 'The old west gate of the town.');
const WELL = block('Well', 'north', 'A deep stone well under a little roof.');
const SOUTH_ROAD = block('South Road', 'north and east', 'The south road bends east.');
const LANE = block('Lane', 'north, east, and west', 'A narrow lane between houses.');

const center = step(null, CENTER);
const roadA = step('e', ROAD);
step('e', FERRY);
step('w', ROAD);
step('w', CENTER);
const westGate = step('w', WEST_GATE);
const well = step('s', WELL);
step('n', WEST_GATE);
step('e', CENTER);
const southRoad = step('s', SOUTH_ROAD);
const lane = step('e', LANE);
// n from the Lane lands where Road A sits, but Road A has no south exit:
// a different room → the store STRETCHES: Road A's structure at/above the
// cut (Road A, the Ferry Landing, the Center Square and, through it, the
// West Gate) moves north, which also stretches the West Gate→Well spur to
// two cells.
const roadB = step('n', ROAD);

const town = map.get(map.pos!.townId)!;
const room = (id: number) => town.rooms.get(id)!;
check(roadA !== roadB, 'setup: the second Road should be a new room');
check(map.stretches === 1, `setup: stretches=${map.stretches}, expected 1`);
check(
  room(well).y - room(westGate).y === 2,
  `setup: store West Gate→Well should span 2 cells (dy=${room(well).y - room(westGate).y})`
);

const storeBefore = [...town.rooms.values()].map((r) => `${r.id}:${r.x},${r.y},${r.z}`).join(' ');
const layout = computeTownDisplayLayout([...town.rooms.values()]);
const storeAfter = [...town.rooms.values()].map((r) => `${r.id}:${r.x},${r.y},${r.z}`).join(' ');
check(storeBefore === storeAfter, 'display layout wrote coordinates back into the store');

const gate = layout.pos(westGate)!;
const wellCell = layout.pos(well)!;
check(
  wellCell.x === gate.x && wellCell.y === gate.y + 1,
  `display Well should sit exactly south of the West Gate (gate ${gate.x},${gate.y} well ${wellCell.x},${wellCell.y})`
);
check(layout.pulls === 1, `expected exactly 1 pull, got ${layout.pulls}`);
// The non-Euclidean street can't close: pulling either side would land a
// room on the other Road.
const c = layout.pos(center)!;
const s = layout.pos(southRoad)!;
check(s.y - c.y === 2, `Center→South Road must stay 2 cells (non-Euclidean), got ${s.y - c.y}`);
check(
  layout.roomAt(wellCell.x, wellCell.y, 0) === well,
  'roomAt() does not find the Well on its display cell'
);
check(
  layout.roomAt(room(well).x, room(well).y, 0) === undefined,
  "the Well's old store cell should be empty in the display"
);

// ---------------------------------------------------------------------------
// 2-3. Synthetic structures
// ---------------------------------------------------------------------------

const R = (
  id: number,
  x: number,
  y: number,
  z: number,
  links: Partial<Record<TownDir, number>> = {}
): LayoutRoom => ({ id, x, y, z, links });

// Stairs move together
{
  const rooms = [
    R(1, 0, 0, 0, { e: 2 }),
    R(2, 2, 0, 0, { w: 1, u: 3 }),
    R(3, 2, 0, 1, { d: 2, e: 4 }),
    R(4, 3, 0, 1, { w: 3 }),
  ];
  const l = computeTownDisplayLayout(rooms);
  const b = l.pos(2)!;
  const up = l.pos(3)!;
  check(b.x === 1 && b.y === 0, `stairs: B should be pulled to (1,0), got (${b.x},${b.y})`);
  check(up.x === b.x && up.y === b.y, 'stairs: the room upstairs lost its alignment with B');
  check(l.pos(4)!.x === 2, 'stairs: the upstairs street did not move with its stair');
}
// ... and a room in the way upstairs blocks that pull: the stair structure
// stays put and the gap closes from the other side instead
{
  const rooms = [
    R(1, 0, 0, 0, { e: 2 }),
    R(2, 2, 0, 0, { w: 1, u: 3 }),
    R(3, 2, 0, 1, { d: 2 }),
    R(9, 1, 0, 1), // unrelated room on floor 1, exactly where the stair would land
  ];
  const l = computeTownDisplayLayout(rooms);
  check(
    l.pos(2)!.x === 2 && l.pos(3)!.x === 2,
    'stairs: a pull landed the stair structure onto the room upstairs'
  );
  check(
    l.pos(1)!.x === 1,
    `stairs: the gap should close from the west side (room 1 at x=${l.pos(1)!.x})`
  );
}
// An exact diagonal across the cut is never bent
{
  const rooms = [R(1, 0, 0, 0, { e: 2 }), R(2, 2, 0, 0, { w: 1, sw: 3 }), R(3, 1, 1, 0, { ne: 2 })];
  const l = computeTownDisplayLayout(rooms);
  check(l.pos(2)!.x === 2, 'diagonal guard: pulling B west would bend the exact ne/sw link');
}
// An off-axis east exit must still leave eastward
{
  const rooms = [R(1, 0, 0, 0, { e: 2 }), R(2, 2, 0, 0, { w: 1 }), R(3, 1, 1, 0, { e: 2 })];
  const l = computeTownDisplayLayout(rooms);
  check(l.pos(2)!.x === 2, "heading guard: pulling B west would turn room 3's east exit north");
}
// Parallel streets tied together compact together
{
  const rooms = [
    R(1, 0, 0, 0, { e: 2 }),
    R(2, 3, 0, 0, { w: 1, s: 4 }),
    R(3, 0, 1, 0, { e: 4 }),
    R(4, 3, 1, 0, { w: 3, n: 2 }),
  ];
  const l = computeTownDisplayLayout(rooms);
  check(
    l.pos(2)!.x === 1 && l.pos(4)!.x === 1,
    `parallel streets: expected both pulled to x=1, got ${l.pos(2)!.x} and ${l.pos(4)!.x}`
  );
}
// A cardinal link between floors (impossible in a loaded store: the load
// cleanse severs it) is no street to compact
{
  const l = computeTownDisplayLayout([R(1, 0, 0, 0, { e: 2 }), R(2, 2, 0, 1, { w: 1 })]);
  check(l.pulls === 0 && l.pos(2)!.x === 2, 'floor guard: a link between floors pulled a room');
}
// Two rooms on one store cell (a corrupt save) stay put: pulling the one the
// cell index holds would hide the other from roomAt (no hover, no walk). The
// gap closes from the other side instead, and gaps elsewhere as usual.
{
  const rooms = [
    R(1, 0, 0, 0, { e: 2 }),
    R(2, 2, 0, 0, { w: 1 }),
    R(3, 2, 0, 0), // stacked on room 2
    R(4, 0, 3, 0, { e: 5 }),
    R(5, 2, 3, 0, { w: 4 }),
  ];
  const l = computeTownDisplayLayout(rooms);
  check(
    l.pos(2)!.x === 2 && l.pos(3)!.x === 2,
    `stacked rooms: a room sharing its store cell was pulled (to x=${l.pos(2)!.x})`
  );
  check(l.roomAt(2, 0, 0) !== undefined, 'stacked rooms: their cell vanished from roomAt');
  check(l.pos(1)!.x === 1, 'stacked rooms: the gap should close from the other side');
  check(l.pos(5)!.x === 1, 'stacked rooms: an unrelated gap should still close');
}

// ---------------------------------------------------------------------------
// 4. Properties on randomly stretched towns
// ---------------------------------------------------------------------------

const VEC: Record<TownDir, [number, number]> = {
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
const REV: Record<TownDir, TownDir> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
  u: 'd',
  d: 'u',
};
const LATERAL: TownDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** mulberry32 — deterministic PRNG */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

/**
 * Grow a grid-true town, then stretch it like the store does: `bounded`
 * shifts a random occupant's structure as townMap.ts stretchToVacate does
 * today (rooms linked to it at/beyond the cut, plus any room a shifted one
 * would land on); otherwise the whole half-plane beyond the cut moves, as
 * the stretch older saves were grown under did.
 */
function randomTown(seed: number, bounded: boolean): LayoutRoom[] {
  const rand = rng(seed);
  const rooms: LayoutRoom[] = [R(0, 0, 0, 0)];
  const cells = new Map<string, LayoutRoom>([['0,0,0', rooms[0]]]);
  const target = 25 + Math.floor(rand() * 40);
  for (let guard = 0; rooms.length < target && guard < 5000; guard++) {
    const from = rooms[Math.floor(rand() * rooms.length)];
    const stairs = rand() < 0.06;
    const dir: TownDir = stairs ? (rand() < 0.5 ? 'u' : 'd') : LATERAL[Math.floor(rand() * 8)];
    const [dx, dy] = VEC[dir];
    const z = from.z + (dir === 'u' ? 1 : dir === 'd' ? -1 : 0);
    const key = `${from.x + dx},${from.y + dy},${z}`;
    if (from.links[dir] !== undefined) continue;
    const existing = cells.get(key);
    if (existing) {
      // Loop closure onto an existing neighbour (both ways, if free)
      if (existing.links[REV[dir]] === undefined && rand() < 0.5) {
        from.links[dir] = existing.id;
        existing.links[REV[dir]] = from.id;
      }
      continue;
    }
    const r = R(rooms.length, from.x + dx, from.y + dy, z, { [REV[dir]]: from.id });
    from.links[dir] = r.id;
    rooms.push(r);
    cells.set(key, r);
  }
  const stretches = 1 + Math.floor(rand() * (bounded ? 10 : 6));
  for (let i = 0; i < stretches; i++) {
    const pivot = rooms[Math.floor(rand() * rooms.length)];
    const dir = (['n', 's', 'e', 'w'] as const)[Math.floor(rand() * 4)];
    const [dx, dy] = VEC[dir];
    const beyond = (r: LayoutRoom) =>
      dx === 1
        ? r.x >= pivot.x
        : dx === -1
          ? r.x <= pivot.x
          : dy === 1
            ? r.y >= pivot.y
            : r.y <= pivot.y;
    let moved = rooms.filter(beyond);
    if (bounded) {
      const at = new Map(rooms.map((r) => [`${r.x},${r.y},${r.z}`, r]));
      const linked = new Map<number, LayoutRoom[]>(rooms.map((r) => [r.id, []]));
      for (const r of rooms) {
        for (const id of Object.values(r.links)) {
          linked.get(r.id)!.push(rooms[id]);
          linked.get(id)!.push(r);
        }
      }
      const shifted = new Set([pivot]);
      const stack = [pivot];
      while (stack.length > 0) {
        const r = stack.pop()!;
        const landsOn = at.get(`${r.x + dx},${r.y + dy},${r.z}`);
        for (const n of [...(landsOn ? [landsOn] : []), ...linked.get(r.id)!]) {
          if (shifted.has(n) || (n !== landsOn && !beyond(n))) continue;
          shifted.add(n);
          stack.push(n);
        }
      }
      moved = [...shifted];
    }
    for (const r of moved) {
      r.x += dx;
      r.y += dy;
    }
  }
  return rooms;
}

const kind = (dir: TownDir, dx: number, dy: number) => {
  const [vx, vy] = VEC[dir];
  if (dir === 'u' || dir === 'd') return dx === 0 && dy === 0 ? 'exact' : 'off';
  const steps = vx !== 0 ? dx * vx : dy * vy;
  if (steps === 1 && dx === vx && dy === vy) return 'exact';
  if (steps > 1 && dx === steps * vx && dy === steps * vy) return 'long';
  return 'off';
};

for (const bounded of [false, true]) {
  const family = bounded ? 'bounded-stretch' : 'half-plane';
  let longBefore = 0;
  let longAfter = 0;
  let totalPulls = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const at = `${family} seed ${seed}`;
    const rooms = randomTown(seed, bounded);
    const snapshot = JSON.stringify(rooms);
    const l = computeTownDisplayLayout(rooms);
    totalPulls += l.pulls;
    check(JSON.stringify(rooms) === snapshot, `${at}: input rooms were mutated`);
    const by = new Map(rooms.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const r of rooms) {
      const p = l.pos(r.id)!;
      const key = `${p.x},${p.y},${r.z}`;
      check(!seen.has(key), `${at}: two rooms on display cell ${key}`);
      seen.add(key);
      check(l.roomAt(p.x, p.y, r.z) === r.id, `${at}: roomAt disagrees with pos for #${r.id}`);
      for (const [dir, id] of Object.entries(r.links) as [TownDir, number][]) {
        const o = by.get(id)!;
        const q = l.pos(id)!;
        const [bx, by2] = [o.x - r.x, o.y - r.y];
        const [ax, ay] = [q.x - p.x, q.y - p.y];
        const kb = kind(dir, bx, by2);
        const ka = kind(dir, ax, ay);
        if (kb === 'long' && dir.length === 1 && dir !== 'u' && dir !== 'd') longBefore++;
        if (ka === 'long' && dir.length === 1 && dir !== 'u' && dir !== 'd') longAfter++;
        check(
          Math.abs(ax) + Math.abs(ay) <= Math.abs(bx) + Math.abs(by2),
          `${at}: #${r.id} -${dir}-> #${id} got longer`
        );
        check(
          !(kb === 'exact' && ka !== 'exact'),
          `${at}: #${r.id} -${dir}-> #${id} lost exactness`
        );
        const [vx, vy] = VEC[dir];
        if (vx !== 0 || vy !== 0) {
          check(
            !(bx * vx + by2 * vy >= 1 && ax * vx + ay * vy < 1),
            `${at}: #${r.id} -${dir}-> #${id} no longer heads ${dir}`
          );
        }
      }
    }
    // Deterministic regardless of input order
    const shuffled = [...rooms].reverse();
    const l2 = computeTownDisplayLayout(shuffled);
    check(
      rooms.every((r) => l2.pos(r.id)!.x === l.pos(r.id)!.x && l2.pos(r.id)!.y === l.pos(r.id)!.y),
      `${at}: layout depends on input order`
    );
    // Idempotent: the display layout is already a fixpoint
    const again = computeTownDisplayLayout(
      rooms.map((r) => ({ ...r, x: l.pos(r.id)!.x, y: l.pos(r.id)!.y }))
    );
    check(again.pulls === 0, `${at}: compacting the display again pulled ${again.pulls} more`);
  }
  check(totalPulls > 0, `${family} towns: compaction never pulled anything`);
  check(
    longAfter < longBefore / 2,
    `${family} towns: long links ${longBefore} -> ${longAfter}, expected at least half closed`
  );
  console.log(
    `${family} random towns: long cardinal links ${longBefore} -> ${longAfter}, ${totalPulls} pulls`
  );
}

// ---------------------------------------------------------------------------
// 5. Memo: signature + cache
// ---------------------------------------------------------------------------

{
  const rooms = () => [...town.rooms.values()];
  const sig0 = townLayoutSignature(rooms());
  // A re-print with fresh prose and visit count, an icon pick, a rename —
  // none of it moves anything, so the display must not recompute.
  map.touchRoom(
    room(well),
    block('Well', 'north', 'A deep well. A bucket hangs above.'),
    (t += 1000)
  );
  map.setRoomIcon(town.id, well, 'inn');
  map.renameTown(town.id, 'Renamed');
  check(townLayoutSignature(rooms()) === sig0, 'signature changed without a layout change');
  check(
    townLayoutSignature([...rooms()].reverse()) === sig0,
    'signature depends on room iteration order'
  );

  const cache = createTownDisplayLayoutCache();
  const first = cache(town.id, rooms());
  check(cache(town.id, rooms()) === first, 'cache recomputed an unchanged town');
  check(cache(town.id + 1, rooms()) !== first, 'cache served one town’s layout for another');
  const back = cache(town.id, rooms());
  // A new link (link heal / loop closure) changes the layout inputs
  room(well).links.e = southRoad;
  check(townLayoutSignature(rooms()) !== sig0, 'signature missed a link change');
  const relinked = cache(town.id, rooms());
  check(relinked !== back, 'cache kept a stale layout after a link change');
  delete room(well).links.e;
  // A move (stretch, merge, relayout) too
  room(lane).x += 5;
  check(townLayoutSignature(rooms()) !== sig0, 'signature missed a moved room');
  room(lane).x -= 5;
  check(townLayoutSignature(rooms()) === sig0, 'signature not restored after undoing the changes');
}

// ---------------------------------------------------------------------------
// 6. Link shapes
// ---------------------------------------------------------------------------

{
  const none = () => false;
  const at = (x: number, y: number) => ({ x, y });
  check(linkShape(at(0, 0), at(1, 0), 'e', none) === 'straight', 'exact e should be straight');
  check(linkShape(at(0, 0), at(3, 0), 'e', none) === 'straight', 'long clear e should be straight');
  check(
    linkShape(at(0, 0), at(3, 0), 'e', (x, y) => x === 2 && y === 0) === 'displaced',
    'long e through an occupied cell should be displaced'
  );
  check(linkShape(at(0, 0), at(2, 1), 'e', none) === 'displaced', 'off-axis e should be displaced');
  check(
    linkShape(at(0, 0), at(-1, 0), 'e', none) === 'displaced',
    'backward e should be displaced'
  );
  check(linkShape(at(0, 0), at(1, -1), 'ne', none) === 'straight', 'exact ne should be straight');
  check(
    linkShape(at(0, 0), at(2, -1), 'ne', none) === 'displaced',
    'a ne link whose far end drifted east should be displaced'
  );
  check(linkShape(at(0, 0), at(2, -2), 'ne', none) === 'straight', 'clear 2-step ne is straight');
  check(
    linkShape(at(0, 0), at(2, -2), 'ne', (x, y) => x === 1 && y === -1) === 'displaced',
    'a 2-step ne through an occupied cell should be displaced'
  );
  check(linkShape(at(0, 0), at(-1, 1), 'ne', none) === 'displaced', 'backward ne is displaced');

  // Stroke and door tick (pixels: pitch 46, box half-size 14)
  const square = (
    t: [{ x: number; y: number }, { x: number; y: number }],
    dx: number,
    dy: number
  ) => Math.abs((t[1].x - t[0].x) * dx + (t[1].y - t[0].y) * dy) < 1e-9;
  const near = (p: { x: number; y: number }, x: number, y: number) =>
    Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
  const plain = linkPolyline(at(0, 0), at(46, 0), 'e', false, 14);
  check(plain.length === 2 && near(plain[1], 46, 0), 'a straight link runs center to center');
  const plainTick = doorTick(plain, 5);
  check(
    square(plainTick, 1, 0) && near(plainTick[0], 23, -5) && near(plainTick[1], 23, 5),
    'a straight east link ticks vertically at its middle'
  );
  // An east exit drawn to a room one cell south-east: out of the east
  // side, a nearly vertical middle, into the far room's west side
  const bent = linkPolyline(at(0, 0), at(46, 46), 'e', true, 14);
  check(
    bent.length === 4 &&
      near(bent[0], 14, 0) &&
      near(bent[1], 20, 0) &&
      near(bent[2], 26, 46) &&
      near(bent[3], 32, 46),
    `displaced east link: leaves east and arrives from the west, got ${JSON.stringify(bent)}`
  );
  const bentTick = doorTick(bent, 5);
  check(
    square(bentTick, 6, 46),
    'the tick of a displaced link must be square to the segment it crosses'
  );
  check(
    near(
      { x: (bentTick[0].x + bentTick[1].x) / 2, y: (bentTick[0].y + bentTick[1].y) / 2 },
      23,
      23
    ),
    'the tick of a displaced link sits on its midpoint'
  );
  const tickLen = Math.hypot(bentTick[1].x - bentTick[0].x, bentTick[1].y - bentTick[0].y);
  check(Math.abs(tickLen - 10) < 1e-9, `tick length should be 10, got ${tickLen}`);
  const corner = linkPolyline(at(0, 0), at(92, -46), 'ne', true, 14);
  check(near(corner[0], 14, -14), 'a displaced ne link leaves through the top-right corner');
}

// ---------------------------------------------------------------------------
// 7. Door ticks from either side
// ---------------------------------------------------------------------------

{
  type DoorRoom = Pick<TownRoom, 'id' | 'doorDirs' | 'doorNouns' | 'links'>;
  const shop: DoorRoom = { id: 20, doorDirs: ['w'], doorNouns: { w: 'door' }, links: { w: 19 } };
  const street: DoorRoom = { id: 19, doorDirs: [], links: { e: 20 } };
  check(linkHasDoor(street, shop, 'e'), "the shop's west door must tick the street→shop link");
  check(linkHasDoor(shop, street, 'w'), 'the drawing side naming the door must tick');
  const unwalked: DoorRoom = { id: 21, doorDirs: ['w'], doorNouns: { w: 'gate' }, links: {} };
  check(linkHasDoor(street, unwalked, 'e'), 'an unwalked reverse door is the same passage');
  const elsewhere: DoorRoom = {
    id: 22,
    doorDirs: ['w'],
    doorNouns: { w: 'door' },
    links: { w: 99 },
  };
  check(
    !linkHasDoor(street, elsewhere, 'e'),
    "a far door leading to another room isn't this link's"
  );
  const plain: DoorRoom = { id: 23, doorDirs: [], links: { w: 19 } };
  check(!linkHasDoor(street, plain, 'e'), 'no door on either side must not tick');

  // Bill's live save, Garrison Road -e-> Garrison Plaza: the plaza was saved
  // before the exits list grammar, whose predecessor read "an open wrought
  // iron gate leading east and west" as two gates — its west "door" is a
  // phantom (no noun), so the far side must not tick the road's link...
  const road: DoorRoom = { id: 24, doorDirs: [], links: { e: 25, w: 23 } };
  const plaza: DoorRoom = { id: 25, doorDirs: ['e', 'w'], links: { e: 26, w: 24 } };
  check(!linkHasDoor(road, plaza, 'e'), "a pre-grammar far side's phantom door must not tick");
  // ... while the plaza's own (real) east gate still ticks as before, and so
  // does a stale door on the drawing side (it heals on the room's next visit)
  const gatehouse: DoorRoom = {
    id: 26,
    doorDirs: ['w'],
    doorNouns: { w: 'gate' },
    links: { w: 25 },
  };
  check(linkHasDoor(plaza, gatehouse, 'e'), "the drawing side's own door ticks, saved or not");
  // The same plaza read by the grammar: one gate, east, with its noun
  const plazaNow = parseTownExits(
    'There are two exits: an open wrought iron gate leading east and west.'
  );
  check(
    plazaNow.doorDirs.join() === 'e' && plazaNow.doorNouns.e === 'gate',
    `setup: the grammar should read one east gate, got ${JSON.stringify(plazaNow)}`
  );
  const plazaFixed: DoorRoom = {
    ...plaza,
    doorDirs: plazaNow.doorDirs,
    doorNouns: plazaNow.doorNouns,
  };
  check(!linkHasDoor(road, plazaFixed, 'e'), 'the plain west exit must not tick once re-read');
  const plainSide: DoorRoom = { id: 26, doorDirs: [], links: { w: 25 } };
  check(linkHasDoor(plainSide, plazaFixed, 'w'), "a re-read far side's real gate ticks");
}

// ---------------------------------------------------------------------------
// 8. Labels
// ---------------------------------------------------------------------------

{
  const CELL = 46;
  const GAP = 6;
  const MAX = 2 * CELL - 6;
  const measure = (text: string) => text.length * 4.8; // 8px Courier New
  const names: Record<number, string> = {
    1: 'Garrison Road',
    2: 'Garrison Plaza',
    3: 'Inn',
    4: "Wuffa's Specialty Barding",
    5: "Wuffa's Specialty Barding",
  };
  const rooms = [R(1, 0, 0, 0), R(2, 1, 0, 0), R(3, 0, 2, 0), R(4, 1, 2, 0), R(5, 0, 4, 0)];
  const l = computeTownDisplayLayout(rooms);
  const budgets = labelBudgets(rooms, l, (id) => measure(names[id]), CELL, GAP, MAX);
  const label = (id: number) => fitLabel(names[id], budgets.get(id)!, measure);
  check(label(1) === 'Garriso…', `crowded long pair: got "${label(1)}"`);
  check(label(2) === 'Garriso…', `crowded long pair: got "${label(2)}"`);
  check(label(3) === 'Inn', `a short label is never trimmed: got "${label(3)}"`);
  check(
    label(4) === "Wuffa's Spec…",
    `next to a short label a long one borrows its unused width: got "${label(4)}"`
  );
  check(
    label(5) === "Wuffa's Specialt…",
    `an isolated room gets the wide budget: got "${label(5)}"`
  );
  // The old fixed cut kept 13 characters + '…' (67px) no matter what
  check(measure(label(1)) + measure(label(2)) <= 2 * (CELL - GAP), 'pair 1-2 labels overlap');
  check(measure(label(3)) + measure(label(4)) <= 2 * (CELL - GAP), 'pair 3-4 labels overlap');

  // Property: random rows of random names never overlap
  const rand = rng(7);
  const words = ['Market', 'Garrison', 'Road', 'Street', 'Inn', 'Hall', 'of', 'the', 'Mortals'];
  for (let trial = 0; trial < 200; trial++) {
    const row: LayoutRoom[] = [];
    const rowNames = new Map<number, string>();
    let x = 0;
    for (let i = 0; i < 6; i++) {
      x += rand() < 0.7 ? 1 : 2;
      row.push(R(i, x, 0, 0));
      const n = 1 + Math.floor(rand() * 4);
      rowNames.set(
        i,
        Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ')
      );
    }
    const lay = computeTownDisplayLayout(row);
    const w = (id: number) => measure(rowNames.get(id)!);
    const b = labelBudgets(row, lay, w, CELL, GAP, MAX);
    const width = (id: number) => measure(fitLabel(rowNames.get(id)!, b.get(id)!, measure));
    for (let i = 0; i + 1 < row.length; i++) {
      if (lay.pos(row[i + 1].id)!.x - lay.pos(row[i].id)!.x !== 1) continue;
      check(
        width(row[i].id) / 2 + width(row[i + 1].id) / 2 + GAP <= CELL + 1e-9,
        `labels overlap: "${rowNames.get(row[i].id)}" / "${rowNames.get(row[i + 1].id)}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Stair double-click target
// ---------------------------------------------------------------------------

{
  type StairRoom = Pick<TownRoom, 'id' | 'z' | 'exits' | 'links'>;
  const stairs = new Map<number, StairRoom>([
    [10, { id: 10, z: 1, exits: ['d'], links: { d: 1 } }],
    [11, { id: 11, z: -1, exits: ['u'], links: { u: 1 } }],
    [12, { id: 12, z: 0, exits: [], links: {} }],
  ]);
  const byId = (id: number) => stairs.get(id);
  const floors = new Set([-1, 0, 1]);
  const linked = stairJumpTarget(
    { z: 0, exits: ['u', 'd'], links: { u: 10, d: 11 } },
    byId,
    floors
  );
  check(linked?.z === 1 && linked.roomId === 10, 'a walked staircase must target its arrival room');
  const down = stairJumpTarget({ z: 0, exits: ['d'], links: { d: 11 } }, byId, floors);
  check(down?.z === -1 && down.roomId === 11, 'a down stair must target the room below');
  const unwalked = stairJumpTarget({ z: 0, exits: ['u'], links: {} }, byId, floors);
  check(unwalked?.z === 1 && unwalked.roomId === null, 'an unwalked stair still switches floors');
  check(
    stairJumpTarget({ z: 1, exits: ['u'], links: {} }, byId, floors) === null,
    'a stair to an unmapped floor goes nowhere'
  );
  const corrupt = stairJumpTarget({ z: 0, exits: ['u'], links: { u: 12 } }, byId, floors);
  check(
    corrupt?.z === 1 && corrupt.roomId === null,
    'an up link to a same-floor room falls back to the floor above'
  );
  check(stairJumpTarget({ z: 0, exits: ['n'], links: {} }, byId, floors) === null, 'not a stair');
}

if (fail) process.exit(1);
console.log('PASS — display layout compacts stretch gaps safely and drives the canvas rules');
