/**
 * Regression test: "What ?" replies and named-exit sanity (Oct 2026 deep
 * dive, duplicates/commands lenses).
 *
 * LIVE failure (Bill's map-mazorn.json, July 16 2026 — the day the town
 * mapper was switched off): his `port` alias sends "activate portal" +
 * "enter portal". Outside a portal room both draw "What ?", which no
 * movement-failure pattern recognized, so the dead "enter portal" claimed
 * his next real step: the Forecourt got a named link "enter portal" to a
 * phantom Market, three more phantom Market/Forecourt rooms followed, and
 * the plaza center was overwritten with the SE corner's exits.
 *
 * Replies arrive in command order but say nothing about WHICH command they
 * answer, and ordinary commands draw the same reply, so
 * TownLocalizer.onUnknownCommand attributes them in order:
 *  1. `port` (session_2026-07-16T18-04-45-303.log:518): the first "What ?"
 *     is "activate portal"'s, the second fails "enter portal".
 *  2. A failing ordinary command typed before a valid named move ("unlock
 *     door", then "enter shop") keeps the move.
 *  3. The app's own syncs (login commands, alignment / who / equip timers)
 *     never draw "What ?" and are never logged: live, the 07-16 `port` came
 *     right after an alignment / who / equip sync, and counting those would
 *     have credited both replies to them.
 *  4. "<Verb> what?" names its command: "Enter what?" fails the oldest
 *     queued "enter ..." even behind a direction typed later
 *     (session_2026-07-17T15-20-09-617.log:1083); "Leave what?" fails
 *     nothing — "leave" is the party command, not a move.
 *  5. Named-exit sanity (session_2026-07-18T01-32-16-462.log:15700): "out"
 *     from the Armory, whose exits line lists no "out" — its "What ?" was
 *     credited to the "spp" (smoke pipe) sent just before it, so the queue
 *     repair must drop it when the `door s` arrival comes; it used to file
 *     the Bailey as a new room behind a false "out" link. Also in a room
 *     whose exits line lists only named exits ("back").
 *  6. A movement-mode move the server rejects ("lead e" with nobody to
 *     lead answers "What ?") is failed like a named move.
 *  7. A bare Enter (the app sends '' through the tracker) draws no reply at
 *     all, so it owes none.
 *  8. Leaving town settles every reply owed: commands sent after the last
 *     consumed move (the "out" that left is never consumed — a survey
 *     answers it) used to take the next visit's first "What ?" replies.
 *  9. A consumed move settles every command sent before it.
 * 10. A reply nothing is owed for (a typo sent while walking into town,
 *     before the town engine was active) is not banked for a later command.
 */
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 70),
  desc,
  exits: parseTownExits(exits),
});
const rooms = (map: TownMapStore) => [...map.towns.values()].flatMap((t) => [...t.rooms.values()]);

// Real Eris texts (July 2026)
const MARKET_E = block(
  'Market',
  'There are four exits: east, west, north, and south.',
  'This is a spacious market square in the heart of Eris.  A few housewives are about shopping for groceries for the day.  This is the east side of the market and a cobblestone road east leads towards a ferry landing on the shore of the Sea of Eris.  It is painfully bright.'
);
const WHARF = block(
  'Wharf Street',
  'There are two exits: east and west.',
  'This is a cobblestone paved street leading between the ferry landing to the east the market square to the west.  Buildings on either side of the street seem to be warehouses.  It is painfully bright.'
);
const ALLEY = block(
  'Alley',
  'There is one obvious exit: east.',
  'A narrow alley squeezed between two tall warehouses.  It is shadowy.'
);
const SHOP = block(
  'Gem Shop',
  'There is one obvious exit: out.',
  'A small, plain shop dealing in wares most extravagant.  It is bright.'
);

/** Market east side, `port` in it, then `e` to Wharf Street */
function portThenEast(before: string[], replies: number) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(MARKET_E, null, (t += 1000));
  for (const c of before) loc.trackCommand(c, (t += 100));
  loc.trackCommand('activate portal', (t += 100));
  loc.trackCommand('enter portal', t);
  const failed: boolean[] = [];
  for (let i = 0; i < replies; i++) failed.push(loc.onUnknownCommand(null));
  const queued = loc.pendingMoves.length;
  loc.trackCommand('e', (t += 500));
  const res = loc.onRoomBlock(WHARF, null, (t += 300));
  const market = rooms(map).find((r) => r.name === 'Market')!;
  return { map, loc, res, market, failed, queued };
}

// --- 1. port alias outside a portal: two "What ?" replies ------------------
{
  const { res, market, failed, queued, loc } = portThenEast([], 2);
  check(failed[0] === false && failed[1] === true, `1: replies attributed ${failed}`);
  check(queued === 0, `1: "enter portal" failed before the next block (${queued} queued)`);
  check(res.kind === 'new-room' && market.links.e !== undefined, `1: e resolved ${res.kind}`);
  check(market.namedLinks['enter portal'] === undefined, '1: no "enter portal" link recorded');
  check(loc.pendingMoves.length === 0, '1: queue drained');
}

