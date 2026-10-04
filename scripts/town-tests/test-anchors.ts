/**
 * Regression test: hex anchor keys (Oct 2026 deep dive, identity lens).
 *
 * An anchor ("island:q,r" -> room) says "entering from this hex lands in
 * this room". The corpus replay ended with 6 keys held by 2-3 towns each
 * ("0:7,5": Eris, Tobermore's Servants Quarters, a cave), the first town by
 * id answered every lookup, and a mismatch there sent the entry on to the
 * global match — ambiguous at twin-heavy entrances, so a fragment town.
 *
 *  A. setAnchor: one hex leads into one place — the key leaves every other
 *     town (last writer wins).
 *  B. findTownByAnchor: a save that already holds a collision answers with
 *     the town whose anchor room matches the block (strictly — even after a
 *     holder matching by name only — then by name) — here the only way in,
 *     since the room's entry-grade twin elsewhere makes the global match
 *     ambiguous.
 *  C. After a login the hex position is the hex localizer's LAST survey,
 *     possibly from another session: until a survey places the player,
 *     town entries neither use nor learn anchors (8 of the 17 collisions
 *     the replay learned were seeded at logins).
 *  D. session_2026-07-01T15-45-27-282.log:28309: "reconnecting to old
 *     object" lands in the Causeway while the hex position is still the one
 *     whose anchor leads to the Bone Pit — the stale hex must not take the
 *     Bone Pit's key over.
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
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});
const holders = (map: TownMapStore, key: string) =>
  [...map.towns.values()].filter((t) => t.anchors[key] !== undefined).map((t) => t.name);

const GATE = block(
  'Town Gate',
  'north and south',
  'A stout wooden gate pierces the town wall here.'
);
const CAUSEWAY = block(
  'Causeway',
  'northwest and south',
  'This is the top of a steep path that winds down to a sheltered beach far below.'
);
const BONE_PIT = block('Bone Pit', 'north and up', 'A deep pit lined with old bones and rubble.');

// --- A: last writer wins ------------------------------------------------------
{
  const map = new TownMapStore();
  const a = map.createTown('A');
  const b = map.createTown('B');
  const ra = map.addRoom(a, GATE, 0, 0, 0, 0);
  const rb = map.addRoom(b, GATE, 0, 0, 0, 0);
  map.setAnchor(a, '0:1,1', ra.id);
  map.setAnchor(b, '0:1,1', rb.id);
  check(
    JSON.stringify(holders(map, '0:1,1')) === '["B"]',
    `A: the key moved to B (${holders(map, '0:1,1')})`
  );
}

// --- B: a saved collision answers with the matching room ----------------------
{
  const map = new TownMapStore();
  const eris = map.createTown('Eris');
  const cove = map.createTown('Cove');
  const twin = map.createTown('Twin');
  const erisGate = map.addRoom(eris, GATE, 0, 0, 0, 0);
  const causeway = map.addRoom(cove, CAUSEWAY, 0, 0, 0, 0);
  map.addRoom(twin, CAUSEWAY, 5, 5, 0, 0); // an entry-grade twin: the global match is ambiguous
  // A legacy save: both towns hold the key (written before setAnchor deduplicated)
  eris.anchors['0:-18,31'] = erisGate.id;
  cove.anchors['0:-18,31'] = causeway.id;
  const loaded = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
  const hit = loaded.findTownByAnchor('0:-18,31', CAUSEWAY);
  check(hit?.town.name === 'Cove', `B: the matching holder answers (${hit?.town.name})`);
  check(loaded.findTownByAnchor('0:-18,31')?.town.name === 'Eris', 'B: without a block, the first');
  // No strict match (the gate shut: exits differ) — a holder matching by name
  // still beats the first holder
  const shut = { ...CAUSEWAY, exits: parseTownExits('There is one obvious exit: northwest.') };
  check(
    loaded.findTownByAnchor('0:-18,31', shut)?.town.name === 'Cove',
    'B: a name match beats the first holder'
  );
  // ... and a strict match beats an EARLIER holder's name match: an older
  // fragment town holds the key too, its Causeway recorded with the gate shut
  const m2 = new TownMapStore();
  const frag = m2.createTown('Fragment');
  frag.anchors['0:-18,31'] = m2.addRoom(frag, shut, 0, 0, 0, 0).id;
  const cove2 = m2.createTown('Cove');
  cove2.anchors['0:-18,31'] = m2.addRoom(cove2, CAUSEWAY, 0, 0, 0, 0).id;
  check(
    m2.findTownByAnchor('0:-18,31', CAUSEWAY)?.town.name === 'Cove',
    `B: a strict match beats an earlier name match (${m2.findTownByAnchor('0:-18,31', CAUSEWAY)?.town.name})`
  );
  const loc = new TownLocalizer(loaded);
  const res = loc.onRoomBlock(CAUSEWAY, '0:-18,31', 1_000);
  check(
    res.kind === 'entered' && res.pos?.townId === cove.id && res.pos.roomId === causeway.id,
    `B: entering from the hex lands on the Causeway (${JSON.stringify(res.pos)})`
  );
  check(loaded.towns.size === 3, `B: no fragment town (${loaded.towns.size})`);
}

// --- C: no anchors between a login and the first survey ------------------------
{
  const map = new TownMapStore();
  const town = map.createTown('Eris');
  const gate = map.addRoom(town, GATE, 0, 0, 0, 0);
  map.setAnchor(town, '0:7,5', gate.id);
  const loc = new TownLocalizer(map);
  loc.onLogin();
  // A stale hex: the gate's anchor, but the player logged in elsewhere with
  // a room that is NOT entry-grade unique — a fresh town, no anchor learned
  const res = loc.onRoomBlock(CAUSEWAY, '0:7,5', 1_000);
  check(res.kind === 'entered' && res.pos?.townId !== town.id, 'C: the stale anchor is not used');
  check(
    JSON.stringify(holders(map, '0:7,5')) === '["Eris"]',
    `C: ... nor learned (${holders(map, '0:7,5')})`
  );
  // Matching the anchor's room by name is no exception: the anchor is not read
  const loc2 = new TownLocalizer(map);
  loc2.onLogin();
  const back = loc2.onRoomBlock(
    block('Town Gate', 'north and south', 'A different gate text entirely, no entry-grade match.'),
    '0:7,5',
    2_000
  );
  check(back.pos?.townId !== town.id, 'C: a name match through a stale anchor is not taken');
  // A survey places the player: anchors count again
  loc2.onWilderness();
  const fresh = loc2.onRoomBlock(BONE_PIT, '0:9,9', 3_000);
  check(
    fresh.kind === 'entered' && JSON.stringify(holders(map, '0:9,9')) === '["Bone Pit"]',
    `C: after a survey the entry learns its anchor (${holders(map, '0:9,9')})`
  );
}

// --- D: the 07-01 reconnect -----------------------------------------------------
{
  const map = new TownMapStore();
  const pit = map.createTown('Bone Pit');
  const pitRoom = map.addRoom(pit, BONE_PIT, 0, 0, 0, 0);
  map.setAnchor(pit, '1:6,0', pitRoom.id);
  const cove = map.createTown('Cove');
  const causeway = map.addRoom(cove, CAUSEWAY, 0, 0, 0, 0);
  map.pos = { townId: pit.id, roomId: pitRoom.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(BONE_PIT, null, 1_000); // in the Bone Pit before the reconnect
  loc.onLogin(); // "You are already playing, reconnecting to old object."
  const res = loc.onRoomBlock(CAUSEWAY, '1:6,0', 2_000);
  check(
    res.kind === 'entered' && res.pos?.townId === cove.id && res.pos.roomId === causeway.id,
    `D: the reconnect lands on the Causeway (${res.kind} ${JSON.stringify(res.pos)})`
  );
  check(
    pit.anchors['1:6,0'] === pitRoom.id && cove.anchors['1:6,0'] === undefined,
    "D: the Bone Pit keeps its anchor; the stale hex is not the Causeway's"
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-anchors: all checks passed');
