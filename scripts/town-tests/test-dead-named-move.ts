/**
 * Regression test: dead named moves (Oct 2026 deep dive, identity lens).
 * DartMUD answers an impossible "enter X" / "out" with "What ?" or "Enter
 * what?" — never a movement-failure line — and Bill's multi-try aliases
 * send several named moves at once ("port" = activate portal + enter
 * portal; "eg" = enter glade / enter graveyard / enter grave). The dead
 * named move at the queue head used to be consumed by the NEXT block: 27 of
 * the 38 named links in the corpus replay were false ("enter portal" links
 * between market rooms, rooms linked to themselves, the Ferry Landing
 * filed as an "enter portal" satellite of Wharf Street instead of east of
 * it), and three of them sat in Bill's live save.
 *
 *  1. `port` on Wharf Street (session_2026-07-04T13-54-29-349.log:296):
 *     "What ?" twice, then `e` to the Ferry Landing — linked EAST, no named
 *     link, nothing left queued. Also without any reply (a portal command
 *     still queued when a block arrives failed by construction), and when
 *     the next step is a named exit (`port` then `out`).
 *  2. A dead named move followed by a look's re-print: no self-link, no room.
 *  3. `eg` in the graveyard field (session_2026-07-18T01-32-16-462.log:16785):
 *     "What ?" x2, then the grave works — the link carries "enter grave".
 *  4. The same burst when the first "What ?" went to an ordinary command
 *     sent just before it: the replies can no longer be attributed, so the
 *     surviving tries are alternatives and NO link is recorded (a wrong one
 *     would send a walk through a command that fails).
 *  5. What is a move: upper-case commands are not (DartMUD is case-sensitive:
 *     every upper-case command in the corpus drew "What ?"); movement verbs
 *     are ("lead e" in Leading mode, "leap east", "swim n" — not "row n", which
 *     rows the boat); "climb branch" and "in" are exits; "leave" is the party
 *     command.
 *  6. A dead named move whose "What ?" was not attributable, followed by a
 *     direction typed ahead: the arrival lists that direction's way back, so
 *     the direction explains the block — not a first use of the named exit.
 *     But NOT when the arrival lists a named exit too: a WORKING "enter inn"
 *     with "n" typed ahead lands in a lobby with "out, north, and south",
 *     which fits both moves — the named move keeps it. Nor for a direction
 *     the room left doesn't have.
 *  7. A named exit's first use among look-alikes (same name and exits): never
 *     the room it leaves, and between twins by description — a passage from
 *     the plaza center that comes out on its east side reuses that room
 *     instead of duplicating it (the old search took only two candidates,
 *     current included, and created a room whenever that was not unique).
 *     Current still counts as a look-alike, though: a door from one market
 *     side onto an unmapped third side must not be filed onto the one other
 *     mapped twin (a false link, and the twin's description overwritten);
 *     a lone look-alike whose readable description disagrees is no
 *     destination either; and with more look-alikes than the search takes,
 *     a description agreement inside the cut proves nothing.
 *  8. A walked named link that explains the block keeps its move against the
 *     dead-head rules (a later direction's way back listed, a re-print of a
 *     room word-identical to the one it leads to).
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer, classifyTownCommand } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 70),
  desc,
  exits: parseTownExits(exits),
});
// Real texts (Eris, July 2026)
const WHARF = block(
  'Wharf Street',
  'There are two exits: east and west.',
  'This is a cobblestone paved street leading between the ferry landing to the east the market square to the west.  Buildings on either side of the street seem to be warehouses.  It is painfully bright.'
);
const FERRY = block(
  'Ferry Landing',
  'There is one obvious exit: west.',
  'This is lakeside dock on the shore of the Sea of Eris.  The dock juts out into the water supported by stout pilings.  A cobblestone road leads west towards the market square of a burgeoning town.  It is painfully bright.'
);
const FIELD = block(
  'Field',
  'There are three exits: east, south, and west.',
  'You are standing in an open field.  Frantic digging has exposed a number of old graves here.  It is bright.'
);
const SEPULCHER = block(
  'Sepulcher Entrance',
  'There is one obvious exit: out.',
  'This is a gloomy hollow in the earth which slopes harshly downward into a tunnel on the far side of the entrance.  The floor is littered with pieces of bone.  It is shadowy.'
);

let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
};
const rooms = (map: TownMapStore) => [...map.towns.values()].flatMap((t) => [...t.rooms.values()]);

// 1. "port" (activate portal + enter portal → "What ?" x2) then "e"
for (const replies of [0, 2]) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1_000_000;
  loc.onRoomBlock(WHARF, '0:1,1', t);
  loc.trackCommand('activate portal', (t += 100));
  loc.trackCommand('enter portal', t);
  for (let i = 0; i < replies; i++) loc.onUnknownCommand(null);
  loc.trackCommand('e', (t += 500));
  const res = loc.onRoomBlock(FERRY, null, (t += 300));
  const wharf = rooms(map).find((r) => r.name === 'Wharf Street')!;
  const ferry = map.room(res.pos)!;
  const tag = `1 (${replies} replies)`;
  check(ferry.name === 'Ferry Landing', `${tag}: arrival should be the Ferry Landing`);
  check(res.kind === 'new-room' && res.moved?.kind === 'dir', `${tag}: resolved ${res.kind}`);
  check(wharf.links.e === ferry.id, `${tag}: Ferry Landing should be linked EAST of Wharf Street`);
  check(Object.keys(wharf.namedLinks).length === 0, `${tag}: no "enter portal" named link`);
  check(ferry.x === wharf.x + 1 && ferry.y === wharf.y, `${tag}: Ferry Landing one cell east`);
  check(loc.pendingMoves.length === 0, `${tag}: ${loc.pendingMoves.length} moves left queued`);
}
// ... and when the next step is a NAMED exit (no direction to explain the
// block): `port` in the sepulcher, then `out` to the field
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1_500_000;
  loc.onRoomBlock(FIELD, '0:1,2', t);
  const step = (cmd: string, b: TownRoomBlock) => {
    loc.trackCommand(cmd, (t += 1000));
    return loc.onRoomBlock(b, null, (t += 300));
  };
  step('enter grave', SEPULCHER);
  step('out', FIELD);
  step('enter grave', SEPULCHER);
  const sepulcher = map.room(map.pos)!;
  loc.trackCommand('activate portal', (t += 1000));
  loc.trackCommand('enter portal', t);
  const res = step('out', FIELD);
  check(res.kind === 'expected' && res.moved?.kind === 'named', `1b: out resolved ${res.kind}`);
  check(sepulcher.namedLinks['enter portal'] === undefined, '1b: no "enter portal" link');
  check(loc.pendingMoves.length === 0, '1b: queue drained');
}

// 2. Dead named move followed by a re-print of the same room: no self-link
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 2_000_000;
  loc.onRoomBlock(FIELD, '0:2,2', t);
  loc.trackCommand('enter path', (t += 100));
  loc.trackCommand('l', (t += 1500));
  const res = loc.onRoomBlock(FIELD, null, (t += 200));
  const field = map.room(res.pos)!;
  check(res.kind === 'stationary', `2: re-print resolved ${res.kind}`);
  check(
    field.namedLinks['enter path'] === undefined,
    '2: a room must never get a named link to itself'
  );
  check(rooms(map).length === 1, '2: re-print must not create rooms');
  check(loc.pendingMoves.length === 0, '2: the look was consumed with the re-print');
}

// 3. "eg" → enter glade / enter graveyard ("What ?" x2) / enter grave (works)
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 3_000_000;
  loc.onRoomBlock(FIELD, '0:3,3', t);
  for (const c of ['enter glade', 'enter graveyard', 'enter grave']) loc.trackCommand(c, (t += 2));
  check(loc.onUnknownCommand(null), '3: first "What ?" fails "enter glade"');
  check(loc.onUnknownCommand(null), '3: second "What ?" fails "enter graveyard"');
  const res = loc.onRoomBlock(SEPULCHER, null, (t += 400));
  const field = rooms(map).find((r) => r.name === 'Field')!;
  check(res.kind === 'new-room', `3: grave resolved ${res.kind}`);
  check(
    field.namedLinks['enter grave'] === map.room(res.pos)!.id &&
      Object.keys(field.namedLinks).length === 1,
    `3: the named link must carry the command that worked (${JSON.stringify(field.namedLinks)})`
  );
}

// 4. Same burst, but an ordinary command sent first draws no "What ?" of its
//    own: its reply cannot be told from the tries' — no link, no guess
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 4_000_000;
  loc.onRoomBlock(FIELD, '0:4,4', t);
  loc.trackCommand('light pipe', (t += 100)); // answered with prose, not "What ?"
  for (const c of ['enter glade', 'enter graveyard', 'enter grave']) loc.trackCommand(c, (t += 2));
  check(!loc.onUnknownCommand(null), '4: first "What ?" is credited to the earlier command');
  check(loc.onUnknownCommand(null), '4: second "What ?" fails the head');
  const res = loc.onRoomBlock(SEPULCHER, null, (t += 400));
  const field = rooms(map).find((r) => r.name === 'Field')!;
  check(map.room(res.pos)?.name === 'Sepulcher Entrance', '4: standing in the Sepulcher Entrance');
  check(
    Object.keys(field.namedLinks).length === 0,
    `4: an unattributable burst records no link (${JSON.stringify(field.namedLinks)})`
  );
  check(loc.pendingMoves.length === 0, '4: the tries are consumed together');
}

// 5. What is a move
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(FIELD, '0:5,5', 5_000_000);
  check(!loc.trackCommand('OUT', 5_000_100), '5: "OUT" draws "What ?" and must not be queued');
  check(!loc.trackCommand('U', 5_000_200), '5: "U" draws "What ?" and must not be queued');
  check(!loc.trackCommand('Enter grave', 5_000_300), '5: "Enter grave" is not a move');
  check(loc.trackCommand('enter grave', 5_000_400), '5: "enter grave" is');
  const kind = (c: string) => {
    const m = classifyTownCommand(c, 0);
    return !m
      ? 'none'
      : m.kind === 'dir'
        ? `dir:${m.dir}`
        : m.kind === 'named'
          ? `named:${m.cmd}`
          : m.kind;
  };
  const expected: [string, string][] = [
    ['lead e', 'dir:e'],
    ['sneak w', 'dir:w'],
    ['leap east', 'dir:e'],
    ['swim n', 'dir:n'],
    ['climb down', 'dir:d'],
    ['go  south', 'dir:s'],
    ['row n', 'none'],
    ['lead out', 'named:out'],
    ['climb branch', 'named:climb branch'],
    ['in', 'named:in'],
    ['leave party', 'none'],
    ['W', 'none'],
    ['L', 'none'],
  ];
  for (const [c, want] of expected)
    check(kind(c) === want, `5: "${c}" -> ${kind(c)}, want ${want}`);
}

// 6. A dead named move, then a direction typed ahead that explains the block
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 6_000_000;
  loc.onRoomBlock(WHARF, '0:6,6', t);
  loc.trackCommand('enter warehouse', (t += 100)); // no such thing here: "What ?" ...
  loc.trackCommand('e', (t += 300)); // ... that never arrived as a line we could attribute
  const res = loc.onRoomBlock(FERRY, null, (t += 300));
  const wharf = rooms(map).find((r) => r.name === 'Wharf Street')!;
  check(res.kind === 'new-room' && res.moved?.kind === 'dir', `6: Ferry Landing ${res.kind}`);
  check(wharf.links.e === map.room(res.pos)!.id, '6: Ferry Landing linked east');
  check(Object.keys(wharf.namedLinks).length === 0, '6: no "enter warehouse" link');
  check(loc.pendingMoves.length === 0, '6: queue drained');
}
// ... but a WORKING first use with a direction typed ahead into a room that
// lists a named exit: the block fits the named move as well
{
  const STREET = block(
    'Jacinth Street',
    'There are four exits: north, south, east, and west.',
    'A wide street paved with pale stone runs between rows of shops.  It is bright.'
  );
  const LOBBY = block(
    'Inn Lobby',
    'There are three exits: out, north, and south.',
    'The lobby of a busy inn.  A corridor runs north and south.  It is bright.'
  );
  const CORRIDOR = block(
    'Corridor',
    'There are two exits: north and south.',
    'A narrow corridor lined with guest rooms.  It is dim.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 6_500_000;
  loc.onRoomBlock(STREET, '0:6,7', t);
  const street = map.room(map.pos)!;
  loc.trackCommand('enter inn', (t += 100));
  loc.trackCommand('n', (t += 400)); // typed ahead, meant for inside the inn
  const r1 = loc.onRoomBlock(LOBBY, null, (t += 300));
  const lobby = map.room(r1.pos)!;
  const r2 = loc.onRoomBlock(CORRIDOR, null, (t += 300));
  check(r1.kind === 'new-room' && r1.moved?.kind === 'named', `6b: lobby ${r1.kind}`);
  check(street.namedLinks['enter inn'] === lobby.id, '6b: street -[enter inn]-> lobby');
  check(street.links.n === undefined, '6b: the lobby is not linked north of the street');
  check(r2.kind === 'new-room' && lobby.links.n === r2.pos?.roomId, `6b: corridor ${r2.kind}`);
}
// ... nor does a direction typed ahead that the room left doesn't have
{
  const LANE = block(
    'Tanner Lane',
    'There are three exits: north, east, and west.',
    'A reeking lane lined with tanning vats and drying racks.  It is bright.'
  );
  const LOFT = block(
    'Drying Loft',
    'There are two exits: north and south.',
    'Hides hang from the rafters of the drying loft to cure.  It is bright.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 6_700_000;
  loc.onRoomBlock(LANE, '0:6,8', t);
  const lane = map.room(map.pos)!;
  loc.trackCommand('climb ladder', (t += 100));
  loc.trackCommand('s', (t += 400)); // the lane has no south
  const res = loc.onRoomBlock(LOFT, null, (t += 300));
  check(res.kind === 'new-room' && res.moved?.kind === 'named', `6c: loft ${res.kind}`);
  check(lane.namedLinks['climb ladder'] === res.pos?.roomId, '6c: lane -[climb ladder]-> loft');
}

// 7. First use of a named exit among look-alikes
{
  const twin = (side: string) =>
    block(
      'Market',
      'There are four exits: north, south, east, and west.',
      `This is a spacious market square in the heart of Eris.  This is the ${side} of the market.  It is bright.`
    );
  const WEST = twin('west side');
  const EAST = twin('east side');
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 7_000_000;
  loc.onRoomBlock(WEST, '0:7,7', t);
  const west = map.room(map.pos)!;
  loc.trackCommand('e', (t += 100));
  loc.onRoomBlock(twin('center'), null, (t += 300));
  loc.trackCommand('e', (t += 100));
  loc.onRoomBlock(EAST, null, (t += 300));
  const east = map.room(map.pos)!;
  loc.trackCommand('w', (t += 100));
  loc.onRoomBlock(twin('center'), null, (t += 300));
  const center = map.room(map.pos)!;
  const town = map.get(map.pos!.townId)!;
  const before = town.rooms.size;
  // A booth door at the center that leads out onto the east side
  loc.trackCommand('enter booth', (t += 100));
  const res = loc.onRoomBlock(EAST, null, (t += 300));
  check(map.room(res.pos)?.id === east.id, `7: reused the east side (#${map.room(res.pos)?.id})`);
  check(town.rooms.size === before, `7: no duplicate Market (${before} -> ${town.rooms.size})`);
  check(center.namedLinks['enter booth'] === east.id, '7: center -[enter booth]-> east side');
  check(west.namedLinks['enter booth'] === undefined, '7: not linked from the west side');
  // ... and onto an unmapped twin of the room it leaves: a new room, never
  // the room itself (the only strict match nearby is current)
  loc.trackCommand('enter door', (t += 100));
  const r2 = loc.onRoomBlock(twin('north side'), null, (t += 300));
  const east2 = town.rooms.get(east.id)!;
  check(r2.kind === 'new-room' && r2.pos?.roomId !== east.id, `7: unmapped twin ${r2.kind}`);
  check(east2.namedLinks['enter door'] === r2.pos?.roomId, '7: east side -[enter door]-> the twin');
}
// ... even when the room left is the only look-alike mapped
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const SHED = block(
    'Shed',
    'There is one obvious exit: out.',
    'A cramped wooden shed that smells of tar and old rope.  It is dim.'
  );
  const LOFT = block(
    'Shed',
    'There is one obvious exit: out.',
    'The loft of a wooden shed, stacked with coils of old rope.  It is dim.'
  );
  let t = 7_500_000;
  loc.onRoomBlock(SHED, '0:7,8', t);
  const shed = map.room(map.pos)!;
  loc.trackCommand('climb ladder', (t += 100));
  const res = loc.onRoomBlock(LOFT, null, (t += 300));
  check(res.kind === 'new-room' && res.pos?.roomId !== shed.id, `7: loft resolved ${res.kind}`);
  check(shed.namedLinks['climb ladder'] === res.pos?.roomId, '7: shed -[climb ladder]-> loft');
}
// ... but the room left still COUNTS as a look-alike, and a lone look-alike
// whose readable description disagrees is no destination
{
  const MARKET_EXITS = 'There are four exits: north, south, east, and west.';
  const side = (s: string) =>
    block(
      'Market',
      MARKET_EXITS,
      `This is a spacious market square in the heart of Eris.  This is the ${s} of the market.  It is bright.`
    );
  const DARK_SIDE = block('Market', MARKET_EXITS, 'It is dark.'); // no readable description
  const LANE = block(
    'Spice Lane',
    'There are two exits: east and west.',
    'A narrow lane that smells of cinnamon and cloves.  It is bright.'
  );
  /** A market side -e-> Spice Lane (-e-> the east side), then a first-use
   *  door onto the north side */
  const run = (west: TownRoomBlock, fromEast: boolean) => {
    const map = new TownMapStore();
    const loc = new TownLocalizer(map);
    let t = 7_800_000;
    loc.onRoomBlock(west, '0:7,9', t);
    const westRoom = map.room(map.pos)!;
    const step = (cmd: string, b: TownRoomBlock) => {
      loc.trackCommand(cmd, (t += 100));
      return loc.onRoomBlock(b, null, (t += 300));
    };
    step('e', LANE);
    if (fromEast) step('e', side('east side'));
    const from = map.room(map.pos)!;
    const town = map.get(map.pos!.townId)!;
    const before = town.rooms.size;
    const westDesc = westRoom.desc;
    const res = step('enter door', side('north side'));
    return { res, westRoom, from, town, before, westDesc };
  };
  // From the east side (a look-alike itself), the west side the one other
  // twin mapped: the door leads to an unmapped third side, whether the west
  // side's description disagrees (7c) or was never readable (7d)
  for (const [tag, west] of [
    ['7c', side('west side')],
    ['7d', DARK_SIDE],
  ] as const) {
    const { res, westRoom, from, town, before, westDesc } = run(west, true);
    const id = res.pos?.roomId;
    check(res.kind === 'new-room' && id !== westRoom.id, `${tag}: door ${res.kind} #${id}`);
    check(town.rooms.size === before + 1, `${tag}: the north side is a new room`);
    check(from.namedLinks['enter door'] === id, `${tag}: east side -[enter door]-> new room`);
    check(westRoom.desc === westDesc, `${tag}: the west side's description is untouched`);
  }
  // From the lane (no look-alike), the west side the lone twin mapped: not
  // when its readable description disagrees (7e); reused when it has none
  // to compare (7f)
  {
    const { res, westRoom } = run(side('west side'), false);
    check(res.kind === 'new-room' && res.pos?.roomId !== westRoom.id, `7e: door ${res.kind}`);
  }
  {
    const { res, westRoom, from } = run(DARK_SIDE, false);
    check(res.kind === 'expected' && res.pos?.roomId === westRoom.id, `7f: door ${res.kind}`);
    check(from.namedLinks['enter door'] === westRoom.id, '7f: lane -[enter door]-> west side');
  }
}
// ... and among more look-alikes than the search takes (a row of stalls):
// a description agreement inside the cut is no unique one, so none is reused
{
  const AISLE = block(
    'Stable Aisle',
    'There are two exits: east and west.',
    'A long aisle between two rows of horse stalls.  It is dim.'
  );
  const stall = (plate: string) =>
    block(
      'Stall',
      'There is one obvious exit: out.',
      `A straw-strewn horse stall.  A brass plate on the door reads "${plate}".  It is dim.`
    );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 7_900_000;
  loc.onRoomBlock(AISLE, '0:7,10', t);
  const aisle = map.room(map.pos)!;
  const town = map.get(map.pos!.townId)!;
  // Ten mapped stalls; the first and the last are word-identical to the
  // one the door leads to
  const plates = ['Dancer', 'Blaze', 'Comet', 'Cupid', 'Donner', 'Vixen', 'Prancer', 'Rudolph'];
  for (const [i, plate] of ['Dasher', ...plates, 'Dasher'].entries()) {
    map.addRoom(town, stall(plate), aisle.x - 2 + (i % 5), aisle.y + 1 + Math.floor(i / 5), 0, t);
  }
  const before = town.rooms.size;
  loc.trackCommand('enter stall', (t += 100));
  const res = loc.onRoomBlock(stall('Dasher'), null, (t += 300));
  check(res.kind === 'new-room', `7g: stall door ${res.kind}`);
  check(town.rooms.size === before + 1, '7g: a new stall, no guess between the two Dashers');
}

