/** Regression test: switchback trail with duplicate fingerprints (Cove → Inner Causeway). */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `${name} description that is long enough to matter here.`,
  desc: `${name} description.`,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});

let t = 1000;
const step = (cmd: string | null, b: TownRoomBlock) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? 'enter').padEnd(6)} → [${res.kind.padEnd(10)}] room#${room?.id} "${room?.name}" at(${room?.x},${room?.y},${room?.z})`
  );
};

// The exact walk from the live session: up → n → se → n → se → s
step(null, block('Cove', 'up and south'));
step('u', block('Path', 'down and north'));
step('n', block('Path', 'south and southeast'));
step('se', block('Path', 'northwest and north'));
step('n', block('Path', 'south and southeast')); // same fingerprint as room#2!
step('se', block('Causeway', 'northwest and south'));
step('s', block('Inner Causeway', 'north and south'));

const town = map.get(map.pos!.townId)!;
console.log(`\nRooms mapped: ${town.rooms.size} (expected 7)`);
const paths = [...town.rooms.values()].filter((r) => r.name === 'Path');
console.log(`"Path" rooms: ${paths.length} (expected 4)`);
if (town.rooms.size !== 7) {
  console.error('FAIL: switchback rooms were wrongly merged or duplicated');
  process.exit(1);
}
// Walk back down must also resolve cleanly
step('n', block('Causeway', 'northwest and south'));
step('nw', block('Path', 'south and southeast'));
step('s', block('Path', 'northwest and north')); // reverse of the 'n' link... via links
console.log(`\nRooms after walking back: ${town.rooms.size} (expected 7)`);
if (town.rooms.size !== 7) {
  console.error('FAIL: return walk duplicated rooms');
  process.exit(1);
}
console.log('PASS');
