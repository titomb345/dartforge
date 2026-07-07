/**
 * Regression test: portal destination memory.
 * Temple Forecourts are same-fingerprint twins of each other, so entry
 * matching cannot identify a portal's destination — before the memory,
 * EVERY hub transit whose arrival didn't uniquely entry-match spawned a
 * fresh fragment town (corpus: 5+ "Forecourt" fragments in a week, each
 * later merge-scarring Eris with desc-divergent duplicate rooms). The
 * departure room + the direction named by the transit line ("You step
 * into the north portal.") identify the destination exactly, like hex
 * anchors do for wilderness entries.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits, PORTAL_TRANSIT_RE } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});

// Short desc → entry-grade matching is unusable for this room, so only the
// portal memory can resolve a repeat arrival (isolates the mechanism).
const CHAMBER = block(
  'Portal Chamber',
  'east',
  'This is a large open room ringed by seven arch-shaped portals of some dark bluish stone.'
);
const FORECOURT = block('Forecourt', 'west and east', 'A muddy yard.');

let t = 1000;
const step = (b: TownRoomBlock, portalLine?: string) => {
  if (portalLine) {
    const m = PORTAL_TRANSIT_RE.exec(portalLine);
    if (!m) throw new Error('regex broken');
    loc.onPortalTransit(m[1] ?? null);
  }
  const res = loc.onRoomBlock(b, null, (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(portalLine ? 'PORTAL' : 'enter').padEnd(6)} → [${res.kind.padEnd(9)}] town#${res.pos?.townId} room#${room?.id} "${room?.name}"`
  );
  return res;
};

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

step(CHAMBER); // enter the hub
const hubTown = map.pos!.townId;
const hubRoomId = map.pos!.roomId;

// First trip north: nothing to match (short desc) → new fragment town, and
// the destination is LEARNED for this portal.
step(FORECOURT, 'You step into the north portal.');
const foreTown = map.pos!.townId;
const foreRoomId = map.pos!.roomId;
check(foreTown !== hubTown, 'first arrival should be its own town');

// Return to the hub (spoke-side transit names no direction).
const back = step(CHAMBER, 'You step into the portal.');
check(
  back.pos?.townId === hubTown && back.pos?.roomId === hubRoomId,
  'return should re-enter the hub'
);

// Second trip north: entry matching still can't identify the Forecourt —
// only the memory can. Must land in the SAME room, no new town.
const again = step(FORECOURT, 'You step into the north portal.');
check(again.kind === 'entered', `second trip kind=${again.kind}, expected entered`);
check(
  again.pos?.townId === foreTown && again.pos?.roomId === foreRoomId,
  `second trip landed ${again.pos?.townId}:${again.pos?.roomId}, expected ${foreTown}:${foreRoomId}`
);
check(map.towns.size === 2, `towns=${map.towns.size}, expected 2 (no fragment spawned)`);

// The memory must survive serialization (it's what stops NEXT session's
// first port from fragmenting).
const revived = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
check(
  revived.getPortalDest({ townId: hubTown, roomId: hubRoomId }, 'north')?.townId === foreTown,
  'portal memory lost through serialize/deserialize'
);

if (fail) process.exit(1);
console.log('PASS — portal destinations are remembered; repeat trips spawn no fragments');
