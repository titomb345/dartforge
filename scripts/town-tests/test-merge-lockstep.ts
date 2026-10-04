/**
 * Regression test: town merges align by LINK GRAPH, not by grid cells, and
 * move only the matched room's link component (Oct 2026 deep dive).
 *
 * mergeTowns used to translate EVERY room of the fragment town by the matched
 * pair's offset and fuse a room only when its translated cell held a
 * same-named room. Two towns grown independently disagree on coordinates a
 * few rooms away from the pair (stretches, nudges), so corpus merges copied
 * most fragment rooms as duplicates (72 duplicate copies in 7 merges; a
 * 19-room keep fragment came back with 15 copies), conflated twins (the west
 * Garrison Road segment fused into the east one), and could collapse two
 * fragment rooms into one copy. And because the whole town moved, a 19-room
 * Eris floater component inside Soriktos dragged all of Soriktos into Eris,
 * two floors up.
 *
 * Scenarios:
 *  1. stretched target: lockstep fuses every room; the new room hangs beside
 *     its own neighbor
 *  2. component scope + floors: only the matched component moves, floors
 *     follow its u/d links; the source town survives
 *  3. probe direction: the smaller COMPONENT moves, not the smaller town
 *  4. intra-town duplicate component (Segliz: a floater one floor up grew a
 *     copy of the harbor streets) fuses back, anchors follow
 *  5. re-anchor: a piece joined by a link the target never walked
 *  6. no two-into-one collapse
 *  7. adjacent Garrison Road twins never cross-fuse (real Eris texts)
 */
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownDir, type TownRoomBlock } from '../../src/lib/townParser';

const WORDS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  u: 'up',
  d: 'down',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};
const REV: Record<string, TownDir> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  u: 'd',
  d: 'u',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
};

function block(name: string, dirs: TownDir[], desc?: string): TownRoomBlock {
  const text =
    desc ??
    `This is the ${name.toLowerCase()}, a place with plenty of distinctive prose for comparison.`;
  return {
    name,
    descFirst: text.slice(0, 70),
    desc: text,
    exits: parseTownExits(`There are exits: ${dirs.map((d) => WORDS[d]).join(', ')}.`),
  };
}

type Spec = [string, number, number, number, TownDir[], string?];

/** Rooms at explicit coordinates, wired with symmetric links. */
function build(
  store: TownMapStore,
  town: Town,
  rooms: Spec[],
  links: [number, TownDir, number][]
): TownRoom[] {
  const out = rooms.map(([name, x, y, z, dirs, desc]) =>
    store.addRoom(town, block(name, dirs, desc), x, y, z, 0)
  );
  for (const [a, d, b] of links) {
    out[a].links[d] = out[b].id;
    out[b].links[REV[d]] = out[a].id;
  }
  return out;
}

let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else console.log(`ok   ${msg}`);
};
const named = (town: Town, name: string) => [...town.rooms.values()].filter((r) => r.name === name);
const selfLinked = (town: Town) =>
  [...town.rooms.values()].some((r) => Object.values(r.links).includes(r.id));

// ---------------------------------------------------------------------------
// 1. Stretched target: translated cells miss, lockstep fuses everything
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  // Gate - Lane - [stretched gap] - Square - Market - Inn, Temple north of Square
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Lane', 1, 0, 0, ['e', 'w']],
      ['Square', 3, 0, 0, ['e', 'n', 'w']],
      ['Market', 4, 0, 0, ['e', 'w']],
      ['Inn', 5, 0, 0, ['s', 'w']],
      ['Temple', 3, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [3, 'e', 4],
      [2, 'n', 5],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Lane', 1, 0, 0, ['e', 'w']],
      ['Square', 2, 0, 0, ['e', 'n', 'w']],
      ['Market', 3, 0, 0, ['e', 'w']],
      ['Inn', 4, 0, 0, ['s', 'w']],
      ['Temple', 2, -1, 0, ['s']],
      ['Bakery', 4, 1, 0, ['n']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [3, 'e', 4],
      [2, 'n', 5],
      [4, 's', 6],
    ]
  );
  const cand = store.findMergeCandidate(B, b[2], 2);
  check(cand?.town === A && cand.room === a[2], 'stretch: fragment Square matches Eris Square');
  const result = store.mergeTowns(B, b[2].id, A, a[2].id);
  check(
    result?.fused === 6 && result.placed === 1,
    `stretch: 6 fused + 1 copied (got ${JSON.stringify(result)})`
  );
  for (const n of ['Gate', 'Lane', 'Square', 'Market', 'Inn', 'Temple']) {
    check(named(A, n).length === 1, `stretch: "${n}" not duplicated (${named(A, n).length})`);
  }
  const bakery = named(A, 'Bakery')[0];
  check(
    !!bakery && a[4].links.s === bakery.id && bakery.links.n === a[4].id,
    'stretch: Bakery hangs south of the Inn'
  );
  check(
    !!bakery && bakery.x === a[4].x && bakery.y === a[4].y + 1 && bakery.z === 0,
    'stretch: Bakery placed beside the Inn, not at its translated cell'
  );
  check(!store.towns.has(B.id), 'stretch: the emptied fragment town is deleted');
}

