/**
 * Regression test: dark arrivals (Oct 2026 deep dive, commands lens).
 *
 * In an unlit room DartMUD prints "It is pitch black." (and the room's night
 * prose) INSTEAD of the room block. The move happened, but nothing consumed
 * it: the next lit block was resolved against the stale queue head, and
 * every later block lined up one move late.
 *
 *  A. Soriktos at night, session_2026-08-17T16-59-49-147.log:1643-1670:
 *     from the Vestibule "e" and "n" land in dark streets, the second "n" in
 *     the lit Souk. The dark steps follow their walked links blindly, so the
 *     Souk is the "n" it is — before, the stale "e" claimed it, and the
 *     frontier's reuse rewired the Vestibule's east exit to the Souk.
 *  B. A look in the dark shows the dark again: the player stays put.
 *  C. A step into an UNMAPPED dark room leaves the position unknown. Going
 *     "lost" there stalled mapping for good (relocalization never creates
 *     rooms: the next unmapped lit rooms all stayed lost). Instead the next
 *     block resolves once by correlation — here an honest floater — and the
 *     walk maps on from it, with no false link from the room before the dark.
 *     A link naming a room the town does not hold is no walked link.
 *  D. Out of a town gate into a dark wilderness (no survey is printed, so
 *     the town engine stays active) and into another town: mapping goes on
 *     and the gate grows no false link; after a dark walk longer than the
 *     continuity gap the village is a town of its own.
 *  E. The line itself; outdoors a dark line does nothing.
 *  F. While the position is unknown, nothing is recorded for the room left
 *     behind: door closes, portal departures, exit words, exit anchors.
 *  G. Stale moves expire before a dark line spends one.
 *  H. A dark line right after a transit (portal, teleport) is the transit's
 *     own arrival (dm-2025-12-26.txt:13748): no move spent, nothing learned
 *     about the portal, the next lit room a fresh entry — also when the
 *     transit came while the engine was inactive.
 *  I. A dark step along a walked NAMED exit advances blindly too
 *     (session_2026-08-25T01-56-18-669.log:17662: "out" of the Blue Pearl's
 *     pool into the unlit Garden Courtyard, a look, then "n" to the Salon).
 *  J. Nothing local says where a transit into the dark led: the next lit
 *     room neither resumes onto the room left nor reads or learns the hex the
 *     owner passes (the last survey's: the departure town's way in).
 */
import { TOWN_DARK_RE, TownParser, type TownRoomBlock } from '../../src/lib/townParser';
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

const expand = makeExpander([]);
const fx = new SessionFixture('dark-arrival-');
function replay(text: string) {
  const blocks: { name: string; res: TownResolution }[] = [];
  const r = new TownReplay(
    { expand: (raw) => expand(raw) },
    { onBlock: ({ block, res }) => blocks.push({ name: block.name, res }) }
  );
  r.replayLog(fx.write(text));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  const townOf = (room: TownRoom | undefined) =>
    [...r.townMap.towns.values()].find((t) => room && t.rooms.get(room.id) === room);
  const here = (): TownRoom | undefined => r.townMap.room(r.townMap.pos);
  const kinds = () => blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  return { r, blocks, rooms, named, townOf, here, kinds };
}
/** The block the town parser makes of a fixture */
const parse = (fixture: string): TownRoomBlock => {
  const out: TownRoomBlock[] = [];
  const p = new TownParser((b) => out.push(b));
  for (const l of fixture.split('\n')) p.feedLine(l.replace(/^\|/, ''));
  p.flushPending();
  return out[0];
};

