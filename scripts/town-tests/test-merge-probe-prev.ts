/**
 * Regression test: the merge probe also checks the room just LEFT.
 *
 * Logging in on a word-identical twin room (the keep's east bedchambers —
 * one per wing, same text) makes the global entry match ambiguous, so a
 * fragment town is born; the structural probe fuses it back once a probed
 * room has two links matching the real town. It only probed the CURRENT
 * room — and walking straight through new rooms, the current room only
 * ever holds its one back-link. The corpus fragment of 2026-07-31 walked
 * Bill's whole keep-to-market route (19 rooms, about 13 hours of play)
 * showing a separate "Bedchamber" town before a revisit finally fused it.
 * The previous room has just gained its second link: probing it too fuses
 * the fragment on the second step. The current room stays the first probe
 * (an arrival whose own links match fuses at once). Real keep texts (3F,
 * both wings).
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else console.log(`ok   ${msg}`);
};
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 80),
  desc,
  exits: parseTownExits(exits),
});

const LANDING = block(
  'Landing',
  'There are five exits: down, up, north, south, and a closed oak door leading west.',
  'This is a landing on the third floor of the keep.  A spiral staircase winds up and down from this floor and archways lead off to the north and south.  A pair of wrought iron cressets flank a door to the west, providing a warm illumination.  It is bright.'
);
const VEST_S = block(
  'Vestibule',
  'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and a closed oak door leading east.',
  'This is a small vestibule leading to the bedrooms on the south side of this floor.  Doors open onto bedrooms on the south, east and west side and an open archway leads towards the landing to the north.  Wrought-iron cressets mounted on the walls on either side of the archway shed a warm illumination.  It is bright.'
);
const VEST_N = block(
  'Vestibule',
  'There are four exits: south, a closed oak door leading west, a closed oak door leading north, and a closed oak door leading east.',
  'This is a small vestibule leading to the bedrooms on the north side of this floor.  Doors open onto bedrooms on the north, east and west side and an open archway leads towards the landing to the south.  Wrought-iron cressets mounted on the walls on either side of the archway shed a warm illumination.  It is bright.'
);
// The two east bedchambers (one per wing) are word-identical
const BED_EAST = block(
  'Bedchamber',
  'There is one obvious exit: a closed oak door leading west.',
  'This is a bedchamber on an upper floor of the keep where one of the senior rangers may rest and store his or her gear.  Daylight streams in through a window on the east wall.  The room is furnished with a bed with a large chest pushed up against the foot it.  A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  It is shadowy.'
);
const DAY_ROOM = block(
  'Day Room',
  'There are four exits: down, up, north, and south.',
  'This is a comfortable sitting room on the second floor of the keep where the rangers can come and relax between their duties and training.  Daylight streams in through a window on the west wall.  The floor is covered by a soft, red wool rug and the walls are hung with various weapons and shields.  In one corner is a large fireplace but it remains unlit.  The room is furnished with a pair of oak settles and a small table.  At the east end of the room is a spiral stone staircase which goes up and down to the other floors of the keep.  It is bright.'
);

const map = new TownMapStore();
const loc = new TownLocalizer(map);
let t = 1000;
const go = (cmd: string | null, b: TownRoomBlock) => {
  if (cmd) loc.trackCommand(cmd, (t += 100));
  return loc.onRoomBlock(b, null, (t += 1000));
};

// Map the third floor: both wings, both east bedchambers, and the stairs down
go(null, LANDING);
go('s', VEST_S);
go('e', BED_EAST);
go('w', VEST_S);
go('n', LANDING);
go('n', VEST_N);
go('e', BED_EAST);
go('w', VEST_N);
go('s', LANDING);
go('d', DAY_ROOM);
const keep = map.pos!.townId;
const keepRooms = map.get(keep)!.rooms.size;
check(keepRooms === 6, `keep mapped (${keepRooms} rooms)`);

// Log in where the stored position doesn't match: the twin east
// bedchambers make the entry ambiguous, so a fragment town is born
loc.onWilderness();
map.pos = null;
const login = go(null, BED_EAST);
check(login.pos!.townId !== keep, 'an ambiguous twin login starts a fragment town');

// Walk straight out: w to the (south) vestibule, n to the landing — both
// unmapped in the fragment, so the current room never has two links
const step1 = go('w', VEST_S);
check(step1.kind === 'new-room' && !step1.merged, 'step 1: still a new room in the fragment');
const step2 = go('n', LANDING);
check(!!step2.merged, 'step 2: the vestibule just left (now two links) fuses the fragment');
check(map.pos!.townId === keep, `step 2: standing in the keep's own town (${map.pos!.townId})`);
check(map.room(map.pos)?.name === 'Landing', 'step 2: on the Landing');
check(
  map.get(keep)!.rooms.size === keepRooms,
  `no duplicates (${map.get(keep)!.rooms.size} rooms)`
);
check(map.towns.size === 1, `the emptied fragment town is gone (${map.towns.size} towns)`);

// The CURRENT room is still probed first. A fragment holding the south
// vestibule (with the landing north and the east bedchamber) was mapped
// before the keep's own town knew that wing, so no probe could fuse it
// then. Stepping from the fragment's bedchamber (one link: it matches
// nothing) back into its vestibule, the vestibule's own links match the
// keep's and the merge fires on arrival.
{
  const map2 = new TownMapStore();
  const loc2 = new TownLocalizer(map2);
  let t2 = 1000;
  const go2 = (cmd: string | null, b: TownRoomBlock) => {
    if (cmd) loc2.trackCommand(cmd, (t2 += 100));
    return loc2.onRoomBlock(b, null, (t2 += 1000));
  };
  go2(null, LANDING);
  go2('s', VEST_S);
  go2('e', BED_EAST);
  go2('w', VEST_S);
  go2('n', LANDING);
  go2('d', DAY_ROOM);
  const keep2 = map2.pos!.townId;
  const frag = map2.createTown('Bedchamber');
  const bed = map2.addRoom(frag, BED_EAST, 0, 0, 0, t2);
  const vest = map2.addRoom(frag, VEST_S, -1, 0, 0, t2);
  const landing = map2.addRoom(frag, LANDING, -1, -1, 0, t2);
  map2.link(frag, bed, 'w', vest);
  map2.link(frag, vest, 'n', landing);
  map2.pos = { townId: frag.id, roomId: bed.id };
  const step = go2('w', VEST_S);
  check(
    step.kind === 'expected' && !!step.merged,
    `current first: the vestibule fuses on arrival (${step.kind}, ${JSON.stringify(step.merged)})`
  );
  check(
    map2.pos?.townId === keep2 && map2.room(map2.pos)?.name === 'Vestibule',
    "current first: standing on the keep's own vestibule"
  );
  check(
    map2.get(keep2)!.rooms.size === 4 && map2.towns.size === 1,
    `current first: no duplicates, fragment gone (${map2.get(keep2)!.rooms.size} rooms)`
  );
}

if (failed > 0) {
  console.error(`${failed} probe assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: a login fragment fuses on its second step');