// ---------------------------------------------------------------------------
// 2. Component scope + floors: only the matched component moves, at the
//    floors its u/d links say — the fragment town's own city stays put.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'n', 'u']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
      ['Loft', 0, 0, 1, ['d']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [0, 'u', 3],
    ]
  );
  const S = store.createTown('Soriktos');
  const s = build(
    store,
    S,
    [
      // Soriktos itself
      ['Souk', 0, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['e', 'w']],
      ['Stables', 2, 0, 0, ['w']],
      // a disconnected Eris fragment filed here by an unexplained arrival
      ['Loft', 5, 5, -1, ['d']],
      ['Square', 5, 5, -2, ['d', 'e', 'n', 'u']],
      ['Market', 6, 5, -2, ['w']],
      ['Temple', 5, 4, -2, ['s']],
      ['Cellar', 5, 5, -3, ['u']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [4, 'u', 3],
      [4, 'e', 5],
      [4, 'n', 6],
      [4, 'd', 7],
    ]
  );
  S.anchors['0:1,1'] = s[0].id; // Soriktos' own gate anchor
  S.anchors['0:9,9'] = s[5].id; // learned on the fragment's Market
  // A portal crossing filed as a named exit joins the two places — named
  // exits must not pull Soriktos into the moved component
  s[0].namedLinks['enter portal'] = s[4].id;
  const cand = store.findMergeCandidate(S, s[4], 2);
  check(cand?.town === A && cand.room === a[0], 'scope: fragment Square matches Eris Square');
  store.mergeTowns(S, s[4].id, A, a[0].id);
  check(store.towns.has(S.id), 'scope: the Soriktos town survives the merge');
  check(
    s[0].namedLinks['enter portal'] === undefined,
    'scope: the named exit into the moved rooms is dropped (no cross-town link)'
  );
  check(named(A, 'Souk').length === 0, 'scope: Soriktos rooms were not dragged into Eris');
  check(
    ['Souk', 'Alley', 'Stables'].every((n) => named(S, n).length === 1),
    'scope: Soriktos keeps its own rooms'
  );
  check(named(S, 'Square').length === 0, 'scope: the Eris fragment left Soriktos');
  for (const n of ['Square', 'Market', 'Temple', 'Loft', 'Cellar']) {
    check(named(A, n).length === 1, `scope: "${n}" exactly once in Eris (${named(A, n).length})`);
  }
  const cellar = named(A, 'Cellar')[0];
  check(
    !!cellar && cellar.z === -1 && a[0].links.d === cellar.id,
    `scope: the copied Cellar hangs below the Square (z=${cellar?.z})`
  );
  check(
    [...A.rooms.values()].every(
      (r) => r.z === (r.name === 'Loft' ? 1 : r.name === 'Cellar' ? -1 : 0)
    ),
    'scope: every merged room on its u/d-linked floor'
  );
  check(
    S.anchors['0:1,1'] === s[0].id && A.anchors['0:9,9'] === a[1].id && !('0:9,9' in S.anchors),
    'scope: only the moved rooms take their anchors along'
  );
}

