/**
 * Regression test: mirror-symmetric building wings (Eris rangers' keep,
 * third floor). Two identical Vestibules flank the Landing, each with
 * Bedchambers that share names/descs/exits with the other wing's.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const block = (name: string, exitsSentence: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are exits: ${exitsSentence}.`),
});

// Identical fingerprints across wings (as in the real keep)
const VEST = (side: string) =>
  block(
    'Vestibule',
    'south, an open oak door leading west, an open oak door leading north, and a closed oak door leading east',
    `This is a small vestibule leading to the bedrooms on the ${side} side of this floor.`
  );
const LANDING = block(
  'Landing',
  'down, up, north, south, and a closed oak door leading west',
  'This is a landing on the third floor of the keep.'
);
const BED = block(
  'Bedchamber',
  'an open oak door leading east',
  'This is a bedchamber on an upper floor of the keep where one of the senior rangers may rest.'
);

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

// Map the NORTH wing: Landing → n → Vestibule(N) → w → Bedchamber(NW) → e → back
step(null, LANDING);
step('n', VEST('north'));
step('w', BED); // north wing's west bedchamber [exit e]
const bedNW = map.pos!.roomId;
step('e', VEST('north'));
step('s', LANDING);

// Now the SOUTH wing — same fingerprints everywhere
step('s', VEST('south'));
const vestS = map.pos!.roomId;
step('w', BED); // south wing's west bedchamber — MUST be a new room!
const bedSW = map.pos!.roomId;
step('e', VEST('south'));
const backTo = map.pos!.roomId;

const town = map.get(map.pos!.townId)!;
console.log(`\nRooms: ${town.rooms.size} (expected 6: Landing, 2 Vestibules, 2 Bedchambers... +?)`);
const beds = [...town.rooms.values()].filter((r) => r.name === 'Bedchamber');
const vests = [...town.rooms.values()].filter((r) => r.name === 'Vestibule');
console.log(`Bedchambers: ${beds.length} (expected 2), Vestibules: ${vests.length} (expected 2)`);
if (bedSW === bedNW) {
  console.error('FAIL: south-wing bedchamber merged into the north-wing one');
  process.exit(1);
}
if (backTo !== vestS) {
  console.error(
    `FAIL: stepping e from south bedchamber landed in room#${backTo}, expected the SOUTH vestibule #${vestS}`
  );
  process.exit(1);
}
if (beds.length !== 2 || vests.length !== 2) {
  console.error('FAIL: wrong room counts');
  process.exit(1);
}
console.log('PASS — twin wings map as separate rooms and walks stay in the right wing');
