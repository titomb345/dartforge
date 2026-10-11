/**
 * Regression test: messaged teleports that are not portals (Oct 2026 deep
 * dive: identity / commands / parser / ground-truth lenses).
 *
 * `plane shift` moves the player between a city's OOC Entrance and the OOC
 * Entry Hall ("Your body becomes insubstantial. ..."); the warriors' temple
 * pools move them between the Sanctum and the Cave of Spirits ("You step
 * into the pool and feel power well up ..."). Unrecognized, the arrival was
 * an unexplained block: the OOC realm was filed as floaters INSIDE the city
 * the player shifted from (Bill's live save: a 6-room OOC Area component in
 * Eris; the corpus replay glued 6 OOC rooms into Eris and 11 into Soriktos),
 * and the pool's Cave of Spirits sat in the temple's town under an "enter
 * pool" link — plus two false "enter path" ones from the `ep` alias.
 *
 *  A. The live form (blank lines kept, as OutputFilter hands them over: the
 *     hall frames its notes notice with blank lines) of an Eris round trip,
 *     dm-2026-01-16.txt:263 / dm-2026-02-21.txt:307: the OOC realm is a town
 *     of its own; the shift back lands on the Entrance the player left, and
 *     its walked links survive.
 *  B. Moves typed after `plane shift` run at the destination
 *     (session_2026-08-28T16-24-18-048.log:9175: "s" before the transit
 *     line walks from the Entrance to the Post Office), on a landing by
 *     memory and on a fresh entry alike; a move sent BEFORE it is spent by
 *     the time the transit line arrives.
 *  C. The way back is remembered (TownMapStore.teleportReturn): with the
 *     Entrance duplicated elsewhere, the entry match alone is ambiguous.
 *  D. ... and the memory is persisted (a login inside the OOC realm), follows
 *     a merge, goes with a deleted town or a cleared store, and a bad saved
 *     one is dropped.
 *  E. The temple pool both ways (session_2026-07-01T15-45-27-282.log:13201-
 *     13265, `ep` = enter path + enter pool): the Cave of Spirits is not
 *     filed into the temple, no "enter pool"/"enter path" named links, the
 *     way back lands on the Sanctum. The Blue Pearl's swimming pool, also
 *     "enter pool" but without the transit line, stays a plain named exit.
 *  F. The transit lines themselves.
 *  G. A teleport line and a portal line: the newest one decides how the
 *     arrival resolves; with no teleport command seen, no move is kept; of
 *     two "enter pool" tries queued, the transit line answers the last; and
 *     the transit is the shift's reply, so a "What ?" after it fails the
 *     dead move typed at the destination.
 *  H. The landing on the way back is no positive identification: it
 *     teaches no volatile prose.
 *  I. A remembered way back the arrival does not match is no landing: after
 *     an OOC round trip the next teleport, the temple pool, enters the Cave
 *     of Spirits fresh.
 *  J. A fresh entry by teleport neither learns nor reads the hex the owner
 *     passes (the last survey's: the departure town's way in).
 */
import type { Alias } from '../../src/types/alias';
import { TELEPORT_TRANSIT_RE, TownParser, type TownRoomBlock } from '../../src/lib/townParser';
import { TownLocalizer, type TownResolution } from '../../src/lib/townLocalizer';
import { TownMapStore, type TownRoom } from '../../src/lib/townMap';
import { makeExpander } from '../lib/replayInput';
import { SessionFixture } from '../lib/sessionFixture';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const alias = (pattern: string, body: string): Alias => ({
  id: pattern,
  pattern,
  matchMode: 'exact',
  body,
  bodyMode: 'text',
  enabled: true,
  group: 'Movement',
  createdAt: '2026-02-19T06:04:58.921Z',
  updatedAt: '2026-02-19T06:04:58.921Z',
});
// Bill's alias (frozen aliases.json)
const expand = makeExpander([alias('ep', 'enter path\nenter pool')]);
const fx = new SessionFixture('ooc-transit-');

/** A queue as text: "n,enter pool,look" */
const queueOf = (loc: TownLocalizer) =>
  loc.pendingMoves.map((m) => (m.kind === 'dir' ? m.dir : m.kind === 'named' ? m.cmd : 'look'));

