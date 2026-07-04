/**
 * Regression test: stretch-on-collision placement (Eris ferry/abbey case).
 * When a cardinal move's natural cell is occupied by a different room, the
 * map must STRETCH — the occupant's half-plane shifts one cell along the
 * movement axis — so the new room lands exactly where the move says.
 * Straight streets stay straight; nothing is nudged to an arbitrary cell.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

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
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? 'enter').padEnd(5)} → [${res.kind.padEnd(9)}] room#${room?.id} "${room?.name}" at(${room?.x},${room?.y},${room?.z})`
  );
  return res;
};

const CENTER = block('Center Square', 'north, east, south, and west', 'The center of town.');
const ROAD_EW = block('Road', 'east and west', 'A cobblestone road running east to west.');
const FERRY = block('Ferry Landing', 'west', 'A landing at the river ferry.');
const SOUTH_ROAD = block('South Road', 'north and east', 'The south road bends east.');
const LANE = block('Lane', 'north, east, and west', 'A narrow lane.');

// Route A: e, e → Ferry Landing at net (+2, 0)
step(null, CENTER);
const center = map.pos!.roomId;
step('e', ROAD_EW);
const roadA = map.pos!.roomId;
step('e', FERRY);
const ferry = map.pos!.roomId;
step('w', ROAD_EW);
step('w', CENTER);

// Route B: s, e, n — the 'n' target collides with roadA's cell. Arriving
// northbound needs a south exit, which roadA lacks → new room. The map
// must stretch: roadA's row shifts north; roadB lands at the exact cell.
step('s', SOUTH_ROAD);
const southRoad = map.pos!.roomId;
step('e', LANE);
const lane = map.pos!.roomId;
step('n', ROAD_EW);
const roadB = map.pos!.roomId;

const town = map.get(map.pos!.townId)!;
const r = (id: number) => town.rooms.get(id)!;
let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

// The new room sits at the EXACT natural cell (one north of the lane)
check(
  r(roadB).x === r(lane).x && r(roadB).y === r(lane).y - 1,
  `roadB at (${r(roadB).x},${r(roadB).y}), expected exactly one cell north of lane (${r(lane).x},${r(lane).y - 1})`
);
// The occupant's whole row shifted north by exactly one; the from-room stayed
check(r(roadA).y === r(roadB).y - 1, 'roadA did not shift exactly one cell north of roadB');
check(r(center).y === r(roadA).y && r(ferry).y === r(roadA).y, 'roadA row lost alignment');
check(r(lane).x === 1 && r(lane).y === 1, `lane moved to (${r(lane).x},${r(lane).y})`);
// Route A's street is still straight and ordered west→east
check(r(center).x < r(roadA).x && r(roadA).x < r(ferry).x, 'route A street lost west→east order');
// Stretch, not nudge
check(map.stretches === 1, `stretches=${map.stretches}, expected 1`);
check(map.nudges === 0, `nudges=${map.nudges}, expected 0`);
// Axis monotonicity: north of means above
check(r(center).y < r(southRoad).y, 'center no longer north of south road');
// No two rooms share a cell
const cells = new Set([...town.rooms.values()].map((rm) => `${rm.x},${rm.y},${rm.z}`));
check(cells.size === town.rooms.size, 'two rooms share a grid cell');

if (fail) process.exit(1);
console.log('PASS — collision stretched the map; the new room sits at its true cell');
