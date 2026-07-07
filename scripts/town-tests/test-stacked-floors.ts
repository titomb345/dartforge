/**
 * Regression test: mirror-identical STACKED floors (Eris rangers' keep,
 * reported live July 2026). The 2F and 3F bedroom wings are vertical
 * copies: same room names, same exits, vestibules with word-identical
 * prose. Entering the 2F Bedchamber (n from its Vestibule) used to reuse
 * the 3F Bedchamber directly ABOVE it — findMatchesNear tolerates dz=1,
 * the rooms strict-match, and the 3F room's own Vestibule mirrors ours so
 * the reciprocity guard passed. The single-candidate reuse branch never
 * consulted descriptions, so even the bedchambers' genuinely different
 * prose ("one of the senior rangers... a bed" vs "a pair of rangers...
 * two beds") could not save it. Whichever floor was mapped first captured
 * every bedroom.
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

// The vestibules are word-identical across floors ("this floor")
const VEST = block(
  'Vestibule',
  'south, an open oak door leading north, an open oak door leading east, and an open oak door leading west',
  'This is a small vestibule leading to the bedrooms on the north side of this floor.  It is dimly lit.'
);
const LANDING3 = block(
  'Landing',
  'down, up, north, south, and a closed oak door leading west',
  'This is a landing on the third floor of the keep.  A spiral staircase winds up and down from this floor and archways lead off to the north and south.'
);
const DAYROOM = block(
  'Day Room',
  'down, up, north, and south',
  'This is a comfortable sitting room on the second floor of the keep where the rangers can come and relax between their duties and training.'
);
// The real bedchamber texts Bill pasted — identical fingerprint (name +
// lone south exit), different prose.
const BED3 = block(
  'Bedchamber',
  'an open oak door leading south',
  'This is a bedchamber on an upper floor of the keep where one of the senior rangers may rest and store his or her gear.  Daylight streams in through a window on the north wall.  The room is furnished with a bed with a large chest pushed up against the foot it.  A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  It is shadowy.'
);
const BED2 = block(
  'Bedchamber',
  'an open oak door leading south',
  'This is a bedchamber on the second floor of the keep where a pair of rangers may rest and store their gear.  Daylight streams in through a window on the north wall.  The room is furnished with two beds with a large chest pushed up against the foot of each bed.  A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  It is shadowy.'
);

let t = 1000;
const step = (cmd: string | null, b: TownRoomBlock) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? 'enter').padEnd(5)} → [${res.kind.padEnd(11)}] room#${room?.id} "${room?.name}" at(${room?.x},${room?.y},${room?.z})`
  );
  return res;
};

// Map the THIRD floor wing first
step(null, LANDING3);
step('n', VEST);
step('n', BED3);
const bed3 = map.pos!.roomId;
step('s', VEST);
const vest3 = map.pos!.roomId;
step('s', LANDING3);

// Down to the second floor — the mirror wing directly below
step('d', DAYROOM);
const dayRoom = map.room(map.pos)!;
step('n', VEST); // word-identical vestibule one floor below the 3F one
const vest2 = map.pos!.roomId;
step('n', BED2); // MUST be a new room on 2F, not the 3F bedchamber above
const bed2 = map.pos!.roomId;
const bed2Room = map.room(map.pos)!;
step('s', VEST);
const backTo = map.pos!.roomId;

const town = map.get(map.pos!.townId)!;
const beds = [...town.rooms.values()].filter((r) => r.name === 'Bedchamber');
const vests = [...town.rooms.values()].filter((r) => r.name === 'Vestibule');
console.log(`\nBedchambers: ${beds.length} (expected 2), Vestibules: ${vests.length} (expected 2)`);

if (bed2 === bed3) {
  console.error('FAIL: 2F bedchamber merged into the 3F one directly above it');
  process.exit(1);
}
if (vest2 === vest3) {
  console.error('FAIL: 2F vestibule merged into the 3F one directly above it');
  process.exit(1);
}
if (bed2Room.z !== dayRoom.z) {
  console.error(
    `FAIL: 2F bedchamber landed on z=${bed2Room.z}, expected the 2F floor z=${dayRoom.z}`
  );
  process.exit(1);
}
if (backTo !== vest2) {
  console.error(
    `FAIL: stepping s from the 2F bedchamber landed in room#${backTo}, expected the 2F vestibule #${vest2}`
  );
  process.exit(1);
}
if (beds.length !== 2 || vests.length !== 2) {
  console.error('FAIL: wrong room counts');
  process.exit(1);
}
// --- Save-file healing: maps scarred by the old bug carry cross-floor
// lateral links (a 2F room's n pointing at the 3F bedchamber). The load
// cleanse must sever them — a lateral move can never change floors.
const vest2Room = town.rooms.get(vest2)!;
vest2Room.links.n = bed3; // inject the scar the old code used to create
const healed = TownMapStore.deserialize(map.serialize());
const healedVest2 = healed.get(town.id)!.rooms.get(vest2)!;
if (healedVest2.links.n !== undefined) {
  console.error('FAIL: load cleanse kept a cross-floor lateral link');
  process.exit(1);
}
// ... while legitimate links survive
if (healedVest2.links.s === undefined) {
  console.error('FAIL: load cleanse cut a legitimate same-floor link');
  process.exit(1);
}
const healedDayRoom = healed.get(town.id)!.rooms.get(dayRoom.id)!;
if (healedDayRoom.links.u === undefined) {
  console.error('FAIL: load cleanse cut a legitimate stair link');
  process.exit(1);
}

console.log('PASS — stacked mirror floors map as separate rooms on their own z');