function replay(...texts: string[]) {
  const blocks: { name: string; res: TownResolution }[] = [];
  /** The queue each transit line left */
  const atTransit: string[] = [];
  const r: TownReplay = new TownReplay(
    { expand: (raw) => expand(raw) },
    {
      onBlock: ({ block, res }) => blocks.push({ name: block.name, res }),
      onTeleport: () => atTransit.push(queueOf(r.townLocalizer).join(',')),
    }
  );
  for (const t of texts) r.replayLog(fx.write(t));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const townOf = (room: TownRoom | undefined) =>
    [...r.townMap.towns.values()].find((t) => room && t.rooms.get(room.id) === room);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  const here = (): TownRoom | undefined => r.townMap.room(r.townMap.pos);
  const kinds = () => blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  return { r, blocks, atTransit, rooms, townOf, named, here, kinds };
}

const POST_OFFICE = `|> Eris Post Office
|A plain room with a counter opposite the door.  There are piles of boxes and
|letters behind the counter.  On the wall above the counter there is a sign and a
|colorful calendar.  It is bright.
|There are three exits: west, an open oak door leading south, and north.
|an oak trash barrel.
|Karina the postal clerk (behind the counter).`;
const ENTRANCE = `|> Eris OOC Entrance
|This room has the ghostly appearance of being between this plane and the next.
|To depart this plane, type 'plane shift'.  It is bright.
|There is one obvious exit: south.`;
const SHIFT_IN =
  '|> Your body becomes insubstantial.  Red and green lights swirl around you for a single moment.  Suddenly you are substantial once again and in a different place.';
// The way back wraps at 80 columns (the OOC realm's formatting)
const SHIFT_OUT = `|Your body becomes insubstantial.  Red and green lights swirl around you for a
|single moment.  Suddenly you are substantial once again and in a different
|place.`;
// The live form: the notice is framed by blank lines
const HALL_NOTES = `|OOC Entry Hall
|This room has the ghostly appearance of being between this plane and the next.
|To depart this plane, type 'plane shift'.
|
|There are new notes to read on the following boards:
|     Important Notices
|
|  It is bright.
|There are four exits: north, south, east, and west.
|the 'Soul-O-Matic' skill tester, and a vending machine.`;
const HALL_NO_NOTES = `|> OOC Entry Hall
|This room has the ghostly appearance of being between this plane and the next.
|To depart this plane, type 'plane shift'.
|
|Sadly, there are no new notes for you to read.
|
|  It is bright.
|There are four exits: north, south, east, and west.
|the 'Soul-O-Matic' skill tester, and a vending machine.`;
const OOC_AREA = `|> OOC Area
|This is a grand hall.  High marble arches stretch high overhead, making you feel
|tiny in comparison.  This hall extends further to the north, as if leading you
|onward.  A small wooden plaque is mounted on the wall here.  It is bright.
|There are four exits: north, west, east, and south.`;

// --- A: the live form of an Eris round trip --------------------------------
{
  const h = replay(
    [
      POST_OFFICE,
      '>> n',
      ENTRANCE,
      '>> plane shift',
      SHIFT_IN,
      HALL_NOTES,
      '>> n',
      OOC_AREA,
      '>> s',
      HALL_NO_NOTES,
      '>> plane shift',
      '|> You are now speaking common.',
      SHIFT_OUT,
      ENTRANCE,
      '>> s',
      POST_OFFICE,
    ].join('\n')
  );
  check(h.r.stats.teleports === 2, `A: two teleports (${h.r.stats.teleports})`);
  const eris = h.townOf(h.named('Eris Post Office')[0])!;
  const erisNames = [...eris.rooms.values()].map((x) => x.name);
  check(
    !erisNames.includes('OOC Entry Hall') && !erisNames.includes('OOC Area'),
    `A: no OOC room is filed into Eris (${erisNames.join(', ')})`
  );
  const hall = h.named('OOC Entry Hall');
  check(hall.length === 1, `A: one OOC Entry Hall (${hall.length}), named by its own line`);
  const ooc = h.townOf(hall[0]);
  check(
    !!ooc && ooc !== eris && ooc.rooms.size === 2,
    `A: the OOC realm is its own town of 2 rooms (${ooc?.rooms.size})`
  );
  check(
    !!hall[0] && hall[0].links.n === h.named('OOC Area')[0]?.id,
    'A: hall -n-> OOC Area is walked'
  );
  const entrance = h.named('Eris OOC Entrance');
  check(entrance.length === 1, `A: the way back lands on the same Entrance (${entrance.length})`);
  const kinds = h.blocks.map((b) => `${b.name}:${b.res.kind}`);
  check(
    kinds[1] === 'Eris OOC Entrance:new-room' && kinds[2] === 'OOC Entry Hall:entered',
    `A: the hall is an entry (${kinds.join(' | ')})`
  );
  check(
    kinds[5] === 'Eris OOC Entrance:entered' && kinds[6] === 'Eris Post Office:expected',
    `A: back on the Entrance, its walked s link still leads to the Post Office (${kinds.join(' | ')})`
  );
  check(
    entrance[0]?.links.s === h.named('Eris Post Office')[0]?.id,
    "A: the Entrance's s link is intact"
  );
  check(
    JSON.stringify(h.r.townMap.teleportReturn) ===
      JSON.stringify({ townId: ooc?.id, roomId: hall[0]?.id }),
    `A: the way back from the Entrance is the hall (${JSON.stringify(h.r.townMap.teleportReturn)})`
  );
}

