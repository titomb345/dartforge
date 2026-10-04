/**
 * Regression test: command tracking vs what the server really did (Oct
 * 2026 deep dive, commands lens). Every scenario is lifted from a real
 * session log and runs through the replay engine (scripts/lib/townReplay.ts:
 * real alias expansion, RoomParser move failures -> onMoveFailed, "What ?"
 * replies -> onUnknownCommand, portal transits, TownParser blocks), so it
 * pins the server-line wiring the live app must mirror.
 *
 *  A. `port` in a stable (session_2026-06-30T16-31-43-082.log:4300): "What ?"
 *     twice, then `e` — the dead "enter portal" used to claim the next
 *     Stable as a named-exit room (duplicate Stable, bogus links).
 *  B. Failed swims (session_2026-08-25T01-56-18-669.log:16807): "You splash
 *     around, but get nowhere." left every dead `n` queued — a column of
 *     phantom Pools.
 *  C. The skull trap (session_2026-07-13T03-35-32-238.log:8853): "Sparks
 *     flare up from the shimmering field as try to push through it." (sic)
 *     — the dead `u` built a phantom fourth stairwell floor.
 *  D. The OOC hall's guarded room (session_2026-07-16T18-04-45-303.log:356):
 *     "As you enter this room, a powerful force sends shivers of fear..."
 *     then the re-print — filed as a new "OOC Area" north on every try.
 *  E. "You try, but you cannot move in your current condition." (MUSH x4).
 *  F. DartMUD commands are case-sensitive ("W" / "OUT" draw "What ?"), and a
 *     movement verb ("lead e") is tracked — and failed by its "What ?". A
 *     name every object inherits ("constructor") is no direction.
 *  G. Moves typed after `port n` run at the destination
 *     (session_2026-06-19T17-53-55-411.log:22902).
 *  H. A dead named move under a look's re-print (session_2026-06-30T16-31-
 *     43-082.log:6476): no self-link, nothing left queued.
 *  I. "climb branch" (session_2026-06-19T17-53-55-411.log:16074) is an exit:
 *     Shady Islet -[climb branch]-> Terrace — also right after the tree
 *     refused "climb tree" (16071), whose dead move used to claim the
 *     Terrace as its own.
 *  J. "leap east" out of the Sepulcher Entrance, whose exits line lists only
 *     "out" (session_2026-07-18T01-32-16-462.log:16934): tracked, but no
 *     exit — no link the next load would cut, and after an app restart the
 *     next leap finds the same tunnel instead of building another.
 *  K. Each new failure line is a (soft) move failure on its own — the
 *     scenarios above can also be rescued by the queue repair — and someone
 *     else's sparks ("Sparks flare up around Moirai as he tries...") are not.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Alias } from '../../src/types/alias';
import type { TownRoom } from '../../src/lib/townMap';
import { classifyTownCommand } from '../../src/lib/townLocalizer';
import { RoomParser, type RoomParserEvent } from '../../src/lib/roomParser';
import { makeExpander } from '../lib/replayInput';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const alias = (pattern: string, matchMode: 'exact' | 'prefix', body: string): Alias => ({
  id: pattern + matchMode,
  pattern,
  matchMode,
  body,
  bodyMode: 'text',
  enabled: true,
  group: 'Movement',
  createdAt: '2026-02-19T06:04:58.921Z',
  updatedAt: '2026-02-19T06:04:58.921Z',
});
// Bill's aliases (frozen aliases.json)
const expand = makeExpander([
  alias('port', 'exact', 'activate portal\nenter portal'),
  alias('port', 'prefix', 'activate $1 portal\nenter $1 portal'),
]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-tracking-'));
let fileNo = 0;
/** One session log: `|`-prefixed lines are server output, `>> ` lines input;
 *  every line one second after the previous */
