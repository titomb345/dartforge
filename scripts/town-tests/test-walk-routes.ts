/**
 * Regression test: what the town auto-walker may plan through (walking +
 * persistence lenses, Oct 2026).
 *
 * A. findPath never routes through portal or boat commands. Every portal
 *    named link in the corpus replay was the residue of a FAILED "enter
 *    portal" (a real transit consumes the command before the arrival block)
 *    and points at whatever room the next real move reached: Bill's live
 *    save had "Market -[enter portal]-> Wharf Street", and 372 of its 8,961
 *    Eris routes went through such links (Healer's Garden -> Market = nw,
 *    nw, e, enter portal). Boats only take you aboard while docked.
 * B. findPath never takes a direction the room's own exits line has never
 *    listed — a queue-desync scar the next load would cut anyway.
 * C. link() infers no way back through an exit the destination never lists:
 *    the Segliz nets drop you north into a basement whose only exit is up
 *    (session_2026-07-25T20-28-24-529.log:2289); an inferred "s" there was a
 *    phantom exit the walker would take until the next load.
 * D. The load cleanse drops the named links failed commands forged — portal
 *    commands, self-links, "out"/"back"/"exit" from a room whose exits line
 *    lacks the word — and keeps the genuine ones.
 */
import { TownMapStore, walkableNamed, type TownRoom } from '../../src/lib/townMap';
import type { TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

let fail = false;
const expect = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};
const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `${name} description that is long enough to be usable.`,
  desc: `${name} description that is long enough to be usable.`,
  exits: parseTownExits(`There are exits: ${exits}.`),
});
const cmds = (p: { cmd: string }[] | null) => (p ? p.map((s) => s.cmd).join(',') : 'none');

// --- A: portal and boat commands are never walk steps ---
{
  const map = new TownMapStore();
  const town = map.createTown('Eris');
  const mk = (name: string, x: number, exits: string) =>
    map.addRoom(town, block(name, exits), x, 0, 0, 0);
  const market = mk('Market', 0, 'east and west');
  const wharf = mk('Wharf Street', 1, 'east and west');
  const ferry = mk('Ferry Landing', 2, 'west');
  const forecourt = mk('Forecourt', 5, 'west');
  const deck = mk('Oar Deck', 8, 'exit');
  map.link(town, market, 'e', wharf);
  map.link(town, wharf, 'e', ferry);
  map.linkNamed(market, 'enter portal', ferry); // residue of a failed `port`
  map.linkNamed(wharf, 'enter n portal', forecourt); // the only "route" to the Forecourt
  map.linkNamed(ferry, 'board galley', deck);
  const p1 = map.findPath(town, market.id, ferry.id);
  expect(cmds(p1) === 'e,e', `A: Market -> Ferry Landing walks e,e (got ${cmds(p1)})`);
  expect(map.findPath(town, market.id, forecourt.id) === null, 'A: no walk through a portal link');
  expect(map.findPath(town, ferry.id, deck.id) === null, 'A: no walk aboard a boat');
  for (const c of ['enter portal', 'enter n portal', 'board galley', 'disembark', 'enter galley']) {
    expect(!walkableNamed(c), `A: "${c}" is not walkable`);
  }
  for (const c of ['enter pool', 'out', 'climb branch', 'enter grave', 'exit']) {
    expect(walkableNamed(c), `A: "${c}" is walkable`);
  }
}

// --- B: a link through an exit the room never listed is no walk step ---
{
  const map = new TownMapStore();
  const town = map.createTown('Soriktos');
  const salon = map.addRoom(town, block('Salon', 'north and south'), 0, 0, 0, 0);
  const garden = map.addRoom(town, block('Garden Courtyard', 'north'), -1, 0, 0, 0);
  const hall = map.addRoom(town, block('Hallway', 'south'), 0, -1, 0, 0);
  salon.links.w = garden.id; // desync scar: the salon has no west exit
  map.link(town, salon, 'n', hall);
  expect(map.findPath(town, salon.id, garden.id) === null, 'B: no walk west out of the Salon');
  expect(cmds(map.findPath(town, salon.id, hall.id)) === 'n', 'B: listed exits still walk');
}

// --- C: no inferred way back through an exit the destination never lists ---
{
  const map = new TownMapStore();
  const town = map.createTown('Segliz');
  const main: TownRoom = map.addRoom(
    town,
    block('East End of Main', 'north, east, and west'),
    0,
    0,
    0,
    0
  );
  const basement = map.addRoom(town, block('Basement of the Harbor Warehouse', 'up'), 0, -1, 0, 0);
  const shop = map.addRoom(town, block('Chandlery', 'west'), 1, 0, 0, 0);
  map.link(town, main, 'n', basement); // "You push your way through the nets."
  map.link(town, main, 'e', shop);
  expect(main.links.n === basement.id, 'C: the walked link is recorded');
  expect(basement.links.s === undefined, 'C: no inferred "s" out of a room that only lists up');
  expect(shop.links.w === main.id, 'C: a listed way back is still inferred');
  expect(map.findPath(town, basement.id, main.id) === null, 'C: no walk back through the nets');
}

// --- D: the load cleanse drops forged named links, keeps real ones ---
{
  const map = new TownMapStore();
  const town = map.createTown('Eris');
  const forecourt = map.addRoom(town, block('Forecourt', 'west'), 0, 0, 0, 0);
  const market = map.addRoom(town, block('Market', 'east and west'), 1, 0, 0, 0);
  const islet = map.addRoom(town, block('Shady Islet', 'east and west'), 2, 0, 0, 0);
  const armory = map.addRoom(town, block('Armory', 'south and west'), 3, 0, 0, 0);
  const garden = map.addRoom(town, block('Garden Courtyard', 'north'), 4, 0, 0, 0);
  const pool = map.addRoom(town, block('Pool', 'out and south'), 5, 0, 0, 0);
  map.linkNamed(forecourt, 'enter portal', market); // a failed `port`
  map.linkNamed(islet, 'enter path', islet); // a failed "ep" eating a look's re-print
  map.linkNamed(armory, 'out', market); // "out" answered "What ?"
  map.linkNamed(garden, 'enter pool', pool); // genuine
  map.linkNamed(pool, 'out', garden); // genuine: the pool lists "out"
  const loaded = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
  const r = (id: number) => loaded.get(town.id)!.rooms.get(id)!;
  expect(Object.keys(r(forecourt.id).namedLinks).length === 0, 'D: portal named link dropped');
  expect(Object.keys(r(islet.id).namedLinks).length === 0, 'D: self-link dropped');
  expect(Object.keys(r(armory.id).namedLinks).length === 0, 'D: unlisted "out" dropped');
  expect(r(garden.id).namedLinks['enter pool'] === pool.id, 'D: "enter pool" kept');
  expect(r(pool.id).namedLinks.out === garden.id, 'D: listed "out" kept');
}

if (fail) process.exit(1);
console.log('PASS — walk routes');