// --- B: a move typed after "plane shift" runs at the destination ------------
{
  const h = replay(
    [
      POST_OFFICE,
      '>> n',
      ENTRANCE,
      '>> plane shift',
      SHIFT_IN,
      HALL_NOTES,
      '>> plane shift',
      '|> You are now speaking common.',
      '>> s',
      SHIFT_OUT,
      ENTRANCE,
      POST_OFFICE,
    ].join('\n')
  );
  const last = h.blocks[h.blocks.length - 1];
  check(
    last.name === 'Eris Post Office' &&
      last.res.kind === 'expected' &&
      last.res.moved?.kind === 'dir' &&
      last.res.moved.dir === 's',
    `B: the s typed before the transit walks Entrance -> Post Office (${last.res.kind})`
  );
  check(h.here()?.name === 'Eris Post Office', 'B: standing in the Post Office');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: queue drained');
  check(h.named('Eris OOC Entrance').length === 1, 'B: one Entrance');
}
{
  // The first shift in: no way back is remembered yet, so the hall is a
  // fresh entry — and the "n" typed before the transit line still runs
  // from it (the entry starts with an empty queue; the type-ahead must
  // survive it, or the OOC Area is an unexplained floater)
  const h = replay(
    [POST_OFFICE, '>> n', ENTRANCE, '>> plane shift', '>> n', SHIFT_IN, HALL_NOTES, OOC_AREA].join(
      '\n'
    )
  );
  check(h.atTransit[0] === 'n', `B: the n waits at the transit (${h.atTransit[0]})`);
  check(
    h.kinds() ===
      'Eris Post Office:entered | Eris OOC Entrance:new-room | OOC Entry Hall:entered | OOC Area:new-room',
    `B: the hall is a fresh entry, the n maps on from it (${h.kinds()})`
  );
  const hall = h.named('OOC Entry Hall')[0];
  check(
    !!hall && hall.links.n === h.named('OOC Area')[0]?.id,
    `B: hall -n-> OOC Area (${JSON.stringify(hall?.links)})`
  );
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: queue drained after the fresh entry');

  // A move sent BEFORE the shift has run by the time the transit line
  // arrives: one whose reply the engine did not recognize (a soft failure in
  // room-specific prose — here no reply at all) is dropped at the transit
  // ("plane shift" is no move: its place among the moves is the non-move
  // send count noted when it was sent), not carried to the destination,
  // where the "e" would have filed the OOC Area east of the hall
  const d = replay(
    [
      POST_OFFICE,
      '>> n',
      ENTRANCE,
      '>> e',
      '>> plane shift',
      '>> n',
      SHIFT_IN,
      HALL_NOTES,
      OOC_AREA,
    ].join('\n')
  );
  check(
    d.atTransit[0] === 'n',
    `B: the dead e is dropped at the transit, the n kept (${d.atTransit[0]})`
  );
  const dHall = d.named('OOC Entry Hall')[0];
  check(
    !!dHall && dHall.links.n === d.named('OOC Area')[0]?.id && dHall.links.e === undefined,
    `B: the n maps on from the hall, nothing east (${JSON.stringify(dHall?.links)})`
  );
}