function sessionLog(text: string): string {
  const t0 = Date.UTC(2026, 7, 1, 12, 0, 0) + fileNo * 3_600_000;
  const lines = text.split('\n').map((raw, i) => {
    const d = new Date(t0 + i * 1000);
    const h = d.getUTCHours();
    const stamp =
      `[${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')} ${h % 12 || 12}:` +
      `${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ` +
      `${h < 12 ? 'AM' : 'PM'}]`;
    return `${stamp} ${raw.replace(/^\s*\|/, '')}`;
  });
  const f = path.join(dir, `session_2026-08-01T${String(fileNo++).padStart(2, '0')}-00-00-000.log`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
function replay(...texts: string[]) {
  const r = new TownReplay({ expand: (raw) => expand(raw) });
  for (const t of texts) r.replayLog(sessionLog(t));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  const here = (): TownRoom | undefined => r.townMap.room(r.townMap.pos);
  return { r, rooms, named, here };
}

const STABLE_W = `|Stable
|This area is used to house mounts and beasts of burden.  Wooden partitions
|separate the area into stalls and wooden gates prevent the animals from
|wandering.  A wrought-iron lantern hanging from one of the ceiling beams sheds a
|warm illumination.  It is bright.
|There are four exits: west, east, an open gate leading north, and an open gate
|leading south.`;
const STABLE_E = `|Stable
|This area is used to house mounts and beasts of burden.  Wooden partitions
|separate the area into stalls and wooden gates prevent the animals from
|wandering.  A wrought-iron lantern hanging from one of the ceiling beams sheds a
|warm illumination.  It is bright.
|There are three exits: west, an open gate leading north, and an open gate
|leading south.`;

// --- A: failed `port` alias -------------------------------------------------
{
  const h = replay(`${STABLE_W}\n>> port\n|What ?\n|> What ?\n>> e\n${STABLE_E}`);
  check(h.named('Stable').length === 2, `A: two distinct Stables (${h.named('Stable').length})`);
  const w = h.named('Stable').find((x) => x.exits.includes('e'))!;
  check(Object.keys(w.namedLinks).length === 0, 'A: no "enter portal" named link');
  check(w.links.e !== undefined && w.links.e === h.here()?.id, 'A: the e move is linked');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'A: queue drained');
  check(
    h.r.stats.replyFails === 1,
    `A: one queued move failed by "What ?" (${h.r.stats.replyFails})`
  );
}

// --- B: failed swims ----------------------------------------------------------
{
  const SHALLOW = `|Pool\n|The shallow end of the pool.  It is dimly lit.  The air is quite warm.\n|There are two exits: out and south.`;
  const MIDDLE = `|Pool\n|The middle of the pool.  It is shallow, but gets deeper to the south.  It is\n|dimly lit.  The air is quite warm.\n|There are two exits: north and south.`;
  const swims = Array.from({ length: 6 }, () => `>> n\n|You splash around, but get nowhere.`).join(
    '\n'
  );
  const h = replay(
    `${SHALLOW}\n>> s\n${MIDDLE}\n${swims}\n>> n\n|You swim off to the north.\n${SHALLOW}\n>> s\n${MIDDLE}`
  );
  check(h.named('Pool').length === 2, `B: two Pools, not ${h.named('Pool').length}`);
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: failed swims never stay queued');
}

// --- C: the skull trap ------------------------------------------------------
{
  const BOTTOM = `|Stairwell
|These musty stairs lead up into darkness.  Tracks in the dust show where someone
|has passed this way before, sometime recently.  Faint light shines in through a
|hole in the wall.  On the east wall you can make out a rough iron lever.  It is
|shadowy.
|There is one obvious exit: up.`;
  const MIDDLE = `|Stairwell
|These musty stairs lead up into darkness.  Tracks in the dust show where someone
|has passed this way before, sometime recently.  On the north wall a small hole
|lets light into the room.  It is shadowy.
|There are two exits: up and down.`;
  const TOP = `|Stairwell
|These musty stairs lead up into darkness.  Tracks in the dust show where someone
|has passed this way before, sometime recently.  This dark room is lit only by a
|faint amount of light leaking in through a small hole in the north wall.  It is
|shadowy.
|There are two exits: up and down.
|a ghostly skull.`;
  const h = replay(
    `${BOTTOM}\n>> u\n${MIDDLE}\n>> u\n${TOP}\n>> u\n|The sockets of the skull suddenly flash with green light!\n` +
      `|A shimmering green field appears over up.\n|Sparks flare up from the shimmering field as try to push through it.\n` +
      `>> d\n${MIDDLE}\n>> d\n${BOTTOM}`
  );
  check(
    h.named('Stairwell').length === 3,
    `C: three stairwells, not ${h.named('Stairwell').length}`
  );
  check(h.here()?.exits.join(',') === 'u', 'C: back at the bottom');
}

// --- D: the OOC hall's guarded room -----------------------------------------
{
  const HALL = `|OOC Area
|This is a grand hall.  High marble arches stretch high overhead, making you feel
|tiny in comparison.  This hall extends further to the north, as if leading you
|onward.  It is bright.
|There are four exits: north, west, east, and south.
|OOC Board - Important Notices.`;
  const FEAR =
    '|As you enter this room, a powerful force sends shivers of fear through your body.  Trembling, you run back to the relative safety of the OOC Realm.';
  const h = replay(`${HALL}\n>> n\n${FEAR}\n${HALL}\n>> n\n${FEAR}\n${HALL}`);
  check(h.named('OOC Area').length === 1, `D: one hall room, not ${h.named('OOC Area').length}`);
}

// --- E: "cannot move in your current condition" ------------------------------
// (the next block lists the dead move's way back, so only the reply tells)
{
  const h = replay(
    `${STABLE_W}\n>> n\n|You try, but you cannot move in your current condition.\n>> e\n${STABLE_E}`
  );
  const w = h.named('Stable').find((x) => x.exits.includes('e'))!;
  check(w.links.n === undefined, 'E: the failed n links nothing');
  check(w.links.e !== undefined && w.links.e === h.here()?.id, 'E: the e move is linked');
}

// --- F: case sensitivity, movement verbs ------------------------------------
{
  const h = replay(`${STABLE_W}\n>> W\n|What ?\n>> OUT\n|What ?`);
  check(h.r.townLocalizer.pendingMoves.length === 0, 'F: upper-case commands are not moves');
  const g = replay(`${STABLE_W}\n>> lead e`);
  const q = g.r.townLocalizer.pendingMoves;
  check(q.length === 1 && q[0].kind === 'dir' && q[0].dir === 'e', 'F: "lead e" is tracked as e');
  const k = replay(`${STABLE_W}\n>> lead e\n|What ?`);
  check(k.r.townLocalizer.pendingMoves.length === 0, 'F: "lead e" answered "What ?" is failed');

  // A name every object inherits is no direction: the alias table answered
  // "constructor" with Object's constructor, queued as a direction (bare or
  // led) — and in a room listing no exits (the spirit plane's Arena,
  // session_2026-07-01T15-45-27-282.log) placing its destination threw at the
  // next block
  check(
    classifyTownCommand('constructor', 0) === null &&
      classifyTownCommand('lead constructor', 0) === null,
    'F: "constructor" is no direction'
  );
  const ARENA = `|Arena
|A large circular area with high stone walls.  The ground is covered in well
|raked sand and overhead is what appears to be a leaden sky from which a
|directionless light seems to shine.  It is shadowy.
|There are no obvious exits.`;
  const ARMORY = `|Arena Armory
|A small, square stone chamber where the challengers may prepare themselves for
|battle.  On one wall is a rack holding many sorts of weapons and shields.  It is
|shadowy.
|There is one obvious exit: north.`;
  let threw = '';
  try {
    replay(`${ARENA}\n>> constructor\n|What ?\n${ARMORY}`);
  } catch (e) {
    threw = (e as Error).message;
  }
  check(threw === '', `F: the next block resolves (${threw})`);
}

// --- G: the portal keeps moves typed after it -------------------------------
{
  const CHAMBER = `|Portal Chamber\n|This is a large open room ringed by seven arch-shaped portals of some dark\n|bluish stone.  It is bright.\n|There is one obvious exit: east.`;
  const FORECOURT = `|Forecourt\n|This is a cobblestone paved courtyard in front of the Luminarian church.  It is\n|painfully bright.\n|There are two exits: west and an open set of oaken double doors leading east.`;
  const MARKET = `|Market\n|This is a spacious market square in the heart of Eris.  This appears to be the\n|southeastern corner of the market.  It is painfully bright.\n|There are five exits: north, west, northwest, east, and southeast.`;
  const h = replay(
    `${CHAMBER}\n>> port n\n|You touch the north portal.\n>> w\n|You step into the north portal.\n${FORECOURT}\n${MARKET}`
  );
  const fc = h.named('Forecourt')[0];
  check(
    !!fc && fc.links.w === h.named('Market')[0]?.id,
    'G: the post-portal w links Forecourt -> Market'
  );
}

// --- H: a dead named move under a look's re-print ----------------------------
{
  const ISLET = `|Shady Islet\n|This section of the islet is completely shielded from the edges of the islet.\n|Even so, there is a lush carpet of grass on the ground.  It is painfully bright.\n|There are two exits: east and west.`;
  const h = replay(
    `${ISLET}\n>> enter path\n|What ?\n>> l\n${ISLET}\n>> enter pool\n>> l\n${ISLET}`
  );
  check(Object.keys(h.named('Shady Islet')[0].namedLinks).length === 0, 'H: no self named link');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'H: queue drained');
}

