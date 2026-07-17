/**
 * Regression test: queue desync from UNRECOGNIZED soft move failures, and
 * identical-twin rows stealing each other's satellite rooms (Soriktos,
 * July 2026 — found live by Bill; reproduced from session logs).
 *
 * Scenario A (Blue Pearl Garden Courtyard): `w` from the Salon fails with
 * room-specific flavor text ("A very large eunuch ... You decide it's not
 * a good idea to go in there.") that no pattern can recognize, so the dead
 * move stays at the queue head; the block for the following `s` used to be
 * consumed under `w`, wiring the one-exit Garden Courtyard WEST of the
 * Salon. The twin-guards then refused to reuse it on every TRUE southern
 * arrival (already-a-neighbor-elsewhere), duplicating it forever. The
 * arrival block's own exits line is ground truth: it lists no east exit,
 * so it cannot be the `w` destination — the head is dropped and the block
 * resolves under `s`.
 *
 * Scenario B (Royal Stables): three word-identical stable segments in a
 * row, each with word-identical one-exit Stalls north and south. The
 * relaxed reciprocity (duplicate-healing) clause used to let segment B's
 * `n` reuse segment A's stall — A and B have equal fingerprints, so A
 * looked like "a duplicate of B" — silently shifting the player's frame
 * one cell sideways (every later move resolved one room off, spawning
 * duplicate stalls and swallowing real moves as stationary). Rooms that
 * are WALK-LINKED to each other are provably distinct, never duplicates.
 *
 * Scenario C (save cleanse): a Scenario-A poison link persisted in a save
 * is severed on load (a link is impossible when the destination's own
 * exits have never listed the way back), so the next true arrival HEALS
 * the map instead of duplicating the room.
 *
 * Scenario D (non-reciprocal arrivals stay mappable): ~2% of corpus moves
 * genuinely arrive in rooms that don't list the way back (sloped trails:
 * "down" returns as "north"). With no better explanation queued, the head
 * move must be trusted as before.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are exits: ${exits}.`),
});

const SALON = block(
  'Salon',
  'north, south, west, and east',
  'This large, airy room is the salon of the Blue Pearl.'
);
const GARDEN = block(
  'Garden Courtyard',
  'north',
  'This is a tranquil courtyard filled with exotic flowers and trees covered with blossoms.'
);
const STABLES_MID = block(
  'Royal Stables',
  'east, west, an open gate leading north, and an open gate leading south',
  'This is a large, barn-like building on an elephantine scale.'
);
const STALL_S = block(
  'Stall',
  'an open gate leading south',
  'Wooden walls separate this stall from the rest of the stable.'
);
const PARADE = block(
  'Parade Ground',
  'south, north, west, and east',
  'This is a large, flagstone paved courtyard within the walls of the Citadel.'
);

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// ---------------------------------------------------------------------------
// Scenario A — dead move at queue head, arrival exits contradict it
// ---------------------------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(SALON, '0:0,0', (t += 1000));
  const salonId = map.pos!.roomId;
  // `w` is refused by the eunuch (no recognizable failure line), `s` succeeds
  loc.trackCommand('w', (t += 1000));
  loc.trackCommand('s', (t += 500));
  const res = loc.onRoomBlock(GARDEN, '0:0,0', (t += 500));
  const town = map.get(map.pos!.townId)!;
  const salon = town.rooms.get(salonId)!;
  const garden = map.room(map.pos!)!;
  check(res.kind === 'new-room', `A: garden resolved as ${res.kind}, expected new-room`);
  check(garden.name === 'Garden Courtyard', 'A: not standing in the garden');
  check(salon.links.s === garden.id, 'A: salon south link must point at the garden');
  check(salon.links.w === undefined, 'A: salon west link must NOT exist (dead move consumed it)');
  check(garden.y === salon.y + 1 && garden.x === salon.x, 'A: garden must sit SOUTH of the salon');
  // Walk back and forth — no duplicates may appear
  loc.trackCommand('n', (t += 1000));
  loc.onRoomBlock(SALON, '0:0,0', (t += 500));
  loc.trackCommand('w', (t += 1000)); // eunuch again
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(GARDEN, '0:0,0', (t += 500));
  const gardens = [...town.rooms.values()].filter((r) => r.name === 'Garden Courtyard');
  check(gardens.length === 1, `A: ${gardens.length} Garden Courtyards, expected 1`);
}

// ---------------------------------------------------------------------------
// Scenario B — twin row must not steal a neighbor's satellite stall
// ---------------------------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(PARADE, '0:0,0', (t += 1000));
  const step = (cmd: string, b: TownRoomBlock) => {
    loc.trackCommand(cmd, (t += 1000));
    return loc.onRoomBlock(b, '0:0,0', (t += 500));
  };
  step('w', STABLES_MID);
  const segA = map.pos!.roomId;
  step('w', STABLES_MID);
  const segB = map.pos!.roomId;
  step('e', STABLES_MID);
  check(map.pos!.roomId === segA, 'B: walking back east must return to segment A');
  step('n', STALL_S);
  const stallA = map.pos!.roomId;
  step('s', STABLES_MID);
  check(map.pos!.roomId === segA, 'B: leaving the stall must return to segment A');
  step('w', STABLES_MID);
  check(map.pos!.roomId === segB, 'B: back at segment B');
  const resStallB = step('n', STALL_S);
  const stallB = map.pos!.roomId;
  check(stallB !== stallA, "B: segment B's stall must NOT reuse segment A's stall");
  check(
    resStallB.kind === 'new-room',
    `B: B-stall resolved as ${resStallB.kind}, expected new-room`
  );
  step('s', STABLES_MID);
  check(map.pos!.roomId === segB, 'B: leaving the B stall must return to segment B (not A)');
  const town = map.get(map.pos!.townId)!;
  check(town.rooms.get(segB)!.links.n === stallB, 'B: segment B north link must be its own stall');
  check(
    town.rooms.get(segA)!.links.n === stallA,
    'B: segment A north link must stay its own stall'
  );
}

// ---------------------------------------------------------------------------
// Scenario C — poison wrong-direction link is severed on load, then healed
// ---------------------------------------------------------------------------
{
  // Hand-build a scarred save: Garden Courtyard (exits only [n]) wired WEST
  // of the Salon — the pre-fix outcome of Scenario A.
  const mkRoom = (id: number, b: TownRoomBlock, x: number, y: number) => ({
    id,
    name: b.name,
    descFirst: b.descFirst,
    desc: b.desc,
    x,
    y,
    z: 0,
    exits: b.exits.dirs,
    exitsEver: [...b.exits.dirs],
    doorDirs: [],
    openDoorDirs: [],
    namedExits: [],
    portal: false,
    icon: null,
    links: {} as Record<string, number>,
    namedLinks: {},
    visits: 2,
    lastSeen: 1000,
    notes: '',
  });
  const salon = mkRoom(0, SALON, 0, 0);
  const garden = mkRoom(1, GARDEN, -1, 0);
  salon.links.w = 1; // poison: garden has no east exit back
  garden.links.e = 0;
  const store = TownMapStore.deserialize({
    v: 2,
    nextTownId: 1,
    pos: { townId: 0, roomId: 0 },
    towns: [
      {
        id: 0,
        name: 'Blue Pearl',
        anchors: {},
        nextRoomId: 2,
        entryRoomId: 0,
        rooms: [salon, garden],
      },
    ],
  });
  const town = store.get(0)!;
  check(town.rooms.get(0)!.links.w === undefined, 'C: poison west link must be severed on load');
  check(
    town.rooms.get(1)!.links.e === undefined,
    'C: poison east back-link must be severed on load'
  );
  // The next true southern arrival must HEAL (reuse), not duplicate
  const loc = new TownLocalizer(store);
  let t = 1000;
  loc.onRoomBlock(SALON, '0:0,0', (t += 1000)); // resume in the salon
  loc.trackCommand('s', (t += 1000));
  loc.onRoomBlock(GARDEN, '0:0,0', (t += 500));
  check(store.pos!.roomId === 1, 'C: southern arrival must reuse the mapped garden');
  check(town.rooms.get(0)!.links.s === 1, 'C: salon south link must be healed onto the garden');
  check(
    [...town.rooms.values()].filter((r) => r.name === 'Garden Courtyard').length === 1,
    'C: garden must not duplicate after the cleanse'
  );
}

// ---------------------------------------------------------------------------
// Scenario D — genuinely non-reciprocal arrival still maps under its move
// ---------------------------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const COVE = block('Cove', 'up and south', 'A sheltered cove beneath the cliffs.');
  const PATH = block('Path', 'down and north', 'A steep path winding down the bluff.');
  loc.onRoomBlock(COVE, '0:0,0', (t += 1000));
  const coveId = map.pos!.roomId;
  loc.trackCommand('u', (t += 1000));
  // Arrival lists no 'd' back — sloped trail remaps the return to 'n'.
  // With nothing better queued the move must be trusted (create + link).
  const res = loc.onRoomBlock(PATH, '0:0,0', (t += 500));
  check(res.kind === 'new-room', `D: sloped arrival resolved as ${res.kind}, expected new-room`);
  const town = map.get(map.pos!.townId)!;
  check(town.rooms.get(coveId)!.links.u === map.pos!.roomId, 'D: cove up link must be recorded');
}

if (failures > 0) process.exit(1);
console.log('PASS — soft-fail desync repaired, twin satellites stay separate, scarred saves heal');
