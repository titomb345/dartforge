/** Regression test: portal transits must split towns, and return trips must re-enter them. */
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

const FORECOURT_A = block(
  'Forecourt',
  'west and east',
  'This is a cobblestone paved courtyard in front of the Eris Luminarian church.'
);
const MARKET = block('Market', 'east and north', 'This is a spacious market square in Eris.');
const CHAMBER = block(
  'Portal Chamber',
  'east',
  'This is a large open room ringed by seven arch-shaped portals of some dark bluish stone.'
);
const FORECOURT_B = block(
  'Forecourt',
  'west and east',
  'This is a muddy courtyard in front of the Tobermore Luminarian shrine.'
);

let t = 1000;
const step = (cmd: string | null, b: TownRoomBlock, viaPortal = false) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  if (viaPortal) {
    // Simulate the transit line arriving through the feed
    if (!PORTAL_TRANSIT_RE.test('You step into the north portal.')) throw new Error('regex broken');
    loc.onPortalTransit();
  }
  const res = loc.onRoomBlock(b, null, (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? (viaPortal ? 'PORTAL' : 'enter')).padEnd(6)} → [${res.kind.padEnd(9)}] town#${res.pos?.townId} room#${room?.id} "${room?.name}"`
  );
  return res;
};

step(null, FORECOURT_A); // enter Eris temple area
const erisTown = map.pos!.townId;
const erisForecourtId = map.pos!.roomId;
step('w', MARKET);
step('e', FORECOURT_A);
step(null, CHAMBER, true); // port → hub
const hubTown = map.pos!.townId;
step(null, FORECOURT_B, true); // port n → Tobermore
const tobTown = map.pos!.townId;
step(null, CHAMBER, true); // port → hub again
const hubTown2 = map.pos!.townId;
const res = step(null, FORECOURT_A, true); // port ne → back to Eris

console.log(`\nTowns: ${map.towns.size} (expected 3)`);
const ok =
  map.towns.size === 3 &&
  hubTown !== erisTown &&
  tobTown !== erisTown &&
  tobTown !== hubTown &&
  hubTown2 === hubTown &&
  res.pos?.townId === erisTown &&
  res.pos?.roomId === erisForecourtId;
if (!ok) {
  console.error(
    `FAIL: eris=${erisTown} hub=${hubTown}/${hubTown2} tob=${tobTown} final=${res.pos?.townId}:${res.pos?.roomId} (expected ${erisTown}:${erisForecourtId})`
  );
  process.exit(1);
}
console.log('PASS — towns stay separate, return trips re-enter the right ones');

// --- Recall-style teleport (no transit message, empty queue) ---
// Walk deeper into Eris first, then a recall lands us in the (mapped,
// distinctly-named) Portal Chamber with zero warning. NOTE: a recall whose
// destination NAME matches the current room or a neighbor is deliberately
// swallowed as a re-print — that ambiguity needs a transit message.
step('w', MARKET);
const res2 = step(null, CHAMBER);
if (res2.pos?.townId !== hubTown) {
  console.error(
    `FAIL: recall teleport not detected (town ${res2.pos?.townId}, expected ${hubTown})`
  );
  process.exit(1);
}
console.log('PASS — messageless teleport to a mapped room switches towns');