// --- I: "climb branch" is an exit --------------------------------------------
const ISLET_FULL = `|Shady Islet
|This section of the islet is completely shielded from the edges of the islet,
|with the exception of the glimpses you catch through the archways of the stone
|wall surrounding the islet.  Even so, there is a lush carpet of grass on the
|ground.  It is painfully bright.
|There are many exits: east, southeast, south, southwest, west, northwest, north,
|and northeast.`;
{
  const TERRACE = `|Terrace
|This small platform protrudes from the side of the main treehouse.  The platform
|is made of finely crafted Ook wood, with strong railings all around.  It is
|painfully bright.
|There is one obvious exit: west.`;
  const h = replay(
    `${ISLET_FULL}\n>> climb branch\n|You scale the branch to a platform high in the canopy.\n${TERRACE}`
  );
  const islet = h.named('Shady Islet')[0];
  check(
    islet.namedLinks['climb branch'] === h.named('Terrace')[0]?.id,
    `I: Shady Islet -[climb branch]-> Terrace (${JSON.stringify(islet.namedLinks)})`
  );
  // ... after the tree refused (session_2026-06-19T17-53-55-411.log:16071):
  // the Terrace is the branch's, not the tree's
  const h2 = replay(
    `${ISLET_FULL}\n>> climb tree\n|You examine the tree, but its broad base, combined with the lack of branches in\n` +
      `|its lower reaches prevent you from climbing it.\n>> climb branch\n` +
      `|You scale the branch to a platform high in the canopy.\n${TERRACE}`
  );
  const islet2 = h2.named('Shady Islet')[0];
  check(
    JSON.stringify(Object.keys(islet2.namedLinks)) === '["climb branch"]',
    `I: only "climb branch" is linked after the tree refused (${JSON.stringify(islet2.namedLinks)})`
  );
}

