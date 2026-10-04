/**
 * Regression test (wrong-room lens, Oct 2026): queue-attribution bugs that
 * put the player in the WRONG room, each reproduced from Bill's session
 * logs.
 *
 * P — exits-sanity swallow (Soriktos, Blue Pearl garden pool,
 *     session_2026-08-25T01-56-18-669.log:16860-17580). Failed swims pile
 *     dead `n`s up in the queue. At the shallow end (exits: out, south) with
 *     queue [n, n, s], the block for the real `s` (the middle of the pool)
 *     used to be declared STATIONARY after dropping a single dead `n`
 *     (name-only match): the shallow end took the middle's exits, and every
 *     later lap minted another "shallow end" one cell further north (12 Pool
 *     rooms in the corpus, 2 real).
 * Q — stale portal command (Eris, session_2026-08-06T14-16-16-246.log:8402).
 *     Bill's `port` alias sends "enter portal"; outside a portal room the
 *     command fails, and its block-time stand-in, the NEXT move's block, was
 *     consumed as its destination: a false named link "Market -[enter
 *     portal]-> Wharf Street" and the real `e` left queued.
 * R — portal type-ahead (Eris, session_2026-07-22T15-17-21-924.log:2066).
 *     `port n` then `w` typed BEFORE "You step into the north portal." — the
 *     transit cleared the whole queue, so the `w` into the market's SE corner
 *     had no move to explain it.
 * S — a dead move in a room with a NAMED exit (the galley, session_2026-07-
 *     25T20-28-24-529.log:5303): "You try to descend into the hold, but an
 *     awful stench repels you." then a look — the re-print used to be filed
 *     as a phantom Oar Deck one floor down (the queue repair skipped every
 *     block with a named exit).
 * T — queue overflow keeps the oldest moves: in a lag spike the server still
 *     runs every command in order (session_2026-09-28T14-32-22-078.log:7175,
 *     `port n` and a dozen moves typed into 4 s of lag), so dropping the
 *     OLDEST lost the portal command and the transit kept nothing.
 * U — exits sanity in a room whose exits line lists only named exits: a
 *     stray `n` that failed unrecognized in a shop ("There is one obvious
 *     exit: out.") used to be filed as a move north when `out` brought the
 *     player back to the street.
 * V — ... but a walked link outranks a state-truncated exits line: the
 *     Gatehouse loses its north exit while the portcullis is down, and an `n`
 *     sent once it is raised again (no re-print in between) is a move.
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

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// ---------------------------------------------------------------------------
// P — dead moves must not turn a real move into "stationary"
// ---------------------------------------------------------------------------
{
  const GARDEN = block(
    'Garden Courtyard',
    'north',
    'This is a tranquil courtyard filled with exotic flowers and trees covered with blossoms.  In the center of the courtyard is a large pool.  It is dimly lit.'
  );
  const SHALLOW = block(
    'Pool',
    'out and south',
    'The shallow end of the pool.  It is dimly lit.  The air is quite warm.'
  );
  const MIDDLE = block(
    'Pool',
    'north and south',
    'The middle of the pool.  It is shallow, but gets deeper to the south.  It is dimly lit.  The air is quite warm.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(GARDEN, '0:0,0', (t += 1000));
  loc.trackCommand('enter pool', (t += 1000));
  loc.onRoomBlock(SHALLOW, '0:0,0', (t += 500));
  const shallowId = map.pos!.roomId;
  loc.trackCommand('s', (t += 1000));
  loc.onRoomBlock(MIDDLE, '0:0,0', (t += 500));
  const middleId = map.pos!.roomId;
  loc.trackCommand('n', (t += 1000));
  loc.onRoomBlock(SHALLOW, '0:0,0', (t += 500));
  check(map.pos!.roomId === shallowId, 'P: back at the shallow end');
  // Two dead n's (failed swims nobody recognized), then a real s
  loc.trackCommand('n', (t += 500));
  loc.trackCommand('n', (t += 500));
  loc.trackCommand('s', (t += 500));
  const res = loc.onRoomBlock(MIDDLE, '0:0,0', (t += 500));
  check(
    map.pos!.roomId === middleId,
    `P: resolved to #${map.pos!.roomId} (${res.kind}), expected the middle #${middleId}`
  );
  const town = map.get(map.pos!.townId)!;
  const shallow = town.rooms.get(shallowId)!;
  check(shallow.exits.join(',') === 's', `P: shallow end exits corrupted to [${shallow.exits}]`);
  // Next lap: swim north to the shallow end — must not mint a new Pool room
  loc.trackCommand('n', (t += 1000));
  loc.onRoomBlock(SHALLOW, '0:0,0', (t += 500));
  const pools = [...town.rooms.values()].filter((r) => r.name === 'Pool');
  check(pools.length === 2, `P: ${pools.length} Pool rooms, expected 2`);
  // A dead n, then s typed: a re-print arriving first is the shallow end
  // again (stationary) — the s waits for its own block instead of taking
  // the re-print (which would overwrite the middle's exits with these)
  loc.trackCommand('n', (t += 500));
  loc.trackCommand('s', (t += 500));
  const r2 = loc.onRoomBlock(SHALLOW, '0:0,0', (t += 300));
  check(r2.kind === 'stationary' && map.pos!.roomId === shallowId, `P: re-print ${r2.kind}`);
  const q = loc.pendingMoves;
  check(q.length === 1 && q[0].kind === 'dir' && q[0].dir === 's', 'P: the s stays queued');
  loc.onRoomBlock(MIDDLE, '0:0,0', (t += 300));
  const middle = town.rooms.get(middleId)!;
  check(map.pos!.roomId === middleId, 'P: the s block is the middle');
  check(middle.exits.join(',') === 'n,s', `P: middle exits [${middle.exits}]`);
  // From the shallow end: a dead n and a look — the re-print is the look's,
  // so the look is spent with it and the next s resolves on its own block
  loc.trackCommand('n', (t += 500));
  loc.onRoomBlock(SHALLOW, '0:0,0', (t += 300));
  loc.trackCommand('n', (t += 500));
  loc.trackCommand('l', (t += 500));
  const r3 = loc.onRoomBlock(SHALLOW, '0:0,0', (t += 300));
  check(r3.kind === 'stationary' && loc.pendingMoves.length === 0, `P: dead n + look ${r3.kind}`);
  loc.trackCommand('s', (t += 500));
  const r4 = loc.onRoomBlock(MIDDLE, '0:0,0', (t += 300));
  check(r4.kind === 'expected' && map.pos!.roomId === middleId, `P: then s resolved ${r4.kind}`);
  check(shallow.exits.join(',') === 's', `P: shallow end exits [${shallow.exits}]`);
}

// ---------------------------------------------------------------------------
// Q — a failed "enter portal" must not explain the next move's block
// ---------------------------------------------------------------------------
{
  const MARKET_E = block(
    'Market',
    'north, south, west, and east',
    'This is a spacious market square in the heart of Eris.  This is the east side of the market and a cobblestone road east leads towards a ferry landing on the shore of the Sea of Eris.  It is bright.'
  );
  const WHARF = block(
    'Wharf Street',
    'east and west',
    'This is a cobblestone paved street leading between the ferry landing to the east the market square to the west.  It is bright.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(MARKET_E, '0:0,0', (t += 1000));
  const marketId = map.pos!.roomId;
  loc.trackCommand('enter portal', (t += 1000)); // "What ?" (not attributed)
  loc.trackCommand('e', (t += 500));
  const res = loc.onRoomBlock(WHARF, '0:0,0', (t += 500));
  const town = map.get(map.pos!.townId)!;
  const market = town.rooms.get(marketId)!;
  check(res.kind === 'new-room', `Q: wharf resolved as ${res.kind}, expected new-room via e`);
  check(
    market.namedLinks['enter portal'] === undefined,
    'Q: false named link Market -[enter portal]->'
  );
  check(market.links.e === map.pos!.roomId, 'Q: market east link must point at Wharf Street');
  check(loc.pendingMoves.length === 0, `Q: ${loc.pendingMoves.length} stale moves left queued`);
}

// ---------------------------------------------------------------------------
// R — moves typed after the portal command survive the transit
// ---------------------------------------------------------------------------
const CHAMBER = block(
  'Portal Chamber',
  'east',
  'This is a large open room ringed by seven arch-shaped portals of some dark bluish stone, one at each of the compass points except for east.  It is bright.'
);
const FORECOURT = block(
  'Forecourt',
  'west and an open set of oaken double doors leading east',
  'This is a cobblestone paved courtyard in front of the Luminarian church.  To the south side is an arch-like portal.  A sheet of silvery-white fire fills the portal.  It is bright.'
);
const SE_CORNER = block(
  'Market',
  'north, west, northwest, east, and southeast',
  'This is a spacious market square in the heart of Eris.  This appears to be the southeastern corner of the market.  To the east is a courtyard leading to a Luminarian church.  It is bright.'
);
{
  const S_EDGE = block(
    'Market',
    'north, east, and west',
    'This is a spacious market square in the heart of Eris.  This appears to be the southern edge of the market.  It is bright.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(CHAMBER, null, (t += 1000));
  loc.trackCommand('enter n portal', (t += 1000));
  loc.trackCommand('w', (t += 300)); // typed before the transit line
  loc.onPortalTransit('north');
  loc.onRoomBlock(FORECOURT, null, (t += 300));
  const forecourtPos = map.pos!;
  const r1 = loc.onRoomBlock(SE_CORNER, null, (t += 300));
  const town = map.get(forecourtPos.townId)!;
  const forecourt = town.rooms.get(forecourtPos.roomId)!;
  check(r1.kind === 'new-room', `R: SE corner resolved as ${r1.kind}, expected new-room via w`);
  check(
    forecourt.links.w === map.pos!.roomId,
    'R: Forecourt west link must point at the SE corner'
  );
  const seId = map.pos!.roomId;
  loc.trackCommand('w', (t += 300));
  loc.onRoomBlock(S_EDGE, null, (t += 300));
  const se = town.rooms.get(seId)!;
  check(se.links.w === map.pos!.roomId, 'R: SE corner west link must point at the southern edge');
  check(se.links.n === undefined, 'R: SE corner must not gain a north link from an off-by-one');
}

// ---------------------------------------------------------------------------
// S — a dead move under a re-print of a room with a named exit
// ---------------------------------------------------------------------------
{
  const PIER = block(
    'North Pier',
    'north, south, and west',
    'You are standing on a pier which is part of the main dock.  The shipyard lies to your south, and the land curves around to your north where the lighthouse stands.  It is bright.'
  );
  const DECK = block(
    'Oar Deck',
    'exit and an open hatch leading down',
    'You are on the rowing deck of a galley.  There are eight rows of benches, each with an oar on alternate sides of the ship, so that the ship may be rowed by eight or more strong individuals.  It is bright.'
  );
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(PIER, null, (t += 1000));
  loc.trackCommand('board galley', (t += 1000));
  loc.onRoomBlock(DECK, null, (t += 300));
  const deckId = map.pos!.roomId;
  loc.trackCommand('d', (t += 2000)); // "...an awful stench repels you."
  loc.trackCommand('l', (t += 2000));
  const res = loc.onRoomBlock(DECK, null, (t += 300));
  const decks = [...map.get(map.pos!.townId)!.rooms.values()].filter((r) => r.name === 'Oar Deck');
  check(
    res.kind === 'stationary' && map.pos!.roomId === deckId,
    `S: re-print resolved ${res.kind}`
  );
  check(decks.length === 1, `S: ${decks.length} Oar Decks, expected 1`);
  check(loc.pendingMoves.length === 0, 'S: the dead move and the look are both consumed');
}

// ---------------------------------------------------------------------------
// T — overflow drops the NEWEST move; the portal command survives
// ---------------------------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(CHAMBER, null, (t += 1000));
  loc.trackCommand('enter n portal', (t += 100));
  for (let i = 0; i < 35; i++) loc.trackCommand('w', (t += 100));
  check(loc.pendingMoves[0]?.kind === 'named', 'T: the portal command is still at the head');
  loc.onPortalTransit('north');
  const kept = loc.pendingMoves;
  check(
    kept.length >= 12 && kept.every((m) => m.kind === 'dir'),
    `T: the moves typed after the portal survive (${kept.length} kept)`
  );
  loc.onRoomBlock(FORECOURT, null, (t += 300));
  const forecourt = map.room(map.pos)!;
  loc.onRoomBlock(SE_CORNER, null, (t += 300));
  check(forecourt.links.w === map.pos!.roomId, 'T: the first kept w links Forecourt -> SE corner');
}

// ---------------------------------------------------------------------------
// U — exits sanity in a room that lists only named exits
// ---------------------------------------------------------------------------
{
  const STREET = block(
    'Jacinth Street',
    'north, south, east, and west',
    'A wide street paved with pale stone runs between rows of shops.  It is bright.'
  );
  const SHOP = block('Gem Shop', 'out', 'A small, plain shop dealing in wares most extravagant.');
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(STREET, null, (t += 1000));
  const streetId = map.pos!.roomId;
  loc.trackCommand('enter shop', (t += 1000));
  loc.onRoomBlock(SHOP, null, (t += 300));
  loc.trackCommand('out', (t += 1000));
  loc.onRoomBlock(STREET, null, (t += 300));
  loc.trackCommand('enter shop', (t += 1000));
  loc.onRoomBlock(SHOP, null, (t += 300));
  const shop = map.room(map.pos)!;
  loc.trackCommand('n', (t += 1000)); // the shop has no north: failed, unrecognized
  loc.trackCommand('out', (t += 1000));
  const res = loc.onRoomBlock(STREET, null, (t += 300));
  check(map.pos!.roomId === streetId, 'U: back on the street');
  check(
    res.kind === 'expected' && res.moved?.kind === 'named',
    `U: arrival ${res.kind} via ${res.moved?.kind}`
  );
  check(shop.links.n === undefined, 'U: no north link out of the shop');
  check(loc.pendingMoves.length === 0, 'U: queue drained');
}

// ---------------------------------------------------------------------------
// V — a walked link outranks a state-truncated exits line
// ---------------------------------------------------------------------------
{
  const GATE =
    'A squat stone gatehouse guards the road into the keep.  A heavy portcullis hangs above the archway to the north.';
  const GATE_UP = block('Gatehouse', 'north and south', GATE);
  const GATE_DOWN = block('Gatehouse', 'south', GATE);
  const BAILEY = block('Bailey', 'north and south', 'The open yard inside the walls of the keep.');
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const step = (cmd: string, b: TownRoomBlock) => {
    loc.trackCommand(cmd, (t += 1000));
    return loc.onRoomBlock(b, null, (t += 300));
  };
  loc.onRoomBlock(GATE_UP, null, (t += 1000));
  const bailey = map.room(step('n', BAILEY).pos)!;
  step('s', GATE_UP);
  step('l', GATE_DOWN); // the portcullis dropped
  const res = step('n', BAILEY); // ... and was raised again
  check(res.kind === 'expected' && res.moved?.kind === 'dir', `V: n resolved ${res.kind}`);
  check(map.pos!.roomId === bailey.id, 'V: in the Bailey');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK wrong-room queue scenarios');
