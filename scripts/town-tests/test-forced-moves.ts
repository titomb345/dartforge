/**
 * Regression test: forced moves reach the town engine (Oct 2026 deep dive,
 * commands lens).
 *
 * A group leader moving the player prints "<Leader> leads you <move>." and
 * then the arrival block — no command of the player's explains it. Only the
 * hex parser read these lines, and only for hex directions, so in town every
 * led step was an unexplained block: the 18 led town moves of the DF corpus
 * resolved only because their rooms were already linked, an unmapped
 * destination became a floater with no link, and with moves of the player's
 * own queued the led room was filed under the player's move.
 *
 *  A. session_2026-09-17T02-43-52-553.log:12325-12345: Esira leads Mazorn up
 *     from the Healer's Hall to the Landing, then south to the Library —
 *     both rooms unmapped: linked u and s like typed moves.
 *  B. A move the player queued runs AFTER the led step (the look of
 *     :12347): the led room is not filed under it.
 *  C. Every corpus form: named moves ("Arthur leads you enter clearing."),
 *     exit words ("leads you path."), the period-less "Rikter leads you off
 *     to the west" (dm-2022-12-10.txt:7615).
 *  D. A forced move draws no reply: "What ?" / "Enter what?" answering one
 *     of the player's own commands never fails it.
 *  E. Outdoors the town engine takes nothing.
 *  F. The line pattern.
 *  G. A full queue drops the newest typed move to make room for a led one.
 */
import { TOWN_FORCED_MOVE_RE } from '../../src/lib/townParser';
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
const fx = new SessionFixture('forced-moves-');
function replay(text: string) {
  const blocks: { name: string; res: TownResolution }[] = [];
  const r = new TownReplay(
    { expand: (raw) => expand(raw) },
    { onBlock: ({ block, res }) => blocks.push({ name: block.name, res }) }
  );
  r.replayLog(fx.write(text));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  const here = (): TownRoom | undefined => r.townMap.room(r.townMap.pos);
  const kinds = () => blocks.map((b) => `${b.name}:${b.res.kind}`).join(' | ');
  return { r, blocks, named, here, kinds };
}

const HEALERS_HALL = `|Healer's Hall
|This is an open and airy guest hall with a lofty ceiling.  The walls are
|gleaming white with a geometric rose design border at the ceiling and the
|travertine floor is covered by a thick, soft rug.  Cushions have been placed
|about the room to offer weary patients and travelers a place to sit.  The room
|is furnished with an elegant rosewood cupboard, a low table and a bookshelf.
|The purple light of sunset streams in through broad windows on the east and west
|walls.  Near the door to the south is a small silver gong, no more than two
|handspans in diameter and a pair of signs are posted on the door itself.  A set
|of broad stairs ascends in a gentle curve to the north.  It is blindingly
|bright.
|There are three exits: north, an open rosewood door leading south, and up.
|Esira the halfling.`;
const LANDING = `|Landing
|This is a short hallway on the second floor of the guest hall.  The walls are
|finished a gleaming white and the floor is white travertine.  Daylight streams
|in through a circular window to the east.  An elegant staircase curves down to
|the lower floor.  It is bright.
|There are two exits: an open rosewood door leading south and down.
|Esira climbs up the staircase from the down.`;
const LIBRARY = `|Library
|This is a peaceful and comfortable library on the second floor of the guild
|hall.  The walls are covered in a mosaic of many colored tiles and on the floor
|is a thick rug.  A large rosewood bookcase takes up the most of one wall.  At
|the south end of the room a few chairs and a low table are placed in a cozy
|grouping in front of a stone fireplace.  It is bright.
|There are two exits: an open rosewood door leading north and a closed rosewood
|door leading west.
|Esira shuffles in from the north.`;

// --- A: led into unmapped rooms ---------------------------------------------
{
  const h = replay(
    [
      HEALERS_HALL,
      '|Esira waves.',
      '|Esira leads you up.',
      LANDING,
      '|Esira leads you south.',
      LIBRARY,
    ].join('\n')
  );
  const hall = h.named("Healer's Hall")[0];
  const landing = h.named('Landing')[0];
  const library = h.named('Library')[0];
  check(
    h.kinds() === "Healer's Hall:entered | Landing:new-room | Library:new-room",
    `A: led steps map like typed ones (${h.kinds()})`
  );
  check(!!landing && hall?.links.u === landing.id, "A: Healer's Hall -u-> Landing");
  check(!!library && landing?.links.s === library.id, 'A: Landing -s-> Library');
  check(landing?.z === (hall?.z ?? 0) + 1, 'A: the Landing is one floor up');
  check(h.r.stats.forcedMoves === 2, `A: two forced moves queued (${h.r.stats.forcedMoves})`);
}

// --- B: the player's own queued move runs after the led step ------------------
{
  const h = replay(
    [
      HEALERS_HALL,
      '>> l',
      '|Esira leads you up.',
      LANDING,
      LANDING.replace(/\|Esira.*$/m, ''),
    ].join('\n')
  );
  check(
    h.kinds() === "Healer's Hall:entered | Landing:new-room | Landing:stationary",
    `B: led room first, then the look's re-print (${h.kinds()})`
  );
  check(h.named('Landing').length === 1, 'B: one Landing');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: queue drained');
}

