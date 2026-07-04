/**
 * Regression test: uniform-fingerprint plaza (Eris market, July 2026).
 *
 * A 3x3 walkable grid of rooms ALL named "Market", where the three side
 * rooms and the south edge genuinely share the full fingerprint
 * [e,n,s,w]. Only the mid-description prose differs per room ("the
 * northern edge" vs "the western side"...), and the trailing lighting
 * sentence varies with the time of day.
 *
 * The historical failures this locks down:
 *  1. A DIAGONAL move back into mapped territory always duplicated its
 *     destination (the hint-cell occupant was excluded from near-reuse),
 *     so `se` from the NW corner re-created the plaza center.
 *  2. A frontier move whose target had 2+ same-fingerprint rooms nearby
 *     reused the lone guard-survivor even though the block's description
 *     disagreed with it — snapping onto the wrong twin and growing false
 *     links instead of creating the (unmapped) true room.
 *  3. Hidden hops (alias moves the queue never saw) inside the plaza were
 *     swallowed as re-prints or snapped to the closest twin.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const block = (name: string, exitsSentence: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.split('  ')[0],
  desc,
  exits: parseTownExits(`There are exits: ${exitsSentence}.`),
});

// The shared first sentence mirrors the real plaza: descFirst alone cannot
// tell the rooms apart — only the mid-desc prose can.
const PLAZA = 'This is a spacious market square in the heart of town.';
const mk = (exits: string, prose: string, lighting = 'It is painfully bright.') =>
  block('Market', exits, `${PLAZA}  ${prose}  ${lighting}`);

const SE = mk('north, west, and northwest', 'This is the southeastern corner of the market.');
const E_SIDE = mk('north, east, south, and west', 'This is the eastern side of the market.');
const NE = mk('south, southwest, and west', 'This is the northeastern corner of the market.');
const N_EDGE = mk('north, east, south, and west', 'This is the northern edge of the market.');
const NW = mk('east, south, and southeast', 'This is the northwestern corner of the market.');
const CENTER = mk(
  'north, northeast, east, southeast, south, southwest, west, and northwest',
  'This is the center of the market, and contains a well.'
);
const W_SIDE = mk('north, east, south, and west', 'This is the western side of the market.');
const SW = mk('east, north, and northeast', 'This is the southwestern corner of the market.');
const S_EDGE = mk('north, east, south, and west', 'This is the southern edge of the market.');

let t = 1000;
let failures = 0;
const step = (cmd: string | null, b: TownRoomBlock, expectKind?: string) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? 'enter').padEnd(6)} → [${res.kind.padEnd(11)}] room#${room?.id} at(${room?.x},${room?.y},${room?.z})`
  );
  if (expectKind && res.kind !== expectKind) {
    console.error(`  FAIL: expected [${expectKind}]`);
    failures++;
  }
  return res;
};

// --- Explore the plaza (leaves the south edge unmapped) ---
step(null, SE, 'entered');
const seId = map.pos!.roomId;
step('n', E_SIDE, 'new-room');
step('n', NE, 'new-room');
step('w', N_EDGE, 'new-room');
const nEdgeId = map.pos!.roomId;
step('w', NW, 'new-room');
// Diagonal into unmapped territory creates the center...
step('se', CENTER, 'new-room');
const centerId = map.pos!.roomId;
// Frontier move with two same-fingerprint twins nearby (E side, N edge):
// the true west-side room is UNMAPPED and the block's desc disagrees with
// the lone guard-survivor — must CREATE, not snap onto a twin. (Bug 2)
const wRes = step('w', W_SIDE, 'new-room');
if (wRes.pos!.roomId === nEdgeId) {
  console.error('  FAIL: west side snapped onto the northern edge twin');
  failures++;
}
step('s', SW, 'new-room');
// Same shape eastward: S edge unmapped, three twins in range. (Bug 2)
step('e', S_EDGE, 'new-room');
// Loop closes onto the exact-cell occupant: the SE corner.
const closeRes = step('e', SE, 'expected');
if (closeRes.pos!.roomId !== seId) {
  console.error('  FAIL: loop closure missed the SE corner');
  failures++;
}
// Diagonal back into MAPPED territory must reuse the center, not duplicate
// it. (Bug 1 — this exact move duplicated the Eris plaza center.)
const diagRes = step('nw', CENTER, 'expected');
if (diagRes.pos!.roomId !== centerId) {
  console.error('  FAIL: nw from the SE corner did not land on the existing center');
  failures++;
}

const town = map.get(map.pos!.townId)!;
const markets = [...town.rooms.values()].filter((r) => r.name === 'Market');
const centers = markets.filter((r) => r.exits.length === 8);
console.log(
  `\nMarket rooms: ${markets.length} (expected 9), centers: ${centers.length} (expected 1)`
);
if (markets.length !== 9 || centers.length !== 1) failures++;

// --- Hidden hop to a mapped twin (queue empty) ---
// Standing on the center, an alias moved us without a tracked command; the
// N edge is NOT a linked neighbor of the center yet. Only the description
// identifies which twin we're on — and the lighting changed since mapping.
// (Bug 3)
const hopRes = step(
  null,
  mk('north, east, south, and west', 'This is the northern edge of the market.', 'It is dark.')
);
if (hopRes.pos!.roomId !== nEdgeId) {
  console.error(
    `  FAIL: hidden hop resolved to room#${hopRes.pos!.roomId}, expected the northern edge #${nEdgeId}`
  );
  failures++;
}
if (town.rooms.size !== 9) {
  console.error(`  FAIL: hidden hop changed the room count (${town.rooms.size})`);
  failures++;
}

// --- Hidden hop to an UNMAPPED twin must not snap to a mapped one ---
// Fresh plaza, only two twins mapped; a hop lands on a third (unmapped)
// twin strictly closer to one of them. Closest-pick used to snap wrongly;
// with readable, disagreeing descs it must refuse and create instead.
{
  const map2 = new TownMapStore();
  const loc2 = new TownLocalizer(map2);
  const step2 = (cmd: string | null, b: TownRoomBlock) => {
    if (cmd) loc2.trackCommand(cmd, (t += 1000));
    return loc2.onRoomBlock(b, '0:0,0', (t += 1000));
  };
  step2(null, SE);
  step2('n', E_SIDE);
  const eSideId = map2.pos!.roomId;
  step2('s', SE);
  // Hidden hop: the (unmapped) southern edge, one cell from the E side.
  const res = step2(null, S_EDGE);
  const landed = map2.room(res.pos)!;
  console.log(`hop    → [${res.kind.padEnd(11)}] room#${landed.id}`);
  if (landed.id === eSideId) {
    console.error('  FAIL: unmapped-twin hop snapped onto the eastern side');
    failures++;
  }
  if (res.kind !== 'jumped') {
    console.error(`  FAIL: unmapped-twin hop resolved as [${res.kind}], expected jumped`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  '\nPASS — plaza maps 9 unique rooms, diagonals reuse the center, twins never swallow position'
);
