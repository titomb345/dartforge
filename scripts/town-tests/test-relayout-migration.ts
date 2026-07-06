/**
 * Regression test: pre-v2 saves are re-laid-out once on load. A v1 blob
 * with a fully grid-consistent 3x3 street grid but nudge-scarred (and even
 * overlapping) stored coordinates must come out of deserialize with every
 * cardinal link exactly grid-adjacent and no two rooms sharing a cell.
 * v2 blobs must load verbatim — no perpetual re-layout.
 */
import { TownMapStore } from '../../src/lib/townMap';
import type { TownDir } from '../../src/lib/townParser';

// True layout (ids):        Stored (scarred) coords:
//   0 1 2                     0 at (0,0), 4 nudged to (5,5),
//   3 4 5                     8 OVERLAPS 7, others offset randomly
//   6 7 8
const trueXY: Record<number, [number, number]> = {
  0: [0, 0],
  1: [1, 0],
  2: [2, 0],
  3: [0, 1],
  4: [1, 1],
  5: [2, 1],
  6: [0, 2],
  7: [1, 2],
  8: [2, 2],
};
const scarredXY: Record<number, [number, number]> = {
  0: [0, 0],
  1: [1, 0],
  2: [3, 0],
  3: [0, 1],
  4: [5, 5],
  5: [2, 1],
  6: [-2, 3],
  7: [1, 2],
  8: [1, 2], // overlaps room 7 — the old last-write-wins hazard
};

const links = (id: number): Partial<Record<TownDir, number>> => {
  const [x, y] = trueXY[id];
  const out: Partial<Record<TownDir, number>> = {};
  for (const [nid, [nx, ny]] of Object.entries(trueXY)) {
    if (nx === x + 1 && ny === y) out.e = Number(nid);
    if (nx === x - 1 && ny === y) out.w = Number(nid);
    if (nx === x && ny === y - 1) out.n = Number(nid);
    if (nx === x && ny === y + 1) out.s = Number(nid);
  }
  return out;
};

const mkRoom = (id: number) => ({
  id,
  name: `Street ${id}`,
  descFirst: `Street segment ${id}.`,
  desc: `Street segment ${id}.`,
  x: scarredXY[id][0],
  y: scarredXY[id][1],
  z: 0,
  exits: Object.keys(links(id)) as TownDir[],
  exitsEver: Object.keys(links(id)) as TownDir[],
  doorDirs: [] as TownDir[],
  namedExits: [] as string[],
  portal: false,
  links: links(id),
  namedLinks: {},
  visits: 1,
  lastSeen: 1000,
  notes: '',
});

const v1 = {
  v: 1,
  nextTownId: 1,
  pos: null,
  towns: [
    {
      id: 0,
      name: 'Gridville',
      anchors: {},
      nextRoomId: 9,
      entryRoomId: 0,
      rooms: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(mkRoom),
    },
  ],
};

const store = TownMapStore.deserialize(JSON.parse(JSON.stringify(v1)));
const town = store.towns.get(0)!;

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

check(town.rooms.size === 9, `expected 9 rooms, got ${town.rooms.size}`);
const cells = new Set([...town.rooms.values()].map((r) => `${r.x},${r.y},${r.z}`));
check(cells.size === 9, 'two rooms still share a cell after migration');

// Every cardinal link must be exactly grid-adjacent (the graph is consistent)
const VEC: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
for (const room of town.rooms.values()) {
  for (const [dir, destId] of Object.entries(room.links)) {
    const dest = town.rooms.get(destId as number)!;
    const [vx, vy] = VEC[dir];
    check(
      dest.x === room.x + vx && dest.y === room.y + vy,
      `link ${room.id} -${dir}-> ${dest.id} not grid-adjacent: (${room.x},${room.y}) vs (${dest.x},${dest.y})`
    );
  }
}
// Grid index rebuilt consistently
check(town.grid.size === 9, `grid has ${town.grid.size} entries`);
for (const [key, id] of town.grid) {
  const r = town.rooms.get(id)!;
  check(key === `${r.x},${r.y},${r.z}`, `grid key ${key} stale for room#${id}`);
}

// v2 blobs load VERBATIM: plant a deliberately scarred coordinate in a v2
// blob and confirm deserialize leaves it alone.
const v2 = JSON.parse(JSON.stringify(store.serialize())) as {
  v: number;
  towns: Array<{ rooms: Array<{ id: number; x: number; y: number }> }>;
};
check(v2.v === 2, `serialize wrote v=${v2.v}, expected 2`);
const planted = v2.towns[0].rooms.find((r) => r.id === 4)!;
planted.x = 9;
planted.y = 9;
const store2 = TownMapStore.deserialize(v2);
const room4 = store2.towns.get(0)!.rooms.get(4)!;
check(
  room4.x === 9 && room4.y === 9,
  `v2 load moved room 4 to (${room4.x},${room4.y}) — v2 must load verbatim`
);

if (fail) process.exit(1);
console.log('PASS — v1 saves heal on load; v2 saves load verbatim');