// session_2026-08-17T16-59-49-147.log (the streets' text from the replayed map)
const VESTIBULE = `|Vestibule
|This arched passageway forms an elegant entry vestibule between the street and a
|secluded and enclosed courtyard to the west.  The ground is paved in white
|travertine tiles and the walls and ceiling are tiled with a rich mosaic in many
|different colors.  Just inside the entryway are a pair of niches which contain
|exquisite statues of Martin and Dannika.  Silver cressets mounted on the walls
|cast a warm illumination over the passageway.  It is dimly lit.
|There are four exits: a closed rosewood door leading north, an open silvered
|steel gate leading west, an open pearl-studded silver gate leading east, and
|south.`;
const STREET_SOUTH = `|Chalcedony Street
|A broad street leading north and south.  Chalcedony street is known to be the
|home to the mystics and mages of the city of Soriktos.  A few citizens travel the
|street going to the market.  There is a huge gate of black metal to the east and
|beyond it a tall tower of a strange black stone rises to loom over you. Opposite
|the black gate is a gate of solid silver studded with pearls.  It opens onto the
|arched passageway leading into the gleaming white stone building to the west.  To
|the north is the Souk and to the south is the Necropolis.  It is dimly lit.  The
|air is quite humid.
|There are four exits: north, east, south, and west.`;
const STREET_NORTH = `|Chalcedony Street
|A broad street leading north and south.  Chalcedony street is known to be the
|home to the mystics and mages of the city of Soriktos.  A few citizens travel the
|street going to the market.  Immediately to the north is the Souk and in the
|distance to the south is the Necropolis. To the east is a majestic building made
|of white stone, rising high into the sky, the steeple topping even the Ebon Tower
|to the south.  It is dimly lit.  The air is quite humid.
|There are four exits: north, east, south, and west.`;
const SOUK = `|The Souk
|This is the southern side of the Souk, the central marketplace of Soriktos.  The
|booths and tents from which vendors sell their wares have been closed down for
|the evening.  The Souk is deserted except for a few late travelers and couples
|taking an after dinner stroll.  A broad street leads away from the Souk to the
|south, and the center of the bazaar is to the north.  It is well lit.  The air
|is quite humid.
|There are four exits: north, east, west, and south.`;
const DARK = `|It is pitch black.  The odors of the day have faded and you smell the scent of
|night blooming flowers.  Quiet has stolen over the city with the coming of the
|night and you hear the distant song of nightingales.`;
const DAYTIME = [
  VESTIBULE,
  '>> e',
  STREET_SOUTH,
  '>> n',
  STREET_NORTH,
  '>> n',
  SOUK,
  '>> s',
  STREET_NORTH,
  '>> s',
  STREET_SOUTH,
  '>> w',
  VESTIBULE,
];

// --- A: Soriktos at night ------------------------------------------------------
{
  const h = replay([...DAYTIME, '>> e', DARK, '>> n', DARK, '>> n', SOUK].join('\n'));
  const last = h.blocks[h.blocks.length - 1];
  check(
    last.res.kind === 'expected' && last.res.moved?.kind === 'dir' && last.res.moved.dir === 'n',
    `A: the Souk is the second n (${last.res.kind} ${JSON.stringify(last.res.moved)})`
  );
  const vestibule = h.named('Vestibule')[0];
  const south = h
    .rooms()
    .find((x) => x.name === 'Chalcedony Street' && x.links.w === vestibule?.id);
  check(
    !!south && vestibule?.links.e === south.id,
    "A: the Vestibule's east exit still leads to Chalcedony Street"
  );
  check(h.named('The Souk').length === 1, 'A: one Souk');
  check(h.r.totals().linkMisses === 0, `A: no link misses (${h.r.totals().linkMisses})`);
  check(h.r.townLocalizer.pendingMoves.length === 0, 'A: queue drained');
  check(h.r.stats.darkArrivals === 2, `A: two dark arrivals (${h.r.stats.darkArrivals})`);
}

// --- B: a look in the dark ------------------------------------------------------
{
  const h = replay([...DAYTIME, '>> e', DARK, '>> l', DARK, '>> n', DARK, '>> n', SOUK].join('\n'));
  const last = h.blocks[h.blocks.length - 1];
  check(
    last.res.kind === 'expected' && last.name === 'The Souk',
    `B: the look stayed put, the Souk is still the second n (${last.res.kind})`
  );
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: queue drained');
}