// --- J: "leap east" is no exit ------------------------------------------------
{
  const FIELD = `|Field\n|You are standing in an open field.  Frantic digging has exposed a number of old\n|graves here.  It is bright.\n|There are three exits: east, south, and west.`;
  const ENTRANCE = `|Sepulcher Entrance
|This is a gloomy hollow in the earth which slopes harshly downward into a tunnel
|on the far side of the entrance.  The floor is littered with pieces of bone.  A
|chasm separates the tunnel from this section of the hollow.  It is shadowy.
|There is one obvious exit: out.`;
  const TUNNEL = `|Sepulcher Tunnel
|This is a gloomy tunnel which slopes harshly downwards towards a chasm.  The
|floor is littered with bones.  It is shadowy.
|There is one obvious exit: east.`;
  const visit = `>> enter grave\n|You slip down into the grave.\n${ENTRANCE}\n>> leap east\n|You leap off to the east!\n${TUNNEL}\n>> leap west\n|You leap off to the west!\n${ENTRANCE}`;
  const h = replay(`${FIELD}\n${visit}`, `${FIELD}\n${visit}`);
  check(
    h.named('Sepulcher Tunnel').length === 1,
    `J: one tunnel, not ${h.named('Sepulcher Tunnel').length}`
  );
  const entrance = h.named('Sepulcher Entrance')[0];
  check(entrance && entrance.links.e === undefined, 'J: no "e" link out of the entrance');
}

// --- K: the failure lines themselves ------------------------------------------
{
  const events: RoomParserEvent[] = [];
  const parser = new RoomParser((e) => events.push(e));
  const failure = (line: string) => {
    events.length = 0;
    parser.feedLine(line);
    return events.length === 1 && events[0].type === 'move-failed' && !events[0].hard;
  };
  for (const line of [
    'You splash around, but get nowhere.',
    '> You flail around, but get nowhere.',
    'You try, but you cannot move in your current condition.',
    'Sparks flare up from the shimmering field as try to push through it.',
    'As you enter this room, a powerful force sends shivers of fear through your body.  Trembling, you run back to the relative safety of the OOC Realm.',
    'You examine the tree, but its broad base, combined with the lack of branches in',
  ]) {
    check(failure(line), `K: "${line.slice(0, 40)}..." is a soft move failure`);
  }
  check(
    !failure(
      'Sparks flare up around Moirai as he tries to push through the shimmering field spanning up.'
    ),
    "K: someone else's sparks are not our failure"
  );
}

fs.rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-command-tracking: all checks passed');
