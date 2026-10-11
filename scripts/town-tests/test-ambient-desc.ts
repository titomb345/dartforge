/**
 * Regression test: ambient world-state sentences are not room identity.
 *
 * descKey (and so descAgrees, the desc vetoes and every desc tiebreak)
 * stripped only the "It is ..." lighting sentence. Two more sentences come
 * and go on a room whose prose never changes, from closed vocabularies mined
 * from both corpora:
 *  - weather, always the description's last sentence: "The air is quite
 *    warm/humid/chilly/dry." — no other value exists, and other "The air
 *    is ..." sentences ("very moist here") are room prose and stay;
 *  - temple portal fire, while a portal is active: "A sheet of silvery-white
 *    fire fills the [north ]portal[ and the west portal]."
 * Present or absent — never a one-sentence swap — so the volatile-prose
 * learner never learned the portal line, and at the END of the text the
 * suffix tolerance doesn't absorb a weather line either. A block carrying
 * "The air is quite chilly." disagreed with the same room stored without it:
 * after an unlogged walk (session_2026-07-06T02-10-10-259.log:1297-1385) two
 * Market blocks became desc floaters and the east Garrison Road segment and
 * the Bailey's east end were swallowed as re-prints of their western
 * neighbours. And the learner spent its 64 slots on chilly<->warm swaps.
 */
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';
import { TownMapStore, descKey, descUsable } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// --- descKey ------------------------------------------------------------
const MARKET_N =
  'This is a spacious market square in the heart of Eris.  The market is mostly ' +
  'empty except for a few adventurers and revelers heading home from the inn.  This ' +
  'appears to be the northern edge of the market.  It is bright.';
for (const weather of ['warm', 'humid', 'chilly', 'dry']) {
  check(
    descKey(`${MARKET_N}  The air is quite ${weather}.`) === descKey(MARKET_N),
    `weather "${weather}" is stripped`
  );
}
// wrapped across lines (the parser joins them with a space; a trailing space
// on the first line doubles it)
check(
  descKey(`${MARKET_N}  The air is quite \nchilly.`.replace(/\n/, ' ')) === descKey(MARKET_N),
  'a wrapped weather sentence is stripped'
);
const FORECOURT =
  'This is a cobblestone paved courtyard in front of the Luminarian church.  To the ' +
  'south side is an arch-like portal.  It is bright.';
const FORECOURT_FIRE =
  'This is a cobblestone paved courtyard in front of the Luminarian church.  To the ' +
  'south side is an arch-like portal.  A sheet of silvery-white fire fills the portal.  It is bright.';
check(descKey(FORECOURT_FIRE) === descKey(FORECOURT), 'portal fire (Forecourt) is stripped');
const CHAMBER =
  'This is a large open room ringed by seven arch-shaped portals of some dark bluish stone.';
for (const fire of [
  'A sheet of silvery-white fire fills the north portal.',
  'A sheet of silvery-white fire fills the west portal and the north portal.',
  'A sheet of silvery-white fire fills the  west portal and the northeast portal.',
]) {
  check(
    descKey(`${CHAMBER}  ${fire}  It is bright.`) === descKey(CHAMBER),
    `portal fire "${fire}" is stripped`
  );
}
// closed sets only: other "The air is ..." sentences are the room's own prose
for (const own of [
  'The air is very moist here.',
  'The air is freezing cold, but the view is incredible.',
  'The air is stale.',
]) {
  check(
    descKey(`A small tunnel winds through the rock here.  ${own}`).includes(own),
    `"${own}" is kept`
  );
}
check(
  !descUsable('It is bright.  The air is quite warm.'),
  'a text of only lighting and weather carries no identity'
);

// --- descAgrees + the correlation it feeds --------------------------------
// The two Garrison Road segments, word-identical but for their middle
// sentence (session_2026-07-06T02-10-10-259.log:1318-1327)
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 80),
  desc,
  exits: parseTownExits(exits),
});
const GR_WEST =
  'This is a coblestone paved road along the northern edge of the burgeoning town ' +
  'growing on the shore of the Sea of Eris.  The road leads west towards the ' +
  'intersection with Ash Street and east towards a fortification on a spit of land ' +
  'jutting out into the water.  It is bright.';
const GR_EAST =
  'This is a coblestone paved road along the northern edge of the burgeoning town ' +
  'growing on the shore of the Sea of Eris.  The road leads west towards an ' +
  'intersection in the distance and to the east is a fortification on a spit of ' +
  'land jutting out into the water.  It is bright.';
const EXITS = 'There are two exits: west and east.';
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1_000_000;
  loc.onRoomBlock(block('Garrison Road', EXITS, GR_WEST), null, t);
  loc.trackCommand('e', (t += 500));
  loc.onRoomBlock(block('Garrison Road', EXITS, GR_EAST), null, (t += 300));
  loc.trackCommand('w', (t += 500));
  const back = loc.onRoomBlock(block('Garrison Road', EXITS, GR_WEST), null, (t += 300));
  const town = map.get(map.pos!.townId)!;
  const west = map.pos!.roomId;
  const east = town.rooms.get(west)!.links.e;
  check(back.kind === 'expected' && east !== undefined, 'two linked segments mapped');
  check(
    map.descAgrees(
      town.rooms.get(east!)!,
      block('Garrison Road', EXITS, `${GR_EAST}  The air is quite chilly.`)
    ),
    'the east segment agrees with itself under weather'
  );
  // An unlogged walk step east (a walk executor send, an alias): no queued
  // move, the block carries weather the stored text lacks. It must step to
  // the east segment, not be swallowed as a re-print of the west one.
  const res = loc.onRoomBlock(
    block('Garrison Road', EXITS, `${GR_EAST}  The air is quite chilly.`),
    null,
    (t += 1000)
  );
  check(
    res.kind === 'corrected' && map.pos?.roomId === east,
    `hidden step onto the east segment: ${res.kind} at #${map.pos?.roomId} (east is #${east})`
  );
  check(town.rooms.size === 2, `no duplicate segment (${town.rooms.size} rooms)`);
}

// --- Volatile learning never spends slots on ambient prose ------------------
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const MARKET_C =
    'This is a spacious market square in the heart of Eris.  The market is mostly ' +
    'empty except for a few adventurers and revelers heading home from the inn.  This ' +
    'appears to be the center of the market, and contains a well which provides the ' +
    'burgeoning town with clean water.  It is bright.';
  const mk = (desc: string, weather: string, exits: string) =>
    block('Market', exits, `${desc}  The air is quite ${weather}.`);
  const N_EXITS = 'There are four exits: north, east, south, and west.';
  const C_EXITS =
    'There are many exits: north, northeast, east, southeast, south, southwest, west, and northwest.';
  let t = 2_000_000;
  loc.onRoomBlock(mk(MARKET_N, 'chilly', N_EXITS), null, t);
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(mk(MARKET_C, 'chilly', C_EXITS), null, (t += 300));
  // the season turns; positively identified revisits of BOTH rooms (walked
  // links) see the weather swap
  loc.trackCommand('n', (t += 500));
  loc.onRoomBlock(mk(MARKET_N, 'warm', N_EXITS), null, (t += 300));
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(mk(MARKET_C, 'warm', C_EXITS), null, (t += 300));
  check(
    map.volatileSentences.size === 0,
    `no weather sentence learned as volatile prose (${JSON.stringify([...map.volatileSentences])})`
  );
}

if (failures > 0) {
  console.error(`${failures} ambient-desc assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: ambient weather / portal-fire sentences are stripped from description identity');