// --- C: into an unmapped dark room, then unmapped lit rooms ----------------------
const GATE = `|North Gate\n|A sturdy wooden gate in the town wall opens onto the plains to the south.  It is dim.\n|There are two exits: north and south.`;
const STREET = `|Main Street\n|A muddy street runs north from the gate between low wooden houses.  It is dim.\n|There are two exits: north and south.`;
const SQUARE = `|Village Square\n|A tiny square with a well in its middle, surrounded by thatched cottages.  It is dim.\n|There are three exits: north, east, and west.`;
const LANE = `|Cottage Lane\n|A narrow lane between thatched cottages leads east and west.  It is dim.\n|There are two exits: east and west.`;
const NIGHT = '|It is pitch black.';
{
  const h = replay(
    [STREET, '>> s', GATE, '>> n', STREET, '>> n', NIGHT, '>> n', SQUARE, '>> e', LANE].join('\n')
  );
  check(!h.r.townLocalizer.lost, 'C: not lost after the unmapped dark room');
  const kinds = h.blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  check(
    kinds ===
      'Main Street:entered | North Gate:new-room | Main Street:expected | Village Square:jumped | Cottage Lane:new-room',
    `C: an honest floater, then mapping goes on (${kinds})`
  );
  const street = h.named('Main Street')[0];
  check(street?.links.n === undefined, 'C: no false Main Street -n-> Village Square link');
  check(
    h.named('Village Square')[0]?.links.e === h.named('Cottage Lane')[0]?.id,
    'C: Village Square -e-> Cottage Lane'
  );

  // Typed ahead: the move after the block's own is not predicted from the
  // room before the dark either (it would file the Square east of Main Street)
  const t = replay(
    [STREET, '>> s', GATE, '>> n', STREET, '>> n', NIGHT, '>> n', '>> e', SQUARE, LANE].join('\n')
  );
  const tk = t.blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  check(
    t.named('Main Street')[0]?.links.e === undefined &&
      t.named('Village Square')[0]?.links.e === t.named('Cottage Lane')[0]?.id,
    `C: type-ahead lines up after the floater (${tk})`
  );

  // The block's own move is spent: the next room is the move after it
  // (left queued, the spent "n" filed this lane NORTH of the Square — the
  // lane lists the way back south too)
  const WELL_LANE = `|Well Lane\n|A short lane runs west from the square past the smithy.  It is dim.\n|There are three exits: north, east, and south.`;
  const w = replay(
    [STREET, '>> s', GATE, '>> n', STREET, '>> n', NIGHT, '>> n', SQUARE, '>> w', WELL_LANE].join(
      '\n'
    )
  );
  const square = w.named('Village Square')[0];
  check(
    square?.links.w === w.named('Well Lane')[0]?.id && square?.links.n === undefined,
    `C: the next move is the next room's (${JSON.stringify(square?.links)})`
  );

  // A link naming a room the town does not hold (a load keeps one: its link
  // cleanses skip a missing destination) leads nowhere known: followed, the
  // position would name no room and the next block go "lost"
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const main = map.room(loc.onRoomBlock(parse(STREET), null, 1_000).pos)!;
  main.links.n = 99;
  loc.trackCommand('n', 1_100);
  loc.onDarkArrival(1_200);
  loc.trackCommand('n', 1_300);
  const sq = loc.onRoomBlock(parse(SQUARE), null, 1_400);
  check(
    !loc.lost && sq.kind === 'jumped',
    `C: a dangling link is no walked link (${sq.kind}${loc.lost ? ', lost' : ''})`
  );
}

// --- D: out of town into a dark wilderness, into another town --------------------
{
  const walk = (pause: string) =>
    [STREET, '>> s', GATE, '>> s', NIGHT, pause, '>> s', NIGHT, '>> enter village', SQUARE]
      .concat(['>> e', LANE, '>> w', SQUARE])
      .join('\n');
  const h = replay(walk('@20'));
  const kinds = h.blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  check(!h.r.townLocalizer.lost, `D: not lost (${kinds})`);
  check(h.named('North Gate')[0]?.links.s === undefined, 'D: no false North Gate -s-> link');
  check(h.blocks[h.blocks.length - 1].res.kind === 'expected', `D: the village maps on (${kinds})`);
  const long = replay(walk('@200'));
  check(
    long.townOf(long.named('Village Square')[0]) !== long.townOf(long.named('North Gate')[0]),
    'D: after a dark walk past the continuity gap the village is a town of its own'
  );
}