// ---------------------------------------------------------------------------
// 3. Probe direction: the smaller COMPONENT moves, not the smaller town
// ---------------------------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const E = map.createTown('Eris');
  const e = build(
    map,
    E,
    [
      ['Square', 0, 0, 0, ['e', 'n', 's', 'w']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
      ['Well', 0, 1, 0, ['n']],
      ['Gate', -1, 0, 0, ['e']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [0, 's', 3],
      [0, 'w', 4],
    ]
  );
  const S = map.createTown('Soriktos');
  const s = build(
    map,
    S,
    [
      ['Souk', 0, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['e', 'w']],
      ['Bazaar', 2, 0, 0, ['e', 'w']],
      ['Stables', 3, 0, 0, ['e', 'w']],
      ['Pier', 4, 0, 0, ['w']],
      // a 3-room Eris floater component (the player stands on its Square)
      ['Square', 9, 9, 0, ['e', 'n', 's', 'w']],
      ['Market', 10, 9, 0, ['w']],
      ['Temple', 9, 8, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [3, 'e', 4],
      [5, 'e', 6],
      [5, 'n', 7],
    ]
  );
  // Soriktos (8 rooms) is the BIGGER town, but its matching component (3)
  // is smaller than Eris' (5): the floater must move into Eris.
  loc.active = true;
  map.pos = { townId: S.id, roomId: s[5].id };
  loc.trackCommand('look', 1000);
  const res = loc.onRoomBlock(block('Square', ['e', 'n', 's', 'w']), null, 2000);
  check(
    res.merged?.from === S.id && res.merged.into === E.id,
    `direction: the floater component moved into Eris (${JSON.stringify(res.merged)})`
  );
  check(map.pos?.townId === E.id && map.pos.roomId === e[0].id, 'direction: position followed');
  check(
    named(S, 'Souk').length === 1 && named(E, 'Souk').length === 0,
    'direction: Soriktos stayed'
  );
  check(named(E, 'Square').length === 1, 'direction: no duplicate Square in Eris');

  // Mirror case: the player's own fragment (4 rooms) outweighs a 3-room
  // floater component that sits in a bigger town — the floater comes over.
  const map2 = new TownMapStore();
  const loc2 = new TownLocalizer(map2);
  const F = map2.createTown('Fragment');
  const f = build(
    map2,
    F,
    [
      ['Square', 0, 0, 0, ['e', 'n', 's', 'w']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
      ['Well', 0, 1, 0, ['n']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [0, 's', 3],
    ]
  );
  const S2 = map2.createTown('Soriktos');
  build(
    map2,
    S2,
    [
      ['Souk', 0, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['e', 'w']],
      ['Bazaar', 2, 0, 0, ['e', 'w']],
      ['Stables', 3, 0, 0, ['e', 'w']],
      ['Pier', 4, 0, 0, ['w']],
      ['Square', 9, 9, 0, ['e', 'n', 's', 'w']],
      ['Market', 10, 9, 0, ['w']],
      ['Temple', 9, 8, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [3, 'e', 4],
      [5, 'e', 6],
      [5, 'n', 7],
    ]
  );
  loc2.active = true;
  map2.pos = { townId: F.id, roomId: f[0].id };
  loc2.trackCommand('look', 1000);
  const res2 = loc2.onRoomBlock(block('Square', ['e', 'n', 's', 'w']), null, 2000);
  check(
    res2.merged?.from === S2.id && res2.merged.into === F.id && map2.pos?.townId === F.id,
    `direction: a smaller floater in a bigger town comes over (${JSON.stringify(res2.merged)})`
  );
  check(named(S2, 'Souk').length === 1 && named(F, 'Square').length === 1, 'direction: no drag');
}

// ---------------------------------------------------------------------------
// 4. Intra-town duplicate component: a floater planted one floor too high
//    grew a copy of the harbor streets; the probe must see its own town
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const T = store.createTown('Segliz');
  const t = build(
    store,
    T,
    [
      ['Weathered Gate', 1, 0, 0, ['w']],
      ['Main Street', 0, 0, 0, ['e', 'n', 's', 'w']],
      ['Harbor Way', 0, -1, 0, ['n', 's']],
      ['South Harbor Way', 0, 1, 0, ['n']],
      ['Promenade', -1, 0, 0, ['e']],
      // copy component at z=1, grown from a basement floater
      ['Basement', 4, -3, 0, ['u']],
      ['Warehouse', 4, -3, 1, ['d', 's']],
      ['Harbor Way', 4, -2, 1, ['n', 's']],
      ['Main Street', 4, -1, 1, ['e', 'n', 's', 'w']],
      ['South Harbor Way', 4, 0, 1, ['n']],
      ['Weathered Gate', 5, -1, 1, ['w']],
    ],
    [
      [1, 'e', 0],
      [1, 'n', 2],
      [1, 's', 3],
      [1, 'w', 4],
      [5, 'u', 6],
      [6, 's', 7],
      [7, 's', 8],
      [8, 's', 9],
      [8, 'e', 10],
    ]
  );
  T.anchors['0:-18,13'] = t[10].id; // the hex anchor had moved into the copy
  T.entryRoomId = t[0].id;
  // a dead named move's scar wired the real promenade to the copy's road
  t[4].namedLinks['enter portal'] = t[7].id;
  store.pos = { townId: T.id, roomId: t[8].id };
  const cand = store.findMergeCandidate(T, t[8], 2);
  check(cand?.town === T && cand.room === t[1], 'intra: the copy Main Street matches the real one');
  const result = cand ? store.mergeTowns(T, t[8].id, T, t[1].id) : null;
  check(
    result?.fused === 4 && result.placed === 2,
    `intra: 4 fused, Warehouse + Basement re-placed (got ${JSON.stringify(result)})`
  );
  for (const n of ['Main Street', 'Harbor Way', 'South Harbor Way', 'Weathered Gate']) {
    check(named(T, n).length === 1, `intra: "${n}" no longer duplicated (${named(T, n).length})`);
  }
  const wh = named(T, 'Warehouse')[0];
  check(
    !!wh && wh.z === 0 && t[2].links.n === wh.id && wh.links.s === t[2].id,
    'intra: Warehouse sits north of the real Harbor Way, on its floor'
  );
  const bs = named(T, 'Basement')[0];
  check(
    !!bs && bs.z === -1 && bs.links.u === wh?.id,
    'intra: Basement one floor below the Warehouse'
  );
  check(T.anchors['0:-18,13'] === t[0].id, 'intra: the hex anchor points at the real gate again');
  check(store.pos?.roomId === t[1].id, 'intra: position moved to the real Main Street');
  check(T.entryRoomId === t[0].id && store.towns.has(T.id), 'intra: town and entry room kept');
  check(
    t[4].namedLinks['enter portal'] === t[2].id,
    'intra: a named exit into a fused room follows it to the real one'
  );
  check(!selfLinked(T), 'intra: no self-links');
  check(
    [...T.rooms.values()].every((r) => T.grid.get(`${r.x},${r.y},${r.z}`) === r.id) &&
      T.grid.size === T.rooms.size,
    'intra: grid consistent with the surviving rooms'
  );
  // Look-alikes you can WALK between are twins: two word-identical halls
  // (same neighbors in the same directions) joined by a corridor
  const twin = new TownMapStore();
  const W = twin.createTown('Keep');
  const w = build(
    twin,
    W,
    [
      ['Hall', 0, 0, 0, ['e', 'n', 's']],
      ['Shop', 0, -1, 0, ['s']],
      ['Yard', 0, 1, 0, ['n']],
      ['Corridor', 1, 0, 0, ['e', 'w']],
      ['Hall', 2, 0, 0, ['n', 's', 'w']],
      ['Shop', 2, -1, 0, ['s']],
      ['Yard', 2, 1, 0, ['n']],
    ],
    [
      [0, 'n', 1],
      [0, 's', 2],
      [0, 'e', 3],
      [3, 'e', 4],
      [4, 'n', 5],
      [4, 's', 6],
    ]
  );
  check(twin.findMergeCandidate(W, w[4], 2) === null, 'intra: walked-between twins never match');
}

// ---------------------------------------------------------------------------
// 5. Re-anchor: the target never walked Square->Quay, so the walk from the
//    pair stops there; the Quay piece re-anchors on its unique match
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      // reached from the south long ago; Square-Quay was never walked here
      ['Quay', 4, 0, 0, ['e', 'n', 's', 'w']],
      ['Pier', 5, 0, 0, ['w']],
      ['Fishmonger', 4, -1, 0, ['s']],
      ['Rope Walk', 4, 1, 0, ['n']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
      [2, 's', 5],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Quay', 2, 0, 0, ['e', 'n', 's', 'w']],
      ['Pier', 3, 0, 0, ['w']],
      ['Fishmonger', 2, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [2, 'n', 4],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 5 && result.placed === 0,
    `reanchor: all 5 fused (${JSON.stringify(result)})`
  );
  for (const n of ['Gate', 'Square', 'Quay', 'Pier', 'Fishmonger']) {
    check(named(A, n).length === 1, `reanchor: "${n}" not duplicated (${named(A, n).length})`);
  }
  check(
    a[1].links.e === a[2].id && a[2].links.w === a[1].id,
    'reanchor: the fragment taught the target the Square-Quay link'
  );
}

// ---------------------------------------------------------------------------
// 6. No two-into-one collapse: the old pass 1 wrote each copy into the grid
//    while still deciding the rest — a nudged copy landing on a later room's
//    translated cell "fused" that room into it (self-links)
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const T = store.createTown('Target');
  store.addRoom(T, block('Gate', ['n', 's']), 0, 0, 0, 0);
  const hallT = store.addRoom(T, block('Hall', ['n', 's', 'nw']), 5, 5, 0, 0);
  const F = store.createTown('Frag');
  const [hallF] = build(
    store,
    F,
    [
      ['Hall', 0, 0, 0, ['n', 's', 'nw']],
      // a scarred layout: the switchback sits far from the hall it hangs off
      ['Path', -5, -5, 0, ['nw', 'se'], 'A steep switchback path climbs the cliff face here.'],
      ['Path', -6, -6, 0, ['nw', 'se'], 'The steep path doubles back on itself below the glade.'],
    ],
    [
      [0, 'nw', 1],
      [1, 'nw', 2],
    ]
  );
  store.mergeTowns(F, hallF.id, T, hallT.id);
  const paths = named(T, 'Path');
  check(paths.length === 2, `collapse: both Path rooms survive (${paths.length})`);
  check(!selfLinked(T), 'collapse: no self-links');
  const [p1, p2] = paths;
  check(
    !!p1 && !!p2 && hallT.links.nw === p1.id && p1.links.nw === p2.id && p2.links.se === p1.id,
    'collapse: Hall -nw-> Path -nw-> Path rebuilt'
  );
  check(
    !!p1 && !!p2 && p1.x === 4 && p1.y === 4 && p2.x === 3 && p2.y === 3,
    `collapse: copies placed along their own links (${p1?.x},${p1?.y} / ${p2?.x},${p2?.y})`
  );
}

// ---------------------------------------------------------------------------
// 6b. One-to-one: two DIFFERENT fragment rooms never fuse onto one target
//     room, even when two walks reach it (the target joins the corner road
//     to both ends — a non-Euclidean corner the fragment saw as two rooms)
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Lane', 1, 0, 0, ['n', 'w']],
      ['Alley', 0, -1, 0, ['e', 's']],
      ['Corner', 1, -1, 0, ['s', 'w']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [1, 'n', 3],
      [2, 'e', 3],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Lane', 1, 0, 0, ['n', 'w']],
      ['Alley', 0, -1, 0, ['e', 's']],
      // look-alikes: same opening, they differ only further in
      [
        'Corner',
        1,
        -1,
        0,
        ['s', 'w'],
        'This is a bend in the road where two ways meet.  The lane turns north here.',
      ],
      [
        'Corner',
        3,
        -3,
        0,
        ['s', 'w'],
        'This is a bend in the road where two ways meet.  The alley turns east here.',
      ],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [1, 'n', 3],
      [2, 'e', 4],
    ]
  );
  a[3].desc = b[3].desc; // the target's corner reads like the lane's
  a[3].descFirst = b[3].descFirst;
  store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    named(A, 'Corner').length === 2 && !selfLinked(A),
    `one-to-one: both fragment corners survive (${named(A, 'Corner').length})`
  );
}

