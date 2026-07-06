/**
 * Regression test: relayoutTown is deterministic and idempotent. Re-embedding
 * a town from its link graph twice must produce identical coordinates, even
 * with a non-Euclidean loop (stretch on conflict), a diagonal-only room, and
 * a named-link-only room in the mix.
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
  return loc.onRoomBlock(b, '0:0,0', (t += 1000));
};

// A five-room loop that does not close geometrically: walking s from the
// Loft lands where the Square sits → stretch. Then a diagonal shortcut and
// a boat reachable only through a named link.
step(null, block('Gate', 'north', 'The town gate.'));
step('n', block('Square', 'north, east, and south', 'The market square.'));
step('e', block('Alley', 'west and north', 'A cramped alley.'));
step('n', block('Yard', 'south and west', 'A walled yard.'));
step('w', block('Loft', 'east and south', 'A dusty loft.'));
step('s', block('Cellar', 'north and southwest', 'A cool cellar.'));
step('sw', block('Nook', 'northeast', 'A hidden nook.'));
step('enter boat', block('Boat', 'out', 'A small boat.'));

const townId = map.pos!.townId;
const town = map.get(townId)!;

const snapshot = () =>
  [...town.rooms.values()]
    .map((r) => `${r.id}:(${r.x},${r.y},${r.z})`)
    .sort()
    .join(' ');

map.relayoutTown(town);
const first = snapshot();
map.relayoutTown(town);
const second = snapshot();

let fail = false;
if (town.rooms.size !== 8) {
  console.error(`FAIL: expected 8 rooms, got ${town.rooms.size}`);
  fail = true;
}
if (first !== second) {
  console.error(`FAIL: relayout not idempotent\n  1st: ${first}\n  2nd: ${second}`);
  fail = true;
}
const cells = new Set([...town.rooms.values()].map((r) => `${r.x},${r.y},${r.z}`));
if (cells.size !== town.rooms.size) {
  console.error('FAIL: relayout left two rooms on one cell');
  fail = true;
}
// Grid index must agree with room coords after relayout
for (const [key, id] of town.grid) {
  const r = town.rooms.get(id)!;
  if (key !== `${r.x},${r.y},${r.z}`) {
    console.error(`FAIL: grid key ${key} points at room#${id} at (${r.x},${r.y},${r.z})`);
    fail = true;
  }
}
if (town.grid.size !== town.rooms.size) {
  console.error(`FAIL: grid has ${town.grid.size} entries for ${town.rooms.size} rooms`);
  fail = true;
}

if (fail) process.exit(1);
console.log(`PASS — relayout idempotent over ${town.rooms.size} rooms (${first})`);