// --- E: the line, and an inactive engine ---------------------------------------
check(TOWN_DARK_RE.test('It is pitch black.  You smell damp, stagnant air.'), 'E: dark line');
check(TOWN_DARK_RE.test('> It is pitch black.  '), 'E: prompt-prefixed dark line');
check(!TOWN_DARK_RE.test('The room is pitch black.'), 'E: not a dark arrival');
{
  const loc = new TownLocalizer(new TownMapStore());
  loc.onDarkArrival(1_000); // outdoors: nothing to consume, no state
  check(!loc.lost && loc.pendingMoves.length === 0, 'E: inactive: no-op');
}

// --- F: after a step into an unmapped dark room the position is unknown ------------
// The map still holds the room left behind, but commands typed now run in the
// dark room: a close there shuts no door of the room left, a portal taken
// there is not its portal, an exit word it lists is no move, and the hex the
// player walks out onto is not its exit
const DOOR_STREET = `|Main Street
|A muddy street runs north from the gate between low wooden houses.  It is dim.
|There are four exits: an open oak door leading west, path, north, and south.`;
const open = (r: TownRoom | undefined) => JSON.stringify(r?.openDoorDirs);
{
  const intoTheDark = () => {
    const map = new TownMapStore();
    const loc = new TownLocalizer(map);
    const street = map.room(loc.onRoomBlock(parse(DOOR_STREET), null, 1_000).pos)!;
    loc.trackCommand('n', 1_100);
    loc.onDarkArrival(1_200); // no walked link north: an unmapped room
    return { map, loc, street };
  };
  {
    const { loc, street } = intoTheDark();
    check(
      open(street) === '["w"]',
      `F: fixture: Main Street's west door is open (${open(street)})`
    );
    loc.trackCommand('close w door', 1_300);
    check(
      open(street) === '["w"]',
      `F: a close in the dark room leaves Main Street's door as printed (${open(street)})`
    );
    check(!loc.trackCommand('path', 1_400), "F: Main Street's exit word is no move there");
  }
  {
    const { map, loc, street } = intoTheDark();
    loc.trackCommand('enter portal', 1_300);
    loc.onPortalTransit(null);
    loc.onRoomBlock(parse(SQUARE), null, 1_400);
    check(
      !street.portal && map.portalDests.size === 0,
      "F: a portal taken in the dark room is not Main Street's"
    );
  }
  {
    const { map, loc } = intoTheDark();
    loc.onWilderness();
    loc.noteOutdoorPosition('0:1,1');
    const anchors = [...map.towns.values()].reduce((n, t) => n + Object.keys(t.anchors).length, 0);
    check(anchors === 0, `F: the hex walked out onto is no exit of Main Street (${anchors})`);
  }
}

// --- G: a dark line expires stale moves before spending one --------------------------
// A move typed more than 20 s before (QUEUE_MAX_AGE) and never answered is not
// the one that walked into the dark: spent instead, it blind-advanced along
// ITS link (south, back to the gate) and left the real step queued
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const street = loc.onRoomBlock(parse(STREET), null, 1_000).pos!;
  loc.trackCommand('s', 2_000);
  loc.onRoomBlock(parse(GATE), null, 3_000);
  loc.trackCommand('n', 4_000);
  loc.onRoomBlock(parse(STREET), null, 5_000);
  loc.trackCommand('s', 6_000); // no reply the engine recognized: still queued
  loc.trackCommand('n', 30_000);
  loc.onDarkArrival(31_000);
  check(
    loc.pendingMoves.length === 0,
    `G: the stale s expired, the n is spent (${loc.pendingMoves.length} queued)`
  );
  check(map.pos?.roomId === street.roomId, 'G: no blind step back to the gate');
}