// 8. A walked named link that explains the block keeps its move
{
  const STREET = block(
    'Rope Walk',
    'There are four exits: north, south, east, and west.',
    'A long straight street where ropemakers twist hemp into cables.  It is bright.'
  );
  const LOFT = block(
    'Rigging Loft',
    'There are two exits: north and south.',
    'A loft high above the street, hung with coils of finished rope.  It is bright.'
  );
  const LOFT_N = block(
    'Sail Loft',
    'There is one obvious exit: south.',
    'Bolts of canvas lie stacked under the rafters of the sail loft.  It is bright.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 8_000_000;
  loc.onRoomBlock(STREET, '0:8,8', t);
  const street = map.room(map.pos)!;
  loc.trackCommand('climb rope', (t += 100));
  const first = loc.onRoomBlock(LOFT, null, (t += 300));
  const loft = map.room(first.pos)!;
  check(street.namedLinks['climb rope'] === loft.id, '8: street -[climb rope]-> loft');
  // Back on the street (a hidden way down), "climb rope" + "n" typed ahead:
  // the loft lists the way back of "n" and the street has "n", but the walked
  // link explains the block
  map.pos = { townId: map.pos!.townId, roomId: street.id };
  loc.trackCommand('climb rope', (t += 1000));
  loc.trackCommand('n', (t += 300));
  const r1 = loc.onRoomBlock(LOFT, null, (t += 300));
  const r2 = loc.onRoomBlock(LOFT_N, null, (t += 300));
  check(r1.kind === 'expected' && r1.moved?.kind === 'named', `8: loft again ${r1.kind}`);
  check(r1.pos?.roomId === loft.id && street.links.n === undefined, '8: not north of the street');
  check(r2.kind === 'new-room' && loft.links.n === r2.pos?.roomId, `8: sail loft ${r2.kind}`);
  // ... and when it leads to a room word-identical to the one it leaves (no
  // readable description: the block is a "re-print" of both)
  const CRAWL = block('Crawlspace', 'There is one obvious exit: north.', 'It is dark.');
  const town = map.get(map.pos!.townId)!;
  const a = map.addRoom(town, CRAWL, 5, 5, 0, t);
  const b = map.addRoom(town, CRAWL, 5, 6, 0, t);
  map.linkNamed(a, 'enter hole', b);
  map.pos = { townId: town.id, roomId: a.id };
  loc.trackCommand('enter hole', (t += 1000));
  const r3 = loc.onRoomBlock(CRAWL, null, (t += 300));
  check(r3.kind === 'expected' && r3.pos?.roomId === b.id, `8: through the hole ${r3.kind}`);
}

if (failed > 0) {
  console.error(`${failed} dead-named-move assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: dead named moves never become links; case-sensitive commands');