// ---------------------------------------------------------------------------
// 6c. Identity per step: a desync scar inside a clone plaza (every Market
//     opens with the same sentence) pairs the north edge with a corner;
//     their exits disagree, so the edge is NOT fused onto the corner
// ---------------------------------------------------------------------------
{
  const market = (where: string) =>
    `This is a spacious market square in the heart of Eris.  This appears to be the ${where} of the market.  It is bright.`;
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  const a = build(
    store,
    A,
    [
      ['Market', 0, 0, 0, ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'], market('center')],
      ['Market', 1, -1, 0, ['s', 'sw', 'w'], market('northeastern corner')],
    ],
    [[0, 'n', 1]] // scar: the center's north exit leads to the north EDGE
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Market', 0, 0, 0, ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'], market('center')],
      ['Market', 0, -1, 0, ['e', 's', 'se', 'sw', 'w'], market('northern edge')],
      ['Market', 1, -1, 0, ['s', 'sw', 'w'], market('northeastern corner')],
    ],
    [
      [0, 'n', 1],
      [1, 'e', 2],
    ]
  );
  const cornerExits = [...a[1].exitsEver].sort().join(',');
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(!!result, 'plaza: the merge itself goes ahead');
  check(
    [...a[1].exitsEver].sort().join(',') === cornerExits && a[1].visits === 1,
    `plaza: the north edge was not fused onto the corner (corner exits ${a[1].exitsEver})`
  );
}

