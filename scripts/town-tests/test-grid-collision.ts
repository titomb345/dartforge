/**
 * Regression test: non-Euclidean grid collisions (Eris ferry/abbey case).
 * Two routes with the same net displacement end in DIFFERENT rooms — the
 * mapper must keep them separate (nudged), even when names+exits match,
 * because you can't arrive going north into a room with no south exit.
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
const ABBEY = block('Abbey', 'south', 'The quiet abbey grounds.');

// Route A: e, e → Ferry Landing at net (+2, 0)
step(null, CENTER);
step('e', ROAD_EW);
const roadA = map.pos!.roomId;
step('e', FERRY);

// Walk back to center via links
step('w', ROAD_EW);
step('w', CENTER);

// Route B: s, e, n — its 'n' target collides with roadA's cell (1,0).
// The block is ALSO "Road [e,w]" (same name, same exits) but arriving
// northbound needs a south exit, which [e,w] lacks → must be a new room.
step('s', SOUTH_ROAD);
step('e', LANE);
const lane = map.pos!.roomId;
const resB = step('n', ROAD_EW);
const roadB = map.pos!.roomId;

// Route C: from the lane, e then n collides with Ferry Landing's cell —
// different name entirely → new room, nudged.
step('s', LANE);
step('e', LANE); // second lane segment at (2,1)
step('n', ABBEY);
const abbey = map.pos!.roomId;

const town = map.get(map.pos!.townId)!;
console.log(`\nRooms: ${town.rooms.size} (expected 8)`);
let fail = false;
if (roadB === roadA) {
  console.error('FAIL: northbound arrival merged into the east-west road (no south exit!)');
  fail = true;
}
if (resB.kind !== 'new-room') {
  console.error(`FAIL: collision arrival resolved as ${resB.kind}, expected new-room`);
  fail = true;
}
const laneRoom = town.rooms.get(lane)!;
if (laneRoom.links.n !== roadB) {
  console.error('FAIL: lane north link points at the wrong road');
  fail = true;
}
if (
  [...town.rooms.values()].filter((r) => r.name === 'Abbey').length !== 1 ||
  abbey === undefined
) {
  console.error('FAIL: abbey missing');
  fail = true;
}
// Walk back down from the abbey — must return to the second lane, not ferry
const back = step('s', LANE);
if (back.kind !== 'expected') {
  console.error(`FAIL: abbey return walk resolved as ${back.kind}`);
  fail = true;
}
if (fail) process.exit(1);
console.log('PASS — colliding routes stay separate rooms and walks resolve through links');
