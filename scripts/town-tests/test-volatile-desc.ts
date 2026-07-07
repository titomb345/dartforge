/**
 * Regression test: learned volatile description prose.
 * The Eris market cycles through six time-of-day crowd sentences inside
 * otherwise-identical descriptions, so across an hour boundary the SAME
 * room used to read as a desc-disagreeing twin — the disagreement veto
 * then duplicated it. Positively-identified revisits (confirmed links)
 * whose descs differ in exactly one swapped sentence teach the store that
 * pair; once a pair is witnessed on two different rooms both sentences
 * are ignored by desc comparison. Twin-DISTINGUISHING prose ("the western
 * side" vs "the center") is room-specific, never alternates on one room,
 * and so must never be learned.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const OPEN = 'This is a spacious market square in the heart of the town.';
const BUSY = 'The market is active with shoppers and craftsmen in search of a bargain.';
const EMPTY = 'The market is mostly empty except for a few adventurers heading home.';
const WEST = 'This is the western side of the market with a row of cloth stalls.';
const CENTER = 'This appears to be the center of the market, and contains a well.';
const NORTH = 'This appears to be the northern edge of the market by the gate.';

const market = (position: string, crowd: string, exits: string): TownRoomBlock => {
  const desc = `${OPEN}  ${crowd}  ${position}  It is well lit.`;
  return {
    name: 'Market',
    descFirst: desc.slice(0, 78),
    desc,
    exits: parseTownExits(`There are exits: ${exits}.`),
  };
};

let t = 1000;
const step = (cmd: string | null, b: TownRoomBlock) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos);
  console.log(
    `${(cmd ?? 'enter').padEnd(5)} → [${res.kind.padEnd(9)}] room#${room?.id} at(${room?.x},${room?.y})`
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

// Map three market rooms in a row (west, center, north-ish east leg) at the
// "busy" hour, walking confirmed links both ways.
step(null, market(WEST, BUSY, 'east'));
const west = map.pos!.roomId;
step('e', market(CENTER, BUSY, 'east, west, and north'));
const center = map.pos!.roomId;
step('n', market(NORTH, BUSY, 'south'));
const north = map.pos!.roomId;

// Revisit along confirmed links at the "empty" hour — each revisit is a
// positive ID (link follow), and the same BUSY→EMPTY swap on two different
// rooms promotes the pair.
step('s', market(CENTER, EMPTY, 'east, west, and north'));
step('w', market(WEST, EMPTY, 'east'));
check(map.volatileSentences.has(BUSY), 'BUSY crowd sentence not learned as volatile');
check(map.volatileSentences.has(EMPTY), 'EMPTY crowd sentence not learned as volatile');
check(
  !map.volatileSentences.has(WEST) && !map.volatileSentences.has(CENTER),
  'room-distinguishing prose wrongly learned as volatile'
);

// The tiebreaker must now see through the hour change: a block for the
// center room at the EMPTY hour desc-agrees with the room stored at the
// BUSY hour, and still disagrees with its twins.
const centerRoom = map.get(map.pos!.townId)!.rooms.get(center)!;
const westRoom = map.get(map.pos!.townId)!.rooms.get(west)!;
map.touchRoom(centerRoom, market(CENTER, BUSY, 'east, west, and north'), (t += 1000));
check(
  map.descAgrees(centerRoom, market(CENTER, EMPTY, 'east, west, and north')),
  'same room across an hour change should desc-agree once the pair is learned'
);
check(
  !map.descAgrees(westRoom, market(CENTER, EMPTY, 'east, west, and north')),
  'twins must still desc-DISAGREE (distinguishing sentence differs)'
);

// End-to-end: a hidden move (no tracked command) onto the north room at a
// new hour must relocalize onto it — not spawn a duplicate.
const before = map.get(map.pos!.townId)!.rooms.size;
step('e', market(CENTER, EMPTY, 'east, west, and north')); // stand on center
const res = (() => {
  // hidden move n (alias) — block arrives with no queued command
  return loc.onRoomBlock(market(NORTH, EMPTY, 'south'), '0:0,0', (t += 1000));
})();
check(res.pos?.roomId === north, `hidden move landed room#${res.pos?.roomId}, expected #${north}`);
check(
  map.get(map.pos!.townId)!.rooms.size === before,
  'hidden move at a new hour duplicated a room'
);

// A description's FIRST sentence is the room's identity headline and must
// never be learned, even when witnessed swapping on two different rooms.
// (The Blue Pearl Inn's floors differ only by their "second/third floor"
// headline; a wrong link once taught that pair and glued the floors
// together — cross-floor links, duplicated bedrooms.)
const H2 = 'A hallway on the second floor which stretches southwards.';
const H3 = 'A hallway on the third floor which stretches southwards.';
const REST = 'Doors on the west side lead into private bedrooms for guests.';
const REST2 = 'The carpet here is a rich blue with pearl-white trim on the edges.';
const hallway = (headline: string): TownRoomBlock => ({
  name: 'Blue Pearl Hallway',
  descFirst: headline,
  desc: `${headline}  ${REST}  ${REST2}`,
  exits: parseTownExits('There are exits: north and south.'),
});
const roomA = map.get(map.pos!.townId)!.rooms.get(west)!;
const roomB = map.get(map.pos!.townId)!.rooms.get(center)!;
roomA.desc = hallway(H2).desc;
map.touchRoom(roomA, hallway(H3), (t += 1000), true);
roomB.desc = hallway(H3).desc;
map.touchRoom(roomB, hallway(H2), (t += 1000), true);
check(
  !map.volatileSentences.has(H2) && !map.volatileSentences.has(H3),
  'identity headline sentences wrongly learned as volatile'
);

// Learned prose survives serialization.
const revived = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
check(revived.volatileSentences.has(BUSY), 'volatile sentences lost through serialize');

// Saves poisoned by the pre-guard learner are cleansed on load: a learned
// sentence matching some room's headline is dropped, legit ones are kept.
// (roomA's desc now headlines H3 after the touch above.)
const poisoned = JSON.parse(JSON.stringify(map.serialize())) as {
  volatileSentences: string[];
  volatilePending: Record<string, number[]>;
};
poisoned.volatileSentences.push(H3);
poisoned.volatilePending[[H2, H3].sort().join('\0')] = [roomA.id];
const cleansed = TownMapStore.deserialize(poisoned);
check(!cleansed.volatileSentences.has(H3), 'poisoned headline sentence survived load cleanse');
check(cleansed.volatileSentences.has(BUSY), 'legit volatile sentence dropped by load cleanse');
const reSerialized = cleansed.serialize() as { volatilePending: Record<string, number[]> };
check(
  !Object.keys(reSerialized.volatilePending).some((k) => k.includes(H3)),
  'poisoned pending pair survived load cleanse'
);

if (fail) process.exit(1);
console.log('PASS — volatile prose is learned from confirmed revisits and ignored thereafter');