// ---------------------------------------------------------------------------
// 6d. Same relative floor: a cross-floor scar (a lateral link whose ends sit
//     on different floors) never pairs rooms
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Keep');
  const a = build(
    store,
    A,
    [
      ['Landing', 0, 0, 0, ['n', 's']],
      ['Bedchamber', 0, -1, 0, ['s']],
      ['Hall', 0, 1, 0, ['n']],
    ],
    [
      [0, 'n', 1],
      [0, 's', 2],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Landing', 0, 0, 0, ['n', 's']],
      ['Bedchamber', 0, -1, 1, ['s']], // one floor up: a scar, not this landing's room
      ['Hall', 0, 1, 0, ['n']],
    ],
    [
      [0, 'n', 1],
      [0, 's', 2],
    ]
  );
  store.mergeTowns(B, b[0].id, A, a[0].id);
  check(a[1].visits === 1, "floor: the other floor's Bedchamber is not fused across floors");
}

// ---------------------------------------------------------------------------
// 6e. A link its own exits lines disprove (a queue-desync scar: the square
//     never lists "north") is no evidence: it neither pairs rooms nor
//     contradicts the merge
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'n', 'w']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
      ['Gate', -1, 0, 0, ['e']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [0, 'w', 3],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Square', 0, 0, 0, ['e', 'w']],
      ['Market', 1, 0, 0, ['w']],
      ['Smithy', 0, -1, 0, ['s']],
      ['Gate', -1, 0, 0, ['e']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2], // scar: this square's exits never list north
      [0, 'w', 3],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    !!result && result.fused === 3,
    `scar: a disproved link blocks nothing (${JSON.stringify(result)})`
  );
}

