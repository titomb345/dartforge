/**
 * Regression test: a positively identified sighting with someone else's
 * identity headline (Oct 2026 deep dive, duplicates lens: twin-resume-name-
 * only — the cheap hardening).
 *
 * "Positive" identifications — a walked link followed, a look's re-print, a
 * walked named exit — are only name-verified, so they can land on a
 * word-identical twin. A login resumed on the keep's north-wing Bedchamber
 * while Bill stood in its south-wing twin (word-identical: no check can
 * tell them apart), and the walked link west reached "its" Vestibule —
 * printing the SOUTH vestibule's text into the north one
 * (session_2026-07-06T20-19-27-332.log:112). The overwritten room then
 * disagreed with its own next sighting (07-07T07-13-20-126.log:2777), and a
 * corrupted description vetoes correct reuse later. A block opening with a
 * different identity headline (first sentence, lighting / ambient /
 * volatile prose aside) is another room's: it neither replaces the stored
 * description nor teaches volatile prose.
 *
 *  A. The link follow onto the wrong twin keeps the stored text.
 *  B. A look re-print and a walked named exit likewise.
 *  C. An ordinary revisit still refreshes the description (day/night prose
 *     mid-description, a tail capture starting at a later sentence).
 */
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { TownMapStore } from '../../src/lib/townMap';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 80),
  desc,
  exits: parseTownExits(exits),
});

// session_2026-07-06T20-19-27-332.log / 07-07T07-13-20-126.log
const vestibule = (side: 'north' | 'south') =>
  block(
    'Vestibule',
    'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and a closed oak door leading east.',
    `This is a small vestibule leading to the bedrooms on the ${side} side of this floor.  ` +
      `Doors open onto bedrooms on the ${side}, east and west side and an open archway leads ` +
      'into the day room.  Wrought-iron cressets mounted on the walls on either side of the ' +
      'archway shed a warm illumination.  It is bright.'
  );
const bedchamber = (light: 'Daylight' | 'Starlight') =>
  block(
    'Bedchamber',
    'There is one obvious exit: a closed oak door leading west.',
    'This is a bedchamber on an upper floor of the keep where one of the senior rangers may ' +
      `rest and store his or her gear.  ${light} streams in through a window on the east wall.  ` +
      'The room is furnished with a bed with a large chest pushed up against the foot it.  ' +
      'A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  ' +
      'It is bright.'
  );
const NORTH = vestibule('north');
const SOUTH = vestibule('south');

function keep() {
  const map = new TownMapStore();
  const town = map.createTown('Eris');
  const vn = map.addRoom(town, NORTH, 0, 0, 2, 0);
  const bn = map.addRoom(town, bedchamber('Daylight'), 1, 0, 2, 0);
  const vs = map.addRoom(town, SOUTH, 0, 4, 2, 0);
  const bs = map.addRoom(town, bedchamber('Daylight'), 1, 4, 2, 0);
  map.link(town, bn, 'w', vn);
  map.link(town, bs, 'w', vs);
  return { map, town, vn, bn, vs, bs };
}
const stored = (desc: string) =>
  /north side/.test(desc) ? 'north' : /south side/.test(desc) ? 'south' : '?';

// --- A: a walked link onto the wrong twin -------------------------------------------
{
  const { map, town, vn, bn } = keep();
  map.pos = { townId: town.id, roomId: bn.id }; // resumed on the wrong (north) twin
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(bedchamber('Daylight'), null, 1_000);
  loc.trackCommand('w', 1_100);
  const res = loc.onRoomBlock(SOUTH, null, 1_200);
  check(
    res.kind === 'expected' && res.pos?.roomId === vn.id,
    `A: the link is followed (${res.kind})`
  );
  check(stored(vn.desc) === 'north', `A: the north Vestibule keeps its text (${stored(vn.desc)})`);
  check(/north side/.test(vn.descFirst), 'A: ... and its first line');
  const saved = map.serialize() as { volatilePending: object; volatileSentences: string[] };
  check(
    Object.keys(saved.volatilePending).length === 0 && saved.volatileSentences.length === 0,
    'A: nothing learned as volatile'
  );
}

// --- B: a look's re-print, a walked named exit ---------------------------------------
{
  const { map, town, vn } = keep();
  map.pos = { townId: town.id, roomId: vn.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(NORTH, null, 1_000);
  loc.trackCommand('l', 1_100);
  const res = loc.onRoomBlock(SOUTH, null, 1_200); // a hidden hop to the twin, then the look
  check(res.kind === 'stationary', `B: the look re-print is stationary (${res.kind})`);
  check(stored(vn.desc) === 'north', `B: the look keeps the north text (${stored(vn.desc)})`);

  const m2 = new TownMapStore();
  const t2 = m2.createTown('Eris');
  const hall = m2.addRoom(
    t2,
    block('Hall', 'There is one obvious exit: out.', 'A hall.'),
    0,
    0,
    0,
    0
  );
  const twin = m2.addRoom(t2, NORTH, 3, 0, 0, 0);
  m2.linkNamed(hall, 'enter vestibule', twin);
  m2.pos = { townId: t2.id, roomId: hall.id };
  const l2 = new TownLocalizer(m2);
  l2.onRoomBlock(block('Hall', 'There is one obvious exit: out.', 'A hall.'), null, 1_000);
  l2.trackCommand('enter vestibule', 1_100);
  const r2 = l2.onRoomBlock(SOUTH, null, 1_200);
  check(r2.kind === 'expected', `B: the named link is followed (${r2.kind})`);
  check(
    stored(twin.desc) === 'north',
    `B: the named exit keeps the north text (${stored(twin.desc)})`
  );
}

// --- C: ordinary revisits still refresh the description --------------------------------
{
  const { map, town, bn, vn } = keep();
  map.pos = { townId: town.id, roomId: vn.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(NORTH, null, 1_000);
  loc.trackCommand('e', 1_100);
  loc.onRoomBlock(bedchamber('Starlight'), null, 1_200);
  check(/Starlight/.test(bn.desc), 'C: day/night prose mid-description is refreshed');
  // A tail capture starting at a later sentence of the stored text
  loc.trackCommand('w', 1_300);
  const tail = block(
    'Vestibule',
    'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and a closed oak door leading east.',
    'Doors open onto bedrooms on the north, east and west side and an open archway leads into ' +
      'the day room.  Wrought-iron cressets mounted on the walls on either side of the archway ' +
      'shed a warm illumination.  It is bright.'
  );
  loc.onRoomBlock(tail, null, 1_400);
  check(vn.desc === tail.desc, 'C: a tail capture is no foreign headline (stored as before)');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-twin-headline: all checks passed');