// --- 2. order safety: a typo's "What ?" must not kill a valid named move ---
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(ALLEY, null, (t += 1000));
  loc.trackCommand('unlock door', (t += 100)); // not a move → "What ?"
  loc.trackCommand('enter shop', (t += 10)); // valid named move
  check(!loc.onUnknownCommand(null), "2: the typo's reply fails no move");
  const res = loc.onRoomBlock(SHOP, null, (t += 1000));
  check(res.kind === 'new-room' && res.moved?.kind === 'named', `2: named move kept (${res.kind})`);
  const alley = rooms(map).find((r) => r.name === 'Alley')!;
  check(alley.namedLinks['enter shop'] !== undefined, '2: shop linked via "enter shop"');
}

// --- 3. app syncs are not "What ?" sources ---------------------------------
{
  const { failed, queued, market } = portThenEast(['show alignment', 'who', 'equip held'], 2);
  check(failed[1] === true && queued === 0, `3: replies attributed ${failed} despite the syncs`);
  check(market.namedLinks['enter portal'] === undefined, '3: no "enter portal" link recorded');
  // ... while an ordinary command typed there still takes the first reply
  const typed = portThenEast(['l stall'], 2);
  check(
    typed.failed.join() === 'false,false',
    `3: a typed command takes a reply (${typed.failed})`
  );
}

// --- 4. "<Verb> what?" -------------------------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(MARKET_E, null, (t += 1000));
  loc.trackCommand('activate portal', (t += 100));
  loc.trackCommand('enter portal', t);
  loc.onUnknownCommand(null); // activate's
  loc.trackCommand('e', (t += 100)); // typed before the next reply
  check(loc.onUnknownCommand('Enter'), '4: "Enter what?" fails the queued enter');
  check(
    loc.pendingMoves.length === 1 && loc.pendingMoves[0].kind === 'dir',
    '4: the direction typed after it stays queued'
  );
  check(!loc.trackCommand('leave aprty', (t += 100)), '4: "leave" is not a move');
  check(!loc.onUnknownCommand('Leave'), '4: "Leave what?" fails nothing');
  const res = loc.onRoomBlock(WHARF, null, (t += 300));
  check(res.kind === 'new-room' && res.moved?.kind === 'dir', `4: e resolved ${res.kind}`);
  // The verb picks its move even when another move heads the queue
  loc.trackCommand('lead w', (t += 100));
  loc.trackCommand('enter warehouse', (t += 100));
  check(loc.onUnknownCommand('Enter'), '4: "Enter what?" fails the enter behind "lead w"');
  const q = loc.pendingMoves;
  check(q.length === 1 && q[0].kind === 'dir' && q[0].dir === 'w', '4: "lead w" stays queued');
}

// --- 5. named-exit sanity: "out" from a room whose exits lack it ------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const BAILEY_W = block(
    'Bailey',
    'There are four exits: a closed wrought iron gate leading west, east, south, and an open oak door leading north.',
    'This the western end of the compound within the walls of the fortress.  The ground is paved in broad flagstones and extends to the east towards the bulk of the keep.  It is bright.'
  );
  const ARMORY = block(
    'Armory',
    'There are two exits: a closed oak door leading south and west.',
    'This is a hot and smoky armory where rangers can work on the tools of their hazardous trade: blades and axes, shields and armor.  It is painfully bright.'
  );
  loc.onRoomBlock(BAILEY_W, null, (t += 1000));
  loc.trackCommand('n', (t += 100));
  loc.onRoomBlock(ARMORY, null, (t += 1000));
  const town = map.get(map.pos!.townId)!;
  const roomCount = town.rooms.size;
  loc.trackCommand('spp', (t += 2000)); // smoke pipe: answered with prose
  loc.trackCommand('out', (t += 1000)); // dead: the Armory has no "out"
  check(!loc.onUnknownCommand(null), '5: the "What ?" is credited to the earlier command');
  // `door s`: unlock / open / move / close / lock
  for (const c of ['unlock s door with key', 'open s door', 's', 'close n door', 'lock n door']) {
    loc.trackCommand(c, (t += 5));
  }
  const res = loc.onRoomBlock(BAILEY_W, null, (t += 300));
  const armory = rooms(map).find((r) => r.name === 'Armory')!;
  check(res.kind === 'expected' && res.moved?.kind === 'dir', `5: "door s" arrival ${res.kind}`);
  check(
    town.rooms.size === roomCount,
    `5: no duplicate Bailey (${roomCount} -> ${town.rooms.size})`
  );
  check(armory.namedLinks.out === undefined, '5: no "out" link from the Armory');
  check(loc.pendingMoves.length === 0, '5: queue drained');
  // ... also when the next step lands somewhere that does not list the way
  // back (a one-way passage), so no later direction explains the block
  loc.trackCommand('n', (t += 1000));
  loc.onRoomBlock(ARMORY, null, (t += 300));
  const FORGE = block(
    'Forge Pit',
    'There is one obvious exit: north.',
    'A sunken pit below the armory floor where the great forge was once fired.  It is dim.'
  );
  loc.trackCommand('out', (t += 1000)); // dead again, reply not attributed
  loc.trackCommand('w', (t += 500));
  const r2 = loc.onRoomBlock(FORGE, null, (t += 300));
  check(r2.kind === 'new-room' && r2.moved?.kind === 'dir', `5: one-way w resolved ${r2.kind}`);
  check(armory.links.w === r2.pos?.roomId, '5: Armory -w-> Forge Pit');
  check(armory.namedLinks.out === undefined, '5: still no "out" link');
}
// ... in a room whose exits line lists only a named exit
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const NICHE = block(
    'Prayer Niche',
    'There is one obvious exit: back.',
    'A tiny niche carved into the chapel wall, just deep enough to kneel in.  It is dim.'
  );
  const CHAPEL = block(
    'Chapel',
    'There are two exits: north and south.',
    'A cool stone chapel with rows of worn wooden pews.  It is dim.'
  );
  loc.onRoomBlock(NICHE, null, (t += 1000));
  loc.trackCommand('spp', (t += 1000)); // answered with prose
  loc.trackCommand('out', (t += 1000)); // dead: the niche lists only "back"
  check(!loc.onUnknownCommand(null), '5b: the "What ?" is credited to the earlier command');
  loc.trackCommand('back', (t += 1000));
  const res = loc.onRoomBlock(CHAPEL, null, (t += 300));
  const niche = rooms(map).find((r) => r.name === 'Prayer Niche')!;
  check(res.kind === 'new-room' && res.moved?.kind === 'named', `5b: back resolved ${res.kind}`);
  check(niche.namedLinks.back === res.pos?.roomId, '5b: niche -[back]-> chapel');
  check(niche.namedLinks.out === undefined, '5b: no "out" link from the niche');
}