// ---------------------------------------------------------------------------
// 6g. Exits are compared as the union of every sighting: a target room whose
//     union an earlier wrong fusion polluted (the OOC corridor: a "west"
//     its true room never lists) is not fused, even when the latest exits
//     lines agree — the walk stays out of the scrambled links behind it
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('OOC');
  const a = build(
    store,
    A,
    [
      ['Hall', 0, 0, 0, ['n', 's']],
      ['Corridor', 0, -1, 0, ['e', 'n', 's']],
    ],
    [[0, 'n', 1]]
  );
  a[1].exitsEver.push('w'); // polluted
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Hall', 0, 0, 0, ['n', 's']],
      ['Corridor', 0, -1, 0, ['e', 'n', 's']],
    ],
    [[0, 'n', 1]]
  );
  store.mergeTowns(B, b[0].id, A, a[0].id);
  check(a[1].visits === 1, 'exits: a polluted exits union is not fused onto');
}

// ---------------------------------------------------------------------------
// 6f. A re-anchor whose walk runs into a contradiction is rolled back (the
//     piece is copied); only that walk is dropped, the merge goes ahead
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Quay', 4, 0, 0, ['e', 'n', 'w']],
      ['Pier', 5, 0, 0, ['e', 'w']],
      ['Fishmonger', 4, -1, 0, ['s']],
      ['Lighthouse', 6, 0, 0, ['w']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
      [3, 'e', 5],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Quay', 2, 0, 0, ['e', 'n', 'w']],
      ['Pier', 3, 0, 0, ['e', 'w']],
      ['Tavern', 4, 0, 0, ['w']],
      ['Fishmonger', 2, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [3, 'e', 4],
      [2, 'n', 5],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2,
    `reanchor rollback: only Gate + Square fused (${JSON.stringify(result)})`
  );
  check(
    a[2].visits === 1 && a[3].visits === 1 && a[4].visits === 1,
    'reanchor rollback: the contradicted walk left Quay, Pier and Fishmonger untouched'
  );
}

