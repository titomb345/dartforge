/**
 * Regression test: diagonal single-stretch placement.
 * A diagonal arrival (ne/nw/se/sw) whose hint cell is occupied by a
 * DIFFERENT room must stretch the map along ONE component axis — a single
 * half-plane shift already frees the cell — so the new room lands exactly
 * at its diagonal cell and the from-room stays put. The axis is chosen
 * perpendicular to the occupant's own linked run, so the occupant's street
 * moves as one piece. (Previously diagonals stretched BOTH component axes,
 * spreading the map an extra cell in each direction on every collision;
 * before that they nudged to the nearest free cell, scattering them.)
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

const PLAZA = block('Plaza', 'north, east, and northeast', 'The town plaza.');
const NORTH_ST = block('North Street', 'south', 'A street heading north.');
const EAST_ST = block('East Street', 'north and west', 'A street heading east.');
const CORNER = block('Corner', 'south', 'A tight corner.');
const GARDEN = block('Garden', 'southwest', 'A walled garden.');

// Fill the grid around the plaza: north (0,-1), east (1,0), and the cell
// northeast of the plaza (1,-1) via e,n — the diagonal's natural cell.
step(null, PLAZA);
const plaza = map.pos!.roomId;
step('n', NORTH_ST);
const northSt = map.pos!.roomId;
step('s', PLAZA);
step('e', EAST_ST);
const eastSt = map.pos!.roomId;
step('n', CORNER);
const corner = map.pos!.roomId;
step('s', EAST_ST);
step('w', PLAZA);

// The ne arrival's hint cell (1,-1) is occupied by Corner (a different
// room). Corner's only link is south to East Street (a vertical run), so
// the map must stretch the HORIZONTAL component only: Corner's whole
// column shifts east as one piece and Garden lands exactly at the hint.
step('ne', GARDEN);
const garden = map.pos!.roomId;

const town = map.get(map.pos!.townId)!;
const r = (id: number) => town.rooms.get(id)!;
let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

// The new room sits at the EXACT diagonal cell (one ne of the plaza)
check(
  r(garden).x === r(plaza).x + 1 && r(garden).y === r(plaza).y - 1,
  `garden at (${r(garden).x},${r(garden).y}), expected exactly ne of plaza (${r(plaza).x + 1},${r(plaza).y - 1})`
);
// The from-room never moves
check(r(plaza).x === 0 && r(plaza).y === 0, `plaza moved to (${r(plaza).x},${r(plaza).y})`);
// The occupant shifted once along the HORIZONTAL axis only (its own run
// is vertical) — same row as garden, one east, still atop East Street
check(
  r(corner).x === r(garden).x + 1 && r(corner).y === r(garden).y,
  `corner at (${r(corner).x},${r(corner).y}), expected one east of garden (${r(garden).x + 1},${r(garden).y})`
);
check(
  r(corner).x === r(eastSt).x && r(corner).y === r(eastSt).y - 1,
  'corner no longer directly north of east street (its column was split)'
);
// The perpendicular axis is untouched: north street never moves
check(
  r(northSt).x === r(plaza).x && r(northSt).y === r(plaza).y - 1,
  `north street at (${r(northSt).x},${r(northSt).y}), expected untouched at (${r(plaza).x},${r(plaza).y - 1})`
);
// Cardinal neighbors stay on their axes (stretched, not bent)
check(
  r(eastSt).y === r(plaza).y && r(eastSt).x > r(plaza).x,
  'east street no longer directly east of the plaza'
);
// ONE stretch, not two, and no nudge
check(map.stretches === 1, `stretches=${map.stretches}, expected 1`);
check(map.nudges === 0, `nudges=${map.nudges}, expected 0`);
// No two rooms share a cell
const cells = new Set([...town.rooms.values()].map((rm) => `${rm.x},${rm.y},${rm.z}`));
check(cells.size === town.rooms.size, 'two rooms share a grid cell');

if (fail) process.exit(1);
console.log('PASS — diagonal collision stretched one axis; the room sits at its diagonal cell');