// --- H: a transit into an unlit room ----------------------------------------------
// dm-2025-12-26.txt:13748: the hub's north portal at night, ten pitch-black
// steps to a lit Gatehouse. The first dark line is the portal's own arrival
// (no move is spent); the steps after it are in a town the hub knows nothing
// about, never along the hub's links; the Gatehouse is an entry of its own,
// neither a portal room nor the portal's destination (the daylight Forecourt
// stays remembered); and its own move is spent, not carried past it.
// (Portal Chamber / Forecourt / Chapter Hall: session_2026-06-29T19-35-13-085.log)
const CHAPTER_HALL = `|Chapter Hall
|This is a circular chamber with a ring of elegantly fluted pillars around the
|outside. In the center of the chamber is a large round table with heavy wooden
|chairs surrounding it.  Silver cressets affixed to each pillar burn with a
|silver-white light, providing a steady, bright illumination.  Next to the
|northern archway, a bulletin board has been attached to the wall.  It is bright.
|There are five exits: north, east, an open oak door leading southeast, west, and
|south.
|a bulletin board.`;
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
const PORT_NORTH = [
  '>> touch north portal',
  '|You touch the north portal.',
  '|A sheet of silvery-white fire suddenly appears in the north portal.',
  '>> enter north portal',
  '|> You step into the north portal.',
];
const NIGHT_ARRIVAL = `|It is pitch black.  You smell the mingled scents of food, animals and people
|coming from the market and a faint aroma of frankincense drifting from the
|church.  You hear the chirping of crickets.`;
const NIGHT_STEP = `|> It is pitch black.  You smell mingled odors of food, animals and people.  You
|hear the chirping of crickets.`;
const GATEHOUSE = `|> Gatehouse
|This is a tunnel-like passage through the gatehouse at the front of the
|fortress.  The ceiling is vaulted overhead and the floor and walls are made of
|sturdy stonework.  At each end of the passage is a heavy, wrought iron gate.
|Wrought iron cressets on the wall provide a flickering illumination.  It is
|murky.
|There are four exits: an open wrought iron gate leading west, a closed wrought
|iron gate leading east, north, and south.`;
const TRAINING_HALL = `|Training Hall
|This is a small gymnasium for training novice warriors.  Straw-stuffed pells
|stand in a row along the north wall.  It is murky.
|There is one obvious exit: south.`;
{
  const h = replay(
    [
      CHAPTER_HALL,
      '>> w',
      CHAMBER,
      ...PORT_NORTH,
      FORECOURT,
      '>> enter portal',
      '|> You step into the portal.',
      CHAMBER,
      '@3600',
      ...PORT_NORTH,
      NIGHT_ARRIVAL,
      '>> e',
      NIGHT_STEP,
      // (the hub's east exit leads to the Chapter Hall, whose southeast door
      // is open: a door closed out here is not that one)
      '>> close se door',
      '|You close the oak door.',
      '>> e',
      NIGHT_STEP,
      '>> s',
      '>> n',
      GATEHOUSE,
      TRAINING_HALL,
    ].join('\n')
  );
  const chamber = h.named('Portal Chamber')[0];
  const hub = h.townOf(chamber)!;
  const forecourt = h.named('Forecourt')[0];
  const gatehouse = h.named('Gatehouse')[0];
  const training = h.named('Training Hall')[0];
  check(
    h.kinds().endsWith('Portal Chamber:entered | Gatehouse:entered | Training Hall:new-room'),
    `H: the Gatehouse is an entry, the n typed ahead maps on from it (${h.kinds()})`
  );
  const chapter = h.named('Chapter Hall')[0];
  check(
    JSON.stringify(chapter?.openDoorDirs) === '["se"]',
    `H: the dark steps never walked the hub's links (${JSON.stringify(chapter?.openDoorDirs)})`
  );
  const dest = h.r.townMap.getPortalDest({ townId: hub.id, roomId: chamber.id }, 'north');
  check(
    dest?.roomId === forecourt?.id && dest?.townId === h.townOf(forecourt)?.id,
    `H: the north portal still leads to the Forecourt (${JSON.stringify(dest)})`
  );
  check(!!gatehouse && !gatehouse.portal, 'H: the Gatehouse is no portal room');
  check(
    !!training && gatehouse?.links.n === training.id && gatehouse.links.s === undefined,
    `H: Gatehouse -n-> Training Hall, its spent s left nothing (${JSON.stringify(gatehouse?.links)})`
  );
  check(h.townOf(gatehouse) !== hub, 'H: the Gatehouse is not filed into the hub');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'H: queue drained');

  // A teleport into an unlit room (synthetic: the OOC realm and the Cave of
  // Spirits are lit): the way back is still the room it left
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const street = loc.onRoomBlock(parse(STREET), null, 1_000).pos;
  loc.trackCommand('plane shift', 1_100);
  loc.onTeleport();
  loc.onDarkArrival(1_200);
  check(
    JSON.stringify(map.teleportReturn) === JSON.stringify(street),
    `H: the way back is Main Street (${JSON.stringify(map.teleportReturn)})`
  );
  loc.trackCommand('n', 1_300);
  const lit = loc.onRoomBlock(parse(SQUARE), null, 1_400);
  check(
    lit.kind === 'entered' && loc.pendingMoves.length === 0,
    `H: the next lit room is an entry, its own move spent (${lit.kind}, ${loc.pendingMoves.length} queued)`
  );

  // A transit line while the engine is inactive (the app just started: no
  // room block yet) into an unlit room: the dark line is still the arrival,
  // and the lit room reached after it is no portal room
  const m2 = new TownMapStore();
  const l2 = new TownLocalizer(m2);
  l2.onPortalTransit('north');
  l2.onDarkArrival(1_000);
  const lit2 = l2.onRoomBlock(parse(SQUARE), null, 1_100);
  check(
    lit2.kind === 'entered' && !m2.room(lit2.pos)?.portal,
    `H: inactive: the lit room is no portal arrival (${lit2.kind}, portal ${m2.room(lit2.pos)?.portal})`
  );
}