// ---------------------------------------------------------------------------
// 7. Adjacent Garrison Road twins (real Eris texts: same name, exits and
//    opening — only the second sentence differs) never cross-fuse
// ---------------------------------------------------------------------------
{
  const GR_WEST =
    'This is a coblestone paved road along the northern edge of the burgeoning town growing on the shore of the Sea of Eris.  The road leads west towards the intersection with Ash Street and east towards a fortification on a spit of land jutting out into the water.  It is bright.';
  const GR_EAST =
    'This is a coblestone paved road along the northern edge of the burgeoning town growing on the shore of the Sea of Eris.  The road leads west towards an intersection in the distance and to the east is a fortification on a spit of land jutting out into the water.  It is bright.';
  const garrison = (store: TownMapStore, town: Town, xs: number[]) =>
    build(
      store,
      town,
      [
        ['Intersection of Garrison Road and Ash Street', xs[0], 0, 0, ['e', 's']],
        ['Garrison Road', xs[1], 0, 0, ['e', 'w'], GR_WEST],
        ['Garrison Road', xs[2], 0, 0, ['e', 'w'], GR_EAST],
        ['Garrison Plaza', xs[3], 0, 0, ['e', 'w']],
        ['Gatehouse', xs[4], 0, 0, ['e', 'n', 's', 'w']],
      ],
      [
        [0, 'e', 1],
        [1, 'e', 2],
        [2, 'e', 3],
        [3, 'e', 4],
      ]
    );
  // (a) The fragment's layout is stretched between the plaza and the east
  // segment: its east segment translates onto the target's WEST one.
  {
    const store = new TownMapStore();
    const A = store.createTown('Eris');
    const a = garrison(store, A, [0, 1, 2, 3, 4]);
    const B = store.createTown('Fragment');
    const b = garrison(store, B, [-5, -4, -3, -1, 0]);
    b[1].visits = 20; // fragment's west segment
    b[2].visits = 10; // fragment's east segment
    const result = store.mergeTowns(B, b[4].id, A, a[4].id);
    check(result?.fused === 5, `twins: all 5 fused in lockstep (${JSON.stringify(result)})`);
    check(named(A, 'Garrison Road').length === 2, 'twins: still exactly two Garrison Roads');
    check(
      a[1].visits === 21 && a[2].visits === 11,
      `twins: west fused with west, east with east (visits ${a[1].visits}/${a[2].visits})`
    );
    check(
      named(A, 'Intersection of Garrison Road and Ash Street').length === 1,
      'twins: no copies'
    );
  }
  // (b) A desync scar in the target (the intersection's east link skips the
  // west segment): walking from the intersection pairs the west fragment
  // segment with the EAST target one — the next step contradicts (its west
  // neighbor is the intersection on one side, a road on the other), so the
  // merge is refused and nothing changes.
  {
    const store = new TownMapStore();
    const A = store.createTown('Eris');
    const a = garrison(store, A, [0, 1, 2, 3, 4]);
    a[0].links.e = a[2].id; // scar
    const B = store.createTown('Fragment');
    const b = garrison(store, B, [0, 1, 2, 3, 4]);
    const before = JSON.stringify(store.serialize());
    const result = store.mergeTowns(B, b[0].id, A, a[0].id);
    check(result === null, 'twins: a scar-paired twin refuses the merge');
    check(JSON.stringify(store.serialize()) === before, 'twins: a refused merge changes nothing');
  }
}

if (failed > 0) {
  console.error(`${failed} merge assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: merges align by link graph, move only the matched component, keep floors');