// --- 6. a rejected movement-mode move ---------------------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(MARKET_E, null, (t += 1000));
  check(loc.trackCommand('lead e', (t += 100)), '6: "lead e" (Leading mode) is tracked');
  check(loc.onUnknownCommand(null), '6: its "What ?" fails it');
  check(loc.pendingMoves.length === 0, '6: nothing left queued');
}

// --- 7. a bare Enter owes no reply -------------------------------------------
{
  const { failed, queued, market } = portThenEast(['', '  '], 2);
  check(failed.join() === 'false,true', `7: replies attributed ${failed} after bare Enters`);
  check(
    queued === 0 && market.namedLinks['enter portal'] === undefined,
    '7: "enter portal" failed'
  );
}

// --- 8. leaving town (or the connection) settles every reply owed ------------
for (const leave of ['survey', 'reconnect'] as const) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(SHOP, null, (t += 1000));
  loc.trackCommand('say good day', (t += 100)); // answered with prose
  loc.trackCommand('out', (t += 100)); // onto a street outside town: a survey answers it
  if (leave === 'survey') loc.onWilderness();
  else loc.reset(); // ... or the connection dropped
  loc.onRoomBlock(MARKET_E, null, (t += 60_000)); // in town again
  loc.trackCommand('activate portal', (t += 100));
  loc.trackCommand('enter portal', t);
  const failed = [loc.onUnknownCommand(null), loc.onUnknownCommand(null)];
  check(failed.join() === 'false,true', `8 (${leave}): replies attributed ${failed} afterwards`);
  check(loc.pendingMoves.length === 0, `8 (${leave}): "enter portal" failed`);
}

// --- 9. a consumed move settles every command sent before it ----------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(MARKET_E, null, (t += 1000));
  loc.trackCommand('say good day', (t += 100)); // answered with prose
  loc.trackCommand('e', (t += 100));
  loc.onRoomBlock(WHARF, null, (t += 300)); // the say ran before the e
  loc.trackCommand('activate portal', (t += 100));
  loc.trackCommand('enter portal', t);
  const failed = [loc.onUnknownCommand(null), loc.onUnknownCommand(null)];
  check(failed.join() === 'false,true', `9: replies attributed ${failed}`);
}

// --- 10. a reply nothing is owed for is not banked ---------------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  loc.onRoomBlock(ALLEY, null, (t += 1000)); // a typo sent on the way in, before
  check(!loc.onUnknownCommand(null), '10: ... draws its "What ?" here: nothing to fail');
  loc.trackCommand('unlock door', (t += 100)); // not a move → "What ?"
  loc.trackCommand('enter shop', (t += 10)); // valid named move
  check(!loc.onUnknownCommand(null), "10: the second typo's reply fails no move either");
  const res = loc.onRoomBlock(SHOP, null, (t += 1000));
  check(
    res.kind === 'new-room' && res.moved?.kind === 'named',
    `10: named move kept (${res.kind})`
  );
}

process.exit(fail ? 1 : 0);