// --- I: a dark step along a walked named exit ---------------------------------------------
// session_2026-08-25T01-56-18-669.log: at dusk the Blue Pearl's Garden Courtyard
// -[enter pool]-> Pool -[out]-> Garden Courtyard is walked (16750-16788); at
// night "out" of the shallow end prints the dark (17662), a look the dark
// again, and "n" the lit Salon. The dark step follows the walked "out", so the
// Salon is the Garden's walked n, not a correlation guess from the pool.
const SALON_DUSK = `|Salon
|This large, airy room is the salon of the Blue Pearl.  The walls are white stone
|and the ceiling is vaulted high overhead.  The floor is covered with a plush rug
|and scattered about are several soft cushions and some somewhat low tables.  The
|purple light of sunset filters in through the latticework of a pair of high
|windows.  There are a few brass oil lamps suspended from the ceiling which
|provide a warm illumination.  Some musicians play concealed behind a wooden
|screen.  An open, pointed archway to the south leads out into the garden and to
|the north is the foyer.  It is dimly lit.
|There are four exits: north, south, west, and east.
|Zandra the serving girl (kneeling on the floor).`;
const GARDEN = `|Garden Courtyard
|This is a tranquil courtyard filled with exotic flowers and trees covered with
|blossoms.  In the center of the courtyard is a large pool and on the east side
|several balconies overlook the garden.  The heat of afternoon has faded and
|evening shadows pool in the garden.  Several benches are placed around the
|garden giving patrons a peaceful place to relax.  It is dimly lit.  The air is
|quite warm.
|There is one obvious exit: north.`;
const POOL = `|You wade into the pool.
|Pool
|The shallow end of the pool.  It is dimly lit.  The air is quite warm.
|There are two exits: out and south.`;
const GARDEN_DARK = `|It is pitch black.  You smell the delicate scent of night blooming flowers.  You
|hear the sweet song of nightingales.`;
const SALON_NIGHT = `|Salon
|This large, airy room is the salon of the Blue Pearl.  The walls are white stone
|and the ceiling is vaulted high overhead.  The floor is covered with a plush rug
|and scattered about are several soft cushions and some somewhat low tables.
|Silvery starlight filters in through the latticework of a pair of high windows.
|There are a few brass oil lamps suspended from the ceiling which provide a warm
|illumination.  Some musicians play concealed behind a wooden screen.  An open,
|pointed archway to the south leads out into the garden and to the north is the
|foyer.  It is dimly lit.
|There are four exits: north, south, west, and east.
|Zandra the serving girl (kneeling on the floor).`;
{
  const h = replay(
    [
      SALON_DUSK,
      '>> s',
      GARDEN,
      '>> enter pool',
      POOL,
      '>> out',
      GARDEN,
      '>> enter pool',
      POOL,
      '@1200',
      '>> out',
      GARDEN_DARK,
      '>> l',
      GARDEN_DARK,
      '>> n',
      SALON_NIGHT,
    ].join('\n')
  );
  const last = h.blocks[h.blocks.length - 1];
  check(
    last.name === 'Salon' &&
      last.res.kind === 'expected' &&
      last.res.moved?.kind === 'dir' &&
      last.res.moved.dir === 'n',
    `I: the Salon is the Garden's walked n (${h.kinds()})`
  );
  check(
    h.named('Salon').length === 1 &&
      h.named('Garden Courtyard').length === 1 &&
      h.named('Pool').length === 1,
    `I: no room duplicated (${h.rooms().map((x) => x.name)})`
  );
  check(h.r.townLocalizer.pendingMoves.length === 0, 'I: queue drained');
}