// --- C/D: the way back is remembered ---------------------------------------
/** The block the town parser makes of a fixture */
const parse = (fixture: string): TownRoomBlock => {
  const out: TownRoomBlock[] = [];
  const p = new TownParser((b) => out.push(b));
  for (const l of fixture.split('\n')) p.feedLine(l.replace(/^\|/, ''));
  p.flushPending();
  return out[0];
};
const ENTRANCE_BLOCK = parse(ENTRANCE);
const HALL_BLOCK = parse(HALL_NO_NOTES);
/** A same-named room in two places (sections C and J) */
const shrine = (where: string): TownRoomBlock => ({
  ...ENTRANCE_BLOCK,
  name: 'Shrine',
  desc: `A small shrine stands here, ${where}.  It is bright.`,
  descFirst: `A small shrine stands here, ${where}.  It is bright.`,
});
{
  // Eris holds the real Entrance; a fragment town holds a word-identical
  // copy (an earlier ambiguous entry) — the entry match cannot choose
  const map = new TownMapStore();
  const eris = map.createTown('Eris');
  const real = map.addRoom(eris, ENTRANCE_BLOCK, 0, 0, 0, 0);
  const frag = map.createTown('Eris OOC Entrance');
  map.addRoom(frag, ENTRANCE_BLOCK, 0, 0, 0, 0);
  map.pos = { townId: eris.id, roomId: real.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(ENTRANCE_BLOCK, null, 1_000); // standing in the real one
  loc.onTeleport();
  const inRes = loc.onRoomBlock(HALL_BLOCK, null, 2_000);
  check(inRes.kind === 'entered', `C: the hall is an entry (${inRes.kind})`);
  check(
    map.teleportReturn?.townId === eris.id && map.teleportReturn.roomId === real.id,
    'C: the departure is remembered'
  );

  // D: persisted — the app restarts and the player logs in inside the hall
  const saved = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
  check(
    saved.teleportReturn?.townId === eris.id && saved.teleportReturn.roomId === real.id,
    `D: teleportReturn survives a save (${JSON.stringify(saved.teleportReturn)})`
  );
  const loc2 = new TownLocalizer(saved);
  loc2.onLogin();
  const resume = loc2.onRoomBlock(HALL_BLOCK, null, 3_000);
  check(resume.kind === 'entered', `D: the login resumes in the hall (${resume.kind})`);
  loc2.onTeleport();
  const outRes = loc2.onRoomBlock(ENTRANCE_BLOCK, null, 4_000);
  check(
    outRes.pos?.townId === eris.id && outRes.pos.roomId === real.id,
    `C/D: the shift back lands on the Entrance it left, not its copy (${JSON.stringify(outRes.pos)})`
  );
  check(saved.towns.size === 3, `C/D: no new fragment town (${saved.towns.size} towns)`);

  // The memory follows a merge, and goes with a deleted town
  const m2 = new TownMapStore();
  const into = m2.createTown('Eris');
  const keep = m2.addRoom(into, ENTRANCE_BLOCK, 0, 0, 0, 0);
  const from = m2.createTown('fragment');
  const dup = m2.addRoom(from, ENTRANCE_BLOCK, 3, 3, 0, 0);
  m2.teleportReturn = { townId: from.id, roomId: dup.id };
  m2.mergeTowns(from, dup.id, into, keep.id);
  check(
    m2.teleportReturn?.townId === into.id && m2.teleportReturn.roomId === keep.id,
    `D: a merge carries the memory along (${JSON.stringify(m2.teleportReturn)})`
  );
  m2.deleteTown(into.id);
  check(m2.teleportReturn === null, 'D: deleting its town forgets it');
  // ... and clearing the store (town ids restart at 0: a kept memory would
  // name whatever room the next map gives that id)
  m2.teleportReturn = { townId: 0, roomId: 0 };
  m2.clear();
  check(m2.teleportReturn === null, 'D: clearing the store forgets it');

  // A dangling or malformed saved memory is dropped on load, like a saved
  // position: the room it names must exist
  for (const bad of [
    { townId: eris.id, roomId: 999 },
    { townId: String(eris.id), roomId: real.id },
    'Eris OOC Entrance',
  ]) {
    const raw = JSON.parse(JSON.stringify(map.serialize())) as { teleportReturn: unknown };
    raw.teleportReturn = bad;
    check(
      TownMapStore.deserialize(raw).teleportReturn === null,
      `D: a bad saved memory is dropped on load (${JSON.stringify(bad)})`
    );
  }

  // The arrival is elsewhere by definition: a same-named room is no resume
  // (the portal rule: identical Portal Chambers would false-match)
  const m3 = new TownMapStore();
  const l3 = new TownLocalizer(m3);
  const left = l3.onRoomBlock(shrine('by the city gate'), null, 1_000);
  l3.onTeleport();
  const there = l3.onRoomBlock(shrine('on a windswept mountaintop'), null, 2_000);
  check(
    there.kind === 'entered' && there.pos?.townId !== left.pos?.townId,
    `C: a same-named arrival is not the room left (${JSON.stringify(there.pos)})`
  );
}

// --- E: the temple pool -------------------------------------------------------
const EYE = `|Eye of the Temple
|The center of the temple is timeworn, but the power here is as deep as the bones
|of the earth.  This chamber is octagonal with a high, corbelled vault overhead.
|Each of the walls is carved in deep bas relief, and torches burn in brackets
|shedding a flickering red light.  It is bright.
|There are three exits: south, north, and northwest.
|a large altar (embedded with axes).`;
const SANCTUM = `|Sanctum
|This is a large, square chamber deep in the temple.  Iron braziers burning in
|each of the four corners give heat and light, and several furs on the floor
|provide a place for Warriors to sit.  In the center of the chamber is a deep
|pool surrounded by a low stone curb.  Affixed to the wall is an ancient scroll.
|It is bright.
|There are three exits: south, north, and a closed curtain leading west.
|a bulletin board, and a storage bin.`;
const CAVE = `|Cave of Spirits
|A rough, long-forgotten cave in the side of the mountain.  On the walls are
|primitive paintings, apparently executed in red ochre by some paleolithic tribe.
|At the back of the cave is a small pool welling from deep within the earth.  It
|is well lit.
|There is one obvious exit: out.`;
const POOL_LINE =
  '|You step into the pool and feel power well up from deep within the ground, taking you elsewhere!';
// The pool failing (all 4 MUSH sightings in the Cave, e.g. dm-2025-08-07.txt:10010)
const UNRECEPTIVE =
  'You step into the pool and feel power well up from deep within the ground, trying to take you elsewhere, but something seems unreceptive on the other end.';
{
  const h = replay(
    [
      EYE,
      '>> n',
      SANCTUM,
      '>> ep',
      '|Enter what?',
      POOL_LINE,
      CAVE,
      '>> ep',
      '|What ?',
      POOL_LINE,
      SANCTUM,
      '>> enter pool',
      POOL_LINE,
      CAVE,
      '>> enter pool',
      POOL_LINE,
      SANCTUM,
      '>> s',
      EYE,
    ].join('\n')
  );
  check(h.r.stats.teleports === 4, `E: four pool transits (${h.r.stats.teleports})`);
  const sanctum = h.named('Sanctum');
  const cave = h.named('Cave of Spirits');
  check(sanctum.length === 1 && cave.length === 1, 'E: one Sanctum, one Cave of Spirits');
  check(
    h.townOf(cave[0]) !== h.townOf(sanctum[0]),
    'E: the Cave of Spirits is not filed into the temple'
  );
  check(
    Object.keys(sanctum[0]?.namedLinks ?? {}).length === 0 &&
      Object.keys(cave[0]?.namedLinks ?? {}).length === 0,
    `E: no pool or path named links (${JSON.stringify(sanctum[0]?.namedLinks)} ${JSON.stringify(cave[0]?.namedLinks)})`
  );
  const kinds = h.blocks.map((b) => `${b.name}:${b.res.kind}`);
  check(
    kinds.join(' | ') ===
      'Eye of the Temple:entered | Sanctum:new-room | Cave of Spirits:entered | Sanctum:entered | ' +
        'Cave of Spirits:entered | Sanctum:entered | Eye of the Temple:expected',
    `E: every pool arrival is an entry, the walk back out is the walked link (${kinds.join(' | ')})`
  );
  check(h.here()?.name === 'Eye of the Temple', 'E: back in the Eye');

  // The Blue Pearl's swimming pool: "enter pool", no transit line
  const GARDEN = `|Garden Courtyard\n|A walled garden with a fountain and benches set among the flower beds.  It is\n|dimly lit.\n|There is one obvious exit: north.`;
  const POOL = `|Pool\n|The shallow end of the pool.  It is dimly lit.  The air is quite warm.\n|There are two exits: out and south.`;
  const b = replay(`${GARDEN}\n>> enter pool\n${POOL}`);
  const garden = b.named('Garden Courtyard')[0];
  check(
    !!garden && garden.namedLinks['enter pool'] === b.named('Pool')[0]?.id,
    'E: a swimming pool is still a named exit'
  );
}

// --- F: the transit lines -----------------------------------------------------
for (const line of [
  'Your body becomes insubstantial.  Red and green lights swirl around you for a single moment.  Suddenly you are substantial once again and in a different place.',
  '> Your body becomes insubstantial.  Red and green lights swirl around you for a single moment.  Suddenly you are substantial once again and in a different place.',
  'Your body becomes insubstantial.  Red and green lights swirl around you for a',
  'You step into the pool and feel power well up from deep within the ground, taking you elsewhere!',
]) {
  check(TELEPORT_TRANSIT_RE.test(line), `F: a teleport: "${line.slice(0, 50)}..."`);
}
for (const line of [
  UNRECEPTIVE,
  'You feel reality bend around you as you are taken bodily to the spirit plane.',
  'You finish the incantation and the spell is unleashed!',
  'You step into the north portal.',
  "Moirai says in common, 'Your body becomes insubstantial.'",
]) {
  check(!TELEPORT_TRANSIT_RE.test(line), `F: no teleport: "${line.slice(0, 50)}..."`);
}

// --- G: the newest transit line wins -----------------------------------------------
// (session_2026-06-29T19-35-13-085.log:1169-1186, the hub's north portal)
const CHAMBER = `|Portal Chamber
|This is a large open room ringed by seven arch-shaped portals of some dark
|bluish stone, one at each of the compass points except for east.  Between the
|portals, silver cressets attached to the walls provide a steady, bright
|illumination.  A sheet of silvery-white fire fills the west portal.  It is
|bright.
|There is one obvious exit: east.`;
const FORECOURT = `|Forecourt
|This is a cobblestone paved courtyard in front of the Luminarian church.  The
|facade of the church is composed of the bell tower and its spire-topped steeple.
|A shallow set of stairs leads up to the broad double doors, above which is a
|large stained-glass rose window.  In the center of the courtyard is a lively
|fountain and a few marble benches provide seating.  To the south side is an
|arch-like portal.  A sheet of silvery-white fire fills the portal.  It is
|bright.
|There are two exits: west and an open set of oaken double doors leading east.`;
{
  // A teleport line after a portal line: the arrival is the teleport's, and
  // nothing of the portal is left over for the block after it
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const entrance = loc.onRoomBlock(ENTRANCE_BLOCK, null, 1_000).pos;
  loc.onPortalTransit('north');
  loc.onTeleport();
  const hall = loc.onRoomBlock(HALL_BLOCK, null, 2_000);
  loc.trackCommand('n', 2_500);
  const area = loc.onRoomBlock(parse(OOC_AREA), null, 3_000);
  check(
    hall.kind === 'entered' && area.kind === 'new-room',
    `G: the hall is the teleport's arrival, the OOC Area a step from it (${hall.kind} ${area.kind})`
  );
  check(
    map.portalDests.size === 0 && !map.room(hall.pos)?.portal && !map.room(area.pos)?.portal,
    'G: no portal arrival or destination recorded'
  );
  check(
    JSON.stringify(map.teleportReturn) === JSON.stringify(entrance),
    `G: the way back is the Entrance (${JSON.stringify(map.teleportReturn)})`
  );

  // A portal line after a teleport line: the arrival is the portal's
  const m2 = new TownMapStore();
  const l2 = new TownLocalizer(m2);
  const chamber = l2.onRoomBlock(parse(CHAMBER), null, 1_000).pos!;
  l2.onTeleport();
  l2.onPortalTransit('north');
  const fore = l2.onRoomBlock(parse(FORECOURT), null, 2_000);
  check(
    fore.kind === 'entered' && m2.room(fore.pos)?.portal === true,
    `G: the Forecourt is the portal's arrival (${fore.kind})`
  );
  check(
    JSON.stringify(m2.getPortalDest(chamber, 'north')) === JSON.stringify(fore.pos),
    "G: ... and learned as the north portal's destination"
  );
  check(m2.teleportReturn === null, 'G: no teleport way back remembered');

  // A transit line with no teleport command queued or noted (none the
  // engine saw: sent before it was indoors, say): no queued move can be
  // placed before or after it, so none is kept
  const l3 = new TownLocalizer(new TownMapStore());
  l3.onRoomBlock(ENTRANCE_BLOCK, null, 1_000);
  l3.trackCommand('s', 1_100);
  l3.onTeleport();
  check(
    l3.pendingMoves.length === 0,
    `G: nothing attributable, nothing kept (${queueOf(l3).join(',')})`
  );

  // Two "enter pool" tries queued, the first refused by a line the engine
  // does not read: the transit line answers the LAST one, and the refused try
  // is not carried to the destination
  const p = replay(
    [CAVE, '>> enter pool', `|${UNRECEPTIVE}`, '>> enter pool', POOL_LINE, SANCTUM].join('\n')
  );
  check(p.atTransit[0] === '', `G: both pool tries are spent at the transit (${p.atTransit[0]})`);
  check(
    p.kinds() === 'Cave of Spirits:entered | Sanctum:entered' &&
      p.r.townLocalizer.pendingMoves.length === 0,
    `G: nothing is carried to the Sanctum (${p.kinds()}; ${queueOf(p.r.townLocalizer).join(',')})`
  );

  // The transit line is the shift's reply, so the "What ?" after it belongs to
  // the dead move typed in the hall ("out": the hall has no such exit). Owed
  // to the shift instead, it would leave the move queued, and each later
  // reply would go to the command before its own
  const w = replay(
    [ENTRANCE, '>> plane shift', SHIFT_IN, HALL_NOTES, '>> out', '|What ?'].join('\n')
  );
  check(
    w.r.stats.replyFails === 1 && w.r.townLocalizer.pendingMoves.length === 0,
    `G: the "What ?" fails the dead "out" (${w.r.stats.replyFails}; ${queueOf(w.r.townLocalizer).join(',')})`
  );
}

// --- H: the way back is found by memory and name ------------------------------------
// ... not identified positively (a walked link, a look): the landing refreshes
// the stored text but teaches no volatile prose (TownMapStore.touchRoom), so a
// wrong landing cannot poison the learned set
{
  const SANCTUM_BLOCK = parse(SANCTUM);
  const CAVE_BLOCK = parse(CAVE);
  const map = new TownMapStore();
  const temple = map.createTown('Temple');
  const sanctum = map.addRoom(temple, SANCTUM_BLOCK, 0, 0, 0, 0);
  const spirits = map.createTown('Cave of Spirits');
  const cave = map.addRoom(spirits, CAVE_BLOCK, 0, 0, 0, 0);
  map.teleportReturn = { townId: temple.id, roomId: sanctum.id };
  map.pos = { townId: spirits.id, roomId: cave.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(CAVE_BLOCK, null, 1_000);
  loc.onTeleport();
  // One mid-description sentence swapped: the shape volatile prose is learned from
  const desc = SANCTUM_BLOCK.desc.replace(
    'Affixed to the wall is an ancient scroll.',
    'A tattered war banner hangs on the wall.'
  );
  check(desc !== SANCTUM_BLOCK.desc, 'H: fixture: one sentence swapped');
  const res = loc.onRoomBlock({ ...SANCTUM_BLOCK, desc }, null, 2_000);
  check(
    res.kind === 'entered' && res.pos?.townId === temple.id && res.pos.roomId === sanctum.id,
    `H: the pool leads back to the Sanctum (${JSON.stringify(res.pos)})`
  );
  check(sanctum.desc === desc, 'H: the stored text is refreshed');
  const pending = (map.serialize() as { volatilePending: Record<string, number[]> })
    .volatilePending;
  check(
    Object.keys(pending).length === 0,
    `H: no volatile prose learned (${JSON.stringify(pending)})`
  );
}

// --- I: a remembered way back the arrival does not match ------------------------------
// The memory holds the room the LAST teleport left: after an OOC round trip,
// the hall. The next teleport can be another one entirely, the temple pool;
// its arrival matches no remembered room and is a fresh entry like any other.
// Landed on the hall by memory alone, the Cave of Spirits would be filed as
// the hall: no Cave room, and the hall's text and exits overwritten with the
// Cave's.
{
  const h = replay(
    [
      POST_OFFICE,
      '>> n',
      ENTRANCE,
      '>> plane shift',
      SHIFT_IN,
      HALL_NOTES,
      '>> plane shift',
      SHIFT_OUT,
      ENTRANCE,
      '@3600',
      EYE,
      '>> n',
      SANCTUM,
      '>> enter pool',
      POOL_LINE,
      CAVE,
      '>> enter pool',
      POOL_LINE,
      SANCTUM,
    ].join('\n')
  );
  check(
    h.kinds() ===
      'Eris Post Office:entered | Eris OOC Entrance:new-room | OOC Entry Hall:entered | ' +
        'Eris OOC Entrance:entered | Eye of the Temple:entered | Sanctum:new-room | ' +
        'Cave of Spirits:entered | Sanctum:entered',
    `I: every teleport arrival is an entry (${h.kinds()})`
  );
  const hall = h.named('OOC Entry Hall')[0];
  const cave = h.named('Cave of Spirits');
  check(
    cave.length === 1 &&
      h.townOf(cave[0]) !== h.townOf(hall) &&
      h.townOf(cave[0]) !== h.townOf(h.named('Sanctum')[0]),
    `I: the Cave of Spirits is a town of its own (${cave.length})`
  );
  check(
    JSON.stringify(hall?.exits) === JSON.stringify(HALL_BLOCK.exits.dirs) &&
      !!hall?.desc.startsWith('This room has the ghostly appearance'),
    `I: the hall keeps its own exits and text (${JSON.stringify(hall?.exits)})`
  );
  const last = h.blocks[h.blocks.length - 1];
  check(
    last.res.pos?.roomId === h.named('Sanctum')[0]?.id &&
      JSON.stringify(h.r.townMap.teleportReturn) ===
        JSON.stringify({ townId: h.townOf(cave[0])?.id, roomId: cave[0]?.id }),
    `I: the pool back lands on the Sanctum; the way back is now the Cave (${JSON.stringify(h.r.townMap.teleportReturn)})`
  );
}

// --- J: the hex the owner passes says nothing about a teleport's arrival ---------------
// Every block comes with the hex of the last wilderness survey: at a
// teleport's arrival, the hex the player entered the DEPARTURE town from. A
// fresh entry neither learns it (one hex leads into one place, so
// TownMapStore.setAnchor would move Eris Road's key to the OOC realm, and the
// next walk in from that hex would miss Eris Road) nor reads it (a room the
// key leads to that is named like the arrival is not the arrival).
const ERIS_ROAD = `|Eris Road
|This is a cobblestone-paved road leading into the market square of a burgeoning
|town.  There are a few buildings along this road and signs of a prospering town
|everywhere.  Timber scaffolding and piles of field stone border the
|outbuildings.  To the east is the market square and beyond that is a ferry
|landing on the shore of the Sea of Eris.  It is painfully bright.
|There are three exits: east, west, and south.`;
const holders = (map: TownMapStore, key: string) =>
  [...map.towns.values()].filter((t) => t.anchors[key] !== undefined).map((t) => t.name);
{
  // Eris, entered from 0:7,5 at Eris Road (session_2026-06-19T06-54-30-220.log:627,
  // the corpus replay's anchor); the player stands on the OOC Entrance
  const map = new TownMapStore();
  const eris = map.createTown('Eris');
  const road = map.addRoom(eris, parse(ERIS_ROAD), 0, 0, 0, 0);
  map.setAnchor(eris, '0:7,5', road.id);
  const entrance = map.addRoom(eris, ENTRANCE_BLOCK, 3, -2, 0, 0);
  map.pos = { townId: eris.id, roomId: entrance.id };
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(ENTRANCE_BLOCK, '0:7,5', 1_000);
  loc.trackCommand('plane shift', 1_100);
  loc.onTeleport();
  const hall = loc.onRoomBlock(HALL_BLOCK, '0:7,5', 1_200);
  check(
    hall.kind === 'entered' && hall.pos?.townId !== eris.id,
    `J: the hall is an entry of its own (${hall.kind} ${JSON.stringify(hall.pos)})`
  );
  check(
    JSON.stringify(holders(map, '0:7,5')) === '["Eris"]' && eris.anchors['0:7,5'] === road.id,
    `J: Eris Road keeps its hex (${holders(map, '0:7,5')})`
  );

  // The key's room is named like the arrival: a shrine by the city gate,
  // entered from the hex outside; the player walks on and teleports to a
  // shrine on a mountaintop
  const m2 = new TownMapStore();
  const l2 = new TownLocalizer(m2);
  const gate = l2.onRoomBlock(shrine('by the city gate'), '0:2,2', 1_000).pos;
  l2.trackCommand('s', 1_100);
  l2.onRoomBlock(
    parse(
      '|Temple Steps\n|Broad stone steps climb to the temple doors.  It is bright.\n|There are two exits: north and south.'
    ),
    '0:2,2',
    1_200
  );
  l2.onTeleport();
  const there = l2.onRoomBlock(shrine('on a windswept mountaintop'), '0:2,2', 2_000);
  check(
    there.kind === 'entered' && !!gate && there.pos?.townId !== gate.townId,
    `J: the shrine the hex leads to is not the arrival (${JSON.stringify(there.pos)})`
  );
}

fx.remove();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-ooc-transit: all checks passed');