// --- C: every corpus form ------------------------------------------------------
const FIELD = `|Field\n|You are standing in an open field at the edge of a dark forest.  It is bright.\n|There are three exits: north, south, and west.`;
const CLEARING = `|Clearing\n|A small clearing in the forest, ringed by tall pines.  It is bright.\n|There is one obvious exit: out.`;
const SWAMP = `|Swamp\n|You can't see anything but swamp all around.  It is blindingly bright here.\n|There are four exits: west, north, south, and east.`;
const TRAIL = `|Trail\n|A narrow trail winds between the dunes toward the sea.  It is bright.\n|There are two exits: path and north.`;
const BEACH = `|Beach\n|Waves roll in over the sand of a wide, empty beach.  It is bright.\n|There are two exits: path and south.`;
{
  const h = replay([FIELD, '|> Arthur leads you enter clearing.', CLEARING].join('\n'));
  const field = h.named('Field')[0];
  check(
    !!field && field.namedLinks['enter clearing'] === h.named('Clearing')[0]?.id,
    `C: Field -[enter clearing]-> Clearing (${JSON.stringify(field?.namedLinks)})`
  );
  const s = replay([FIELD, '|Rikter leads you off to the west', SWAMP].join('\n'));
  check(
    s.named('Field')[0]?.links.w === s.named('Swamp')[0]?.id,
    `C: "off to the west" is the w move (${s.kinds()})`
  );
  const t = replay([TRAIL, '|Arthur leads you path.', BEACH].join('\n'));
  const trail = t.named('Trail')[0];
  check(
    !!trail && trail.namedLinks.path === t.named('Beach')[0]?.id,
    `C: an exit word the leader walked is a named move (${JSON.stringify(trail?.namedLinks)})`
  );
}

// --- D: a forced move draws no reply -------------------------------------------
{
  // "What ?" for the player's typo arrives between the lead and its block
  const h = replay(
    [FIELD, '>> xyzzy', '|Arthur leads you enter clearing.', '|What ?', CLEARING].join('\n')
  );
  check(
    h.named('Field')[0]?.namedLinks['enter clearing'] === h.named('Clearing')[0]?.id,
    `D: "What ?" for a typo leaves the led move queued (${h.kinds()})`
  );
  // "Enter what?" names the player's own failed enter, not the leader's
  const k = replay(
    [FIELD, '>> enter tent', '|Arthur leads you enter clearing.', '|Enter what?', CLEARING].join(
      '\n'
    )
  );
  const f = k.named('Field')[0];
  check(
    f?.namedLinks['enter clearing'] === k.named('Clearing')[0]?.id &&
      f.namedLinks['enter tent'] === undefined,
    `D: "Enter what?" fails "enter tent", not the led "enter clearing" (${JSON.stringify(f?.namedLinks)})`
  );
}

// --- E: outdoors the town engine takes nothing ----------------------------------
{
  const loc = new TownLocalizer(new TownMapStore());
  check(!loc.onForcedMove('north', 1_000), 'E: inactive: not queued');
  check(loc.pendingMoves.length === 0, 'E: queue empty');
}

// --- F: the line pattern ------------------------------------------------------
for (const [line, move] of [
  ['Esira leads you up.', 'up'],
  ['> Arthur leads you enter clearing.', 'enter clearing'],
  ['Rikter leads you off to the west', 'west'],
  ['Baroness Zorp leads you north.', 'north'],
  ["Mash'al leads you southwest.", 'southwest'],
  ['Arthur leads you enter north portal.', 'enter north portal'],
] as const) {
  const m = TOWN_FORCED_MOVE_RE.exec(line);
  check(m?.[1] === move, `F: "${line}" -> "${move}" (got ${m?.[1]})`);
}
for (const line of [
  "Moirai asks in common, 'Is that when ricky leads you around?'",
  'You lead Esira north.',
  'Esira leads Rikter north.',
]) {
  check(!TOWN_FORCED_MOVE_RE.test(line), `F: not a forced move: "${line}"`);
}

// --- G: a full queue drops the newest typed move, never the led one ----------------
// (QUEUE_MAX_LEN = 30: the server runs every command in order, so the head
// must stay aligned and only the newest move's block falls back to correlation)
{
  const loc = replay(FIELD).r.townLocalizer;
  for (let i = 0; i < 30; i++) loc.trackCommand(i % 2 ? 'n' : 's', 2_000 + i);
  check(loc.pendingMoves.length === 30, `G: fixture: a full queue (${loc.pendingMoves.length})`);
  check(loc.onForcedMove('west', 3_000), 'G: the led move is queued');
  const q = loc.pendingMoves;
  const head = q[0];
  check(
    q.length === 30 && head.kind === 'dir' && head.dir === 'w' && head.forced === true,
    `G: the led move heads a full queue (${q.length} queued)`
  );
  check(
    q[1]?.at === 2_000 && q[q.length - 1]?.at === 2_028,
    'G: the newest typed move is the one dropped'
  );
}

fx.remove();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-forced-moves: all checks passed');