// --- J: where a transit into the dark led, nothing local says ------------------------------
// After a portal or teleport into an unlit room, the lit room the player walks
// on to is a fresh entry. Not the room left: a same-named lit room elsewhere,
// resumed onto it, would overwrite its text and keep the position in the old
// town. Not where the hex the owner passes points: that is the last survey's,
// the departure town's way in. Read, it would make a room named like the
// hex's room the arrival; learned, it would take the departure town's key
// (one hex leads into one place: TownMapStore.setAnchor).
const GATE_ELSEWHERE = `|North Gate
|A low stone arch in the wall of a hill fort opens onto the moor to the south.  It is dim.
|There are two exits: north and south.`;
const holders = (map: TownMapStore, key: string) =>
  [...map.towns.values()].filter((t) => t.anchors[key] !== undefined).map((t) => t.name);
{
  /** Entered at the North Gate (from `hex` — the plains south of it), the
   *  player walks n to Main Street, steps through a portal there (or at the
   *  gate itself) into an unlit room, then n into the lit room `lit` */
  const night = (lit: string, hex: string | null, fromGate = false) => {
    const map = new TownMapStore();
    const loc = new TownLocalizer(map);
    const gate = loc.onRoomBlock(parse(GATE), hex, 1_000).pos!;
    if (!fromGate) {
      loc.trackCommand('n', 1_100);
      loc.onRoomBlock(parse(STREET), hex, 1_200);
    }
    loc.trackCommand('enter portal', 1_300);
    loc.onPortalTransit(null);
    loc.onDarkArrival(1_400);
    loc.trackCommand('n', 1_500);
    const res = loc.onRoomBlock(parse(lit), hex, 1_600);
    return { map, gate, res };
  };
  const learn = night(SQUARE, '0:3,4');
  check(
    learn.res.kind === 'entered' && learn.res.pos?.townId !== learn.gate.townId,
    `J: the lit room is an entry of its own (${learn.res.kind} ${JSON.stringify(learn.res.pos)})`
  );
  check(
    JSON.stringify(holders(learn.map, '0:3,4')) === '["North Gate"]',
    `J: the North Gate keeps its hex (${holders(learn.map, '0:3,4')})`
  );
  const read = night(GATE_ELSEWHERE, '0:3,4');
  check(
    read.res.kind === 'entered' && read.res.pos?.townId !== read.gate.townId,
    `J: a gate named like the hex's room is not it (${JSON.stringify(read.res.pos)})`
  );
  const left = night(GATE_ELSEWHERE, null, true);
  check(
    left.res.kind === 'entered' && left.res.pos?.townId !== left.gate.townId,
    `J: a gate named like the room left is not it (${JSON.stringify(left.res.pos)})`
  );
}

fx.remove();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-dark-arrival: all checks passed');
