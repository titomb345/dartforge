/**
 * Regression test: the replay harness's live-fidelity layer
 * (scripts/lib/rejoin.ts, replayCorpus.ts, replayInput.ts, townReplay.ts).
 * Every rule here removed a replay artifact that posed as an engine bug.
 *
 * 1. TCP-fragment rejoin. The session logger splits lines at TCP chunk
 *    boundaries; the split head reads as a room NAME and the whole block is
 *    lost (45 DartForge exits lines; 32 parse again after the rejoin, the
 *    rest are rooms named with a period). Each guard is pinned by a pair
 *    that only it rejects — the corpus produced a false join without it: an
 *    echoed command, DartMUD's bare "Ok" before an equipment list, a
 *    server-wrapped exits line, an interleaved line that overflows 80
 *    columns, the orphaned tail of an earlier split ("...It" + "is
 *    bright."), halves logged seconds apart, text outside room prose — and
 *    the room-prose window still reaches a split high up in a long
 *    description. The replay itself feeds the rejoined lines (the split
 *    block and portal transit reach the engine) and counts every exits line
 *    the parser still drops as a LOST block, at that exits line.
 * 2. Login → character. Each login segment belongs to the character its
 *    auto-`score` line names (bare, two-sentence or with parentheticals)
 *    within the login burst (30 s / 150 lines), else the "Saving <Name>."
 *    quit line; in-game prose like a shapeshifter's "You are Danor the
 *    rabbit." outside the burst never counts. A login is TYPED only when
 *    the character's own name was logged at the Name: prompt.
 * 3. Concurrent app instances: a session file inside an earlier file's time
 *    span (boundary seconds included) is skipped.
 * 4. Per-character stores, like live map-<char>.json: Trilok's login must
 *    not land in Mazorn's map (the shared store glued Soriktos into Eris); a
 *    returning character gets HIS stores back (town and hex); a same-
 *    character re-login changes nothing; each session file is an app
 *    restart (stores round-trip serialize → deserialize; --no-restart keeps
 *    them but still starts each file's localizers reset); a snapshot carries
 *    every character, and a live map-<char>.json belongs to the character
 *    its file name says. Link-miss/heal and nudge/stretch counters live on
 *    the instances a switch or restart replaces: each is banked to its own
 *    character (the corpus's 51 link misses read 48 without the switch
 *    banking, 3 without the restart banking).
 *    --switch-late reproduces the pre-hold live race for a TYPED name only — the
 *    burst's first room OR wilderness survey lands in the previous
 *    character's stores; with neither, the switch lands 30 s after the
 *    login, at the next login or at the end of the file — while an
 *    auto-login switches at the login line.
 * 5. Input expansion: the active character's aliases first, then the global
 *    ones; an unreadable aliases file is an error, never an empty alias list.
 * 6. The tools' exits-line pattern (scripts/lib/serverLines.ts, which lost-
 *    block accounting and the rejoin scope use) mirrors the parser's.
 * 7. Merge-copy provenance (--tag-origins) names only the rooms a merge
 *    copied.
 * 8. The layout gate's grid audit counts rooms sharing a cell and grid
 *    index entries that disagree with the rooms.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TownParser, parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import type { Alias } from '../../src/types/alias';
import { fragmentKind, rejoinFragments, type RejoinLine } from '../lib/rejoin';
import { liveLines, loginInfos, nestedFiles, type SessionLine } from '../lib/replayCorpus';
import { loadAliasSets, makeCharExpander } from '../lib/replayInput';
import { EXITS_START_RE } from '../lib/serverLines';
import {
  TownReplay,
  gridAudit,
  mapFileOwner,
  mergeCopyIds,
  type ReplayOptions,
  type SwitchEvent,
} from '../lib/townReplay';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

// ---------------------------------------------------------------------------
// 1. Fragment pairs (all from the corpus unless noted)
// ---------------------------------------------------------------------------
const pairs: [string, string, string | null][] = [
  // genuine logger splits
  [
    'various weapons and shields.  In one corner is a large fireplace b',
    'ut it remains',
    'mid-word',
  ],
  ['> You step into the no', 'rth portal.', 'mid-word'],
  ['There are four exits: west, a closed oak door leading nor', 'th, south, and up.', 'mid-word'],
  ['giving a splash of color ', 'and warmth to the room.  It is bright.', 'after-space'],
  [
    'There are many exits: north, northeast, east, southeast, south, southwest',
    ', west,',
    'mid-word',
  ],
  [
    'ballot box sits next to it.',
    '  There is an oak chest in the opposite corner.  It',
    'sentence-gap',
  ],
  // genuine server lines that must stay apart
  ['There are five exits: down, up, north, south, and a closed oak door leading', 'west.', null],
  [
    'This is a landing on the third floor of the keep.  A spiral staircase winds up',
    'and down from this floor and archways lead off to the north and south.',
    null,
  ],
  ['landing on the shore of the Sea of Eris.  It is bright.  The air is quite', 'chilly.', null],
  ['Market', 'This is a spacious market square in the center of the town.', null],
  // the OOC Entry Hall's notice and its indented lighting line, a blank line
  // apart on the wire (session_2026-07-16T18-04-45-303.log:461-462)
  ['Sadly, there are no new notes for you to read.', '  It is bright.', null],
  ['Ok', 'upper left hand: a large black steel great chain', null],
  ['lower left hand: a dragon bone tonfa', 'lower right hand: a dragon bone tonfa', null],
  // a complete equipment line + the split head of the next one: only the
  // A-side "field: value" guard rejects it ("...a mythril daggerupper rig",
  // session_2026-09-02T03-12-46-056.log:33)
  ['> upper left hand: a mythril dagger', 'upper rig', null],
  [
    'the east end of the room is a spiral stone staircase which goes up and down to',
    'read next',
    null,
  ],
  // only the 80-visible-column guard rejects this one (synthetic): A + B's
  // first word fits, the joined line does not — a short line interleaved
  // after a long wrapped one (on DF + MUSH at room scope the guard keeps the
  // joins at 4,023 instead of 29,133)
  [
    'A narrow path winds',
    'between the tall stone walls of the old keep towards the distant gate tower',
    null,
  ],
];
for (const [a, b, want] of pairs) {
  const got = fragmentKind(a, b);
  check(
    got === want,
    `fragmentKind(${JSON.stringify(a.slice(-30))}, ${JSON.stringify(b.slice(0, 30))}) = ${got}, want ${want}`
  );
}

// ---------------------------------------------------------------------------
// 1b. Rejoin in context: a Day Room block split mid-word
//     (session_2026-08-21T18-39-02-094.log:1546-1547)
// ---------------------------------------------------------------------------
const T = 1_000_000;
const L = (text: string, t = T): RejoinLine => ({ text, t });
const dayRoom: RejoinLine[] = [
  L('Day Room'),
  L('This is a comfortable sitting room on the second floor of the keep where the'),
  L('rangers can come and relax between their duties and training.  Daylight streams'),
  L('in through a window on the west wall.  The floor is covered by a soft, red wool'),
  L('rug and the walls are hung with various weapons and shields.  In one corner is a'),
  L('large fireplace b'),
  L('ut it remains unlit.  The room is furnished with a pair of oak'),
  L('settles and a small table.  It is bright.'),
  L('There are four exits: down, up, north, and south.'),
];
const parseNames = (lines: readonly (string | null)[]) => {
  const names: string[] = [];
  const p = new TownParser((b) => names.push(b.name));
  for (const l of lines) if (l !== null && !l.startsWith('>> ')) p.feedLine(l);
  p.flushPending();
  return names;
};
check(
  parseNames(dayRoom.map((l) => l.text)).length === 0,
  'the split Day Room block is lost without the rejoin'
);
const joined = rejoinFragments(dayRoom);
check(joined.joins.length === 1, `one join in the Day Room block (got ${joined.joins.length})`);
check(
  parseNames(joined.lines).join() === 'Day Room',
  `rejoined Day Room block parses (got ${parseNames(joined.lines).join()})`
);
check(
  joined.lines[6] ===
    'large fireplace but it remains unlit.  The room is furnished with a pair of oak' &&
    joined.lines[5] === null,
  'the joined line sits at its LAST fragment, the head slot is consumed'
);

// a command typed while the chunk was in flight sits between the halves:
// the joined line comes after it (live parses the line when the tail lands)
const withCmd = [...dayRoom.slice(0, 6), L('>> n'), ...dayRoom.slice(6)];
const jc = rejoinFragments(withCmd);
check(
  jc.lines[6] === '>> n' && jc.lines[7]?.startsWith('large fireplace but') === true,
  'command between halves kept before the joined line'
);

// halves logged 2+ seconds apart are not one chunk pair
const late = dayRoom.map((l, i) => (i >= 6 ? { ...l, t: T + 5000 } : l));
check(rejoinFragments(late).joins.length === 0, 'no join across a multi-second gap');

// outside room prose (no exits line soon) nothing joins — except a portal transit
const noRoom: RejoinLine[] = [L('heater sh'), L('ield and a dagger')];
check(rejoinFragments(noRoom).joins.length === 0, 'no join outside room prose');
const portal = rejoinFragments([L('> You step into the no'), L('rth portal.'), L('Forecourt')]);
check(
  portal.lines[1] === '> You step into the north portal.',
  'split portal transit line is rejoined'
);

// a sentence-gap split rejoins across ONE second boundary; the joined line
// is 78 columns, so its "It" wrapped legitimately and "is bright." stays
const gap = rejoinFragments([
  L('ballot box sits next to it.', T - 1000),
  L('  There is an oak chest in the opposite corner.  It'),
  L('is bright.'),
  L('There are two exits: a closed pair of oak doors leading west and east.'),
]);
check(
  gap.lines.includes('is bright.') &&
    gap.lines.includes(
      'ballot box sits next to it.  There is an oak chest in the opposite corner.  It'
    ),
  `sentence-gap split rejoined across a second boundary, wrapped tail left alone (${JSON.stringify(gap.lines)})`
);
// ...but when the halves are 2 s apart the gap tail is an ORPHAN: it never
// heads a join of its own (the rule alone would make "...corner.  Itis bright.")
const orphan = rejoinFragments([
  L('ballot box sits next to it.', T - 2000),
  L('  There is an oak chest in the opposite corner.  It'),
  L('is bright.'),
  L('There are two exits: a closed pair of oak doors leading west and east.'),
]);
check(
  orphan.joins.length === 0,
  `an orphaned sentence-gap tail never heads a join (${JSON.stringify(orphan.lines)})`
);

// a split high up in a long description: the exits line sits 6 lines below
// the tail, still inside the room-prose window
// (session_2026-07-04T13-54-29-349.log:176-177)
const assembly = rejoinFragments([
  L('> Assembly Hall'),
  L('This is a large, open chamber with a lofty ceiling where the rangers may'),
  L('assemble.  The floor is an expanse of polished black granite, kept immaculate by'),
  L('apprentices.  Large red silk banne'),
  L('rs hang from the beams of the vaulted ceiling'),
  L('and weapons of all descriptions decorate the walls.  Daylight streams in through'),
  L('a pair of stained glass windows high on the west wall, washing the room with'),
  L('color and light.  A large book rests on a lectern in one corner and a ballot box'),
  L('sits next to it.  There is an oak chest in the opposite corner.  It is bright.'),
  L('There are two exits: a closed pair of oak doors leading west and east.'),
]);
check(
  assembly.lines[4] ===
    'apprentices.  Large red silk banners hang from the beams of the vaulted ceiling' &&
    parseNames(assembly.lines).join() === 'Assembly Hall',
  `a split 6 lines above the exits line is rejoined (${JSON.stringify(assembly.lines[4])})`
);

// ---------------------------------------------------------------------------
// 2. Login segments → characters
// ---------------------------------------------------------------------------
const S = (text: string, t = T): SessionLine => ({ text, t });
const logins = loginInfos([
  S('Name: '),
  S('Password: '),
  S('Running under version 3.2.10-dev.608.'),
  S('Bedchamber'),
  S('> You are Mazorn the spyder.  You are a middle aged spyder.'),
  S('>> quit'),
  S('Saving Mazorn.'),
  S('Name: '),
  S('>> trilok'),
  S('Password: '),
  S('You are already playing, reconnecting to old object.'),
  S('You are Trilok the mohnkee.'),
  S('  You are an adolescent mohnkee.'),
  S('Saving Trilok.'),
  S('Running under version 3.2.10-dev.608.'),
  S('You are Mazorn the spyder (grappling with Carrion demon).'),
  S('Running under version 3.2.10-dev.608.'),
  S('a bat.', T + 60_000),
  S('You are Danor the rabbit.  You are a rabbit.', T + 60_000),
  S('Saving Trilok.', T + 90_000),
  // a stray one-word input at the Name: prompt is not the typed NAME
  S('Name: ', T + 95_000),
  S('>> y', T + 95_000),
  S('Password: ', T + 96_000),
  S('Running under version 3.2.10-dev.608.', T + 97_000),
  S('You are Mazorn the spyder.', T + 97_000),
  // the burst ends after 150 lines even within the same second
  S('Running under version 3.2.10-dev.608.', T + 100_000),
  ...Array.from({ length: 160 }, () => S('You wear a leather boot.', T + 100_000)),
  S('You are Danor the rabbit.', T + 100_000),
  S('Saving Trilok.', T + 120_000),
  S('Running under version 3.2.10-dev.608.', T + 130_000),
]);
const who = logins.map((l) => `${l.char ?? '-'}/${l.via ?? '-'}${l.typed ? '/typed' : ''}`);
check(
  who.join(' ') ===
    'mazorn/score trilok/score/typed mazorn/score trilok/saving mazorn/score trilok/saving -/-',
  `login characters: ${who.join(' ')}`
);

// ---------------------------------------------------------------------------
// 3. Concurrent app instances
// ---------------------------------------------------------------------------
const skip = nestedFiles([
  [100, 500],
  [200, 300], // inside the first file's span → second instance
  [600, 900],
  [800, 1200], // overlaps but extends past → kept
  [650, 900], // ends the same second as its host (session_2026-07-04T17-47-01-240.log)
  [100, 150], // starts the same second as its host
]);
check([...skip].sort().join() === '1,4,5', `nested files skipped: ${[...skip].sort().join()}`);

// ---------------------------------------------------------------------------
// 4. Per-character stores, restarts and the late switch
// ---------------------------------------------------------------------------
const stamp = (sec: number) =>
  `[2026-08-16 8:${String(10 + Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} PM]`;
const ROOMS: Record<string, [string, string]> = {
  Bedchamber: [
    'This is a bedchamber on an upper floor of the keep, overlooking the sea.',
    'There is one obvious exit: west.',
  ],
  'Keep Corridor': [
    'This is a narrow stone corridor on an upper floor of the keep.',
    'There are two exits: east and south.',
  ],
  Stall: [
    'This is a narrow stall in the royal stables that smells of fresh hay.',
    'There is one obvious exit: north.',
  ],
  'Royal Stables': [
    'This is the long aisle of the royal stables with stalls on either side.',
    'There are two exits: north and south.',
  ],
};
const room = (sec: number, name: string) => [
  `${stamp(sec)} ${name}`,
  `${stamp(sec)} ${ROOMS[name][0]}  It is bright.`,
  `${stamp(sec)} ${ROOMS[name][1]}`,
];
const at = (sec: number, text: string) => `${stamp(sec)} ${text}`;

// Mazorn (auto-login) walks two rooms and quits; Trilok's name is TYPED;
// Mazorn auto-logs in again where he quit, then reconnects (same character)
const log1 = [
  at(0, 'Name: '),
  at(0, 'Password: '),
  at(1, 'Running under version 3.2.10-dev.608.'),
  ...room(1, 'Bedchamber'),
  at(1, '> You are Mazorn the spyder.  You are a middle aged spyder.'),
  at(3, '>> w'),
  ...room(4, 'Keep Corridor'),
  at(5, '>> quit'),
  at(5, 'Saving Mazorn.'),
  at(9, 'Name: '),
  at(10, '>> trilok'),
  at(11, 'Password: '),
  at(12, 'Running under version 3.2.10-dev.608.'),
  ...room(12, 'Stall'),
  at(12, '> You are Trilok the mohnkee.'),
  at(15, '>> n'),
  ...room(16, 'Royal Stables'),
  at(18, '>> quit'),
  at(18, 'Saving Trilok.'),
  at(20, 'Name: '),
  at(20, 'Password: '),
  at(21, 'Running under version 3.2.10-dev.608.'),
  ...room(21, 'Keep Corridor'),
  at(21, '> You are Mazorn the spyder.'),
  at(24, 'Name: '),
  at(24, 'Password: '),
  at(25, 'You are already playing, reconnecting to old object.'),
  at(25, '> You are Mazorn the spyder.'),
  at(26, '>> l'),
  ...room(26, 'Keep Corridor'),
];
const LOGIN3_LINE = log1.indexOf(at(21, 'Running under version 3.2.10-dev.608.')) + 1;
// The next app run: Mazorn again
const log2 = [
  at(40, 'Name: '),
  at(40, 'Password: '),
  at(41, 'Running under version 3.2.10-dev.608.'),
  ...room(41, 'Keep Corridor'),
  at(41, '> You are Mazorn the spyder.'),
];
// A run that logs in as Trilok (auto-login)
const log3 = [
  at(50, 'Name: '),
  at(50, 'Password: '),
  at(51, 'Running under version 3.2.10-dev.608.'),
  ...room(51, 'Royal Stables'),
  at(51, '> You are Trilok the mohnkee.'),
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-harness-'));
const writeLog = (name: string, lines: string[]) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
};
const file1 = writeLog('session_2026-08-17T00-00-00-000.log', log1);
const file2 = writeLog('session_2026-08-17T01-00-00-000.log', log2);
const file3 = writeLog('session_2026-08-17T02-00-00-000.log', log3);

const roomsOf = (r: TownReplay) => {
  const out: Record<string, string> = {};
  for (const [c, s] of r.stores()) {
    out[c] = [...s.town.towns.values()]
      .flatMap((t) => [...t.rooms.values()].map((x) => x.name))
      .sort()
      .join(',');
  }
  return out;
};
interface Run {
  r: TownReplay;
  /** [block name, live TownLocalizer] per resolved block, in order */
  blocks: [string, TownLocalizer][];
  switches: (SwitchEvent & { line: number })[];
  /** raw input → the character it was expanded for */
  expanded: [string, string | null][];
}
const replay = (opts: Partial<ReplayOptions>, ...files: string[]): Run => {
  const run: Run = {
    r: undefined as unknown as TownReplay,
    blocks: [],
    switches: [],
    expanded: [],
  };
  run.r = new TownReplay(
    {
      expand: (raw, char) => {
        run.expanded.push([raw, char]);
        return [raw];
      },
      ...opts,
    },
    {
      onBlock: ({ block }) => run.blocks.push([block.name, run.r.townLocalizer]),
      onSwitch: (ev) => run.switches.push({ ...ev, line: run.r.line }),
    }
  );
  for (const f of files) run.r.replayLog(f);
  return run;
};
const charOf = (run: Run, raw: string) => run.expanded.find(([x]) => x === raw)?.[1];

// --- per-character stores (the default) ---
const pc = replay({}, file1);
const pcRooms = roomsOf(pc.r);
check(
  pc.r.stats.switches === 2 && pc.r.char === 'mazorn',
  `per-char: mazorn → trilok → mazorn = 2 switches, mazorn live (${pc.r.stats.switches}, ${pc.r.char})`
);
check(
  pcRooms.trilok === 'Royal Stables,Stall',
  `per-char: trilok's login room in trilok's map (${pcRooms.trilok})`
);
// A → B → A: the returning character's stores come back (Bedchamber was
// only visited BEFORE Trilok's session), and his login room is the known one
check(
  pcRooms.mazorn === 'Bedchamber,Keep Corridor',
  `per-char: mazorn's own map restored when he returns (${pcRooms.mazorn})`
);
check(
  pc.switches.map((s) => `${s.to}:${s.fresh ? 'new' : 'restored'}`).join() ===
    'trilok:new,mazorn:restored',
  `switch events: ${pc.switches.map((s) => `${s.to}:${s.fresh}`).join()}`
);
const stores = pc.r.stores();
check(
  stores.get('mazorn')!.hex !== stores.get('trilok')!.hex &&
    stores.get('mazorn')!.town !== stores.get('trilok')!.town,
  'per-char: each character has his own hex AND town store'
);
// a same-character re-login changes nothing: no switch, same localizer
const corridor = pc.blocks.filter(([n]) => n === 'Keep Corridor');
check(
  corridor.length === 3 && corridor[1][1] === corridor[2][1],
  'same-character re-login keeps the live localizer'
);
// input expands with the active character's aliases
check(
  charOf(pc, 'w') === 'mazorn' && charOf(pc, 'n') === 'trilok' && charOf(pc, 'l') === 'mazorn',
  `per-char: input expanded for the live character (${JSON.stringify(pc.expanded)})`
);

// --- one shared store (--single-store) ---
const single = replay({ perChar: false }, file1);
const singleRooms = roomsOf(single.r);
check(
  Object.keys(singleRooms).join() === 'unknown' &&
    singleRooms.unknown === 'Bedchamber,Keep Corridor,Royal Stables,Stall',
  `single store: everything in one map (${JSON.stringify(singleRooms)})`
);
check(
  charOf(single, 'n') === 'trilok',
  'single store: input still expands for the logged-in character'
);
// counters of the live (never-identified) store count for 'unknown' too
single.r.townLocalizer.linkMisses += 3;
check(
  single.r.totals('unknown').linkMisses === single.r.totals().linkMisses &&
    single.r.totals().linkMisses >= 3,
  `totals('unknown') includes the live localizer (${single.r.totals('unknown').linkMisses} vs ${single.r.totals().linkMisses})`
);

// --- the pre-hold live race (--switch-late) ---
const race = replay({ switchLate: true }, file1);
const raceRooms = roomsOf(race.r);
check(
  race.r.stats.lateSwitches === 1 && race.r.stats.switches === 2,
  `late switch only for the typed login (late ${race.r.stats.lateSwitches}, switches ${race.r.stats.switches})`
);
check(
  raceRooms.mazorn === 'Bedchamber,Keep Corridor,Stall',
  `late switch: the typed login's first room lands in the previous character's map (${raceRooms.mazorn})`
);
check(
  raceRooms.trilok === 'Royal Stables',
  `late switch: trilok's map starts after the login burst; mazorn's auto-login room stays out (${raceRooms.trilok})`
);
const back = race.switches.find((s) => s.to === 'mazorn');
check(
  back !== undefined && !back.late && back.line === LOGIN3_LINE,
  `an auto-login switches AT its login line under --switch-late (${back?.late} at :${back?.line}, login :${LOGIN3_LINE})`
);
check(charOf(race, 'n') === 'trilok', "late switch: input after the burst is trilok's");

// --- where else a late switch lands ---
// A login burst can show a wilderness SURVEY first (the character quit in
// the wilds): it ends the late window like a room block. The real survey of
// session_2026-06-19T06-54-30-220.log:169-195.
const SURVEY = [
  'You gaze at your surroundings.',
  '              -----               L) a strange tower on the coast.',
  '             / ~  ~\\             ',
  '        -----~ ~~  ~-----        ',
  '       /  ~  \\  ~~ / ~~  \\       ',
  '  -----~~  ~  -----~  ~~  -----  ',
  ' /  ~  \\~~ ~~/~  ~~\\~  ~~/~ ~~ \\ ',
  '-~~ ~~  -----  ~  ~~----- ~  ~~ -',
  ' \\~  ~~/~ ~~ \\ ~~  / ~~  \\ ~  ~/ ',
  '  ----- ~  ~~ -----~  ~~ ~-----  ',
  ' /~  ~~\\ ~  ~/wwwww\\~  ~ /~ ~~ \\ ',
  '-  ~  ~~-----wwwLwww----- ~  ~~ -',
  ' \\ ~~  /  ~  \\wwwww/wwwww\\ ~  ~/ ',
  '  -----~~  ~  -----ww wwww-----  ',
  ' /  ~~ \\~~ ~~/wwwww\\ww ww/~  ~~\\ ',
  '- ~  ~~ -----ww wwww-----  ~  ~~-',
  ' \\~~  ~/  ~  \\ww ww/ ww w\\ ~~  / ',
  '  -----~~  ~  -----wwwww w-----  ',
  '       \\~~ ~~/www w\\wwwww/       ',
  '        -----w www w-----        ',
  '             \\w www/             ',
  '              -----  ',
  'You are in the woods.  The woods here are completely untamed.  It is extremely',
  'light here.',
  'a clearing on the coast with a tower.',
  'a sparrow.',
  'a sparrow.',
];
// Mazorn plays, quits; "trilok" is typed at the Name: prompt; trilok's login
// line is logged at second 12 (late-switch deadline: second 42)
const typedTrilok = [
  at(0, 'Running under version 3.2.10-dev.608.'),
  ...room(0, 'Bedchamber'),
  at(0, '> You are Mazorn the spyder.'),
  at(5, '>> quit'),
  at(5, 'Saving Mazorn.'),
  at(9, 'Name: '),
  at(10, '>> trilok'),
  at(11, 'Password: '),
  at(12, 'Running under version 3.2.10-dev.608.'),
];
const surveyLog = [
  ...typedTrilok,
  ...SURVEY.map((l) => at(12, l)),
  at(12, '> You are Trilok the mohnkee.'),
  at(15, '>> s'),
  ...room(16, 'Stall'),
];
// no room or survey within 30 s of the login
const deadlineLog = [
  ...typedTrilok,
  at(12, '> You are Trilok the mohnkee.'),
  at(50, 'You are hungry.'),
  ...room(70, 'Stall'),
];
// the link drops and trilok reconnects before any room shows
const relogLog = [
  ...typedTrilok,
  at(12, '> You are Trilok the mohnkee.'),
  at(14, 'You are already playing, reconnecting to old object.'),
  at(14, '> You are Trilok the mohnkee.'),
  ...room(15, 'Stall'),
];
// the app exits before any room shows; the next run auto-logs trilok in
const eofLog = [...typedTrilok, at(12, '> You are Trilok the mohnkee.')];
const eofNextLog = [
  at(40, 'Running under version 3.2.10-dev.608.'),
  ...room(40, 'Stall'),
  at(40, '> You are Trilok the mohnkee.'),
];
interface LateRun {
  r: TownReplay;
  /** "<to>[ late]@<line>" per switch */
  switches: string[];
  /** Lines where a wilderness survey resolved */
  surveys: number[];
}
const lateRun = (...files: string[]): LateRun => {
  const run: LateRun = { r: undefined as unknown as TownReplay, switches: [], surveys: [] };
  run.r = new TownReplay(
    { expand: (raw) => [raw], switchLate: true },
    {
      onSwitch: (ev) => run.switches.push(`${ev.to}${ev.late ? ' late' : ''}@${run.r.line}`),
      onSurvey: () => run.surveys.push(run.r.line),
    }
  );
  for (const f of files) run.r.replayLog(f);
  return run;
};
const lineOf = (log: string[], text: string) => log.indexOf(text) + 1;

const sv = lateRun(writeLog('session_2026-08-17T03-00-00-000.log', surveyLog));
check(
  sv.surveys.length === 1 && sv.switches.join() === `trilok late@${sv.surveys[0]}`,
  `late switch lands AT the login burst's survey (switches ${sv.switches}, survey at :${sv.surveys})`
);
check(
  roomsOf(sv.r).trilok === 'Stall' && roomsOf(sv.r).mazorn === 'Bedchamber',
  `the room after the burst's survey is trilok's (${JSON.stringify(roomsOf(sv.r))})`
);

const dl = lateRun(writeLog('session_2026-08-17T04-00-00-000.log', deadlineLog));
const hungry = lineOf(deadlineLog, at(50, 'You are hungry.'));
check(
  dl.switches.join() === `trilok late@${hungry}` && roomsOf(dl.r).trilok === 'Stall',
  `no room for 30 s: the late switch lands at the first line past the deadline (${dl.switches}, want :${hungry}; trilok ${roomsOf(dl.r).trilok})`
);

const rl = lateRun(writeLog('session_2026-08-17T05-00-00-000.log', relogLog));
const reconnect = lineOf(relogLog, at(14, 'You are already playing, reconnecting to old object.'));
check(
  rl.switches.join() === `trilok late@${reconnect}` && rl.r.stats.lateSwitches === 1,
  `a pending late switch lands at the next login, the reconnect itself switches nothing (${rl.switches}, want late@:${reconnect})`
);

const ef = lateRun(writeLog('session_2026-08-17T06-00-00-000.log', eofLog));
check(
  ef.r.char === 'trilok' && ef.switches.length === 1 && ef.switches[0].startsWith('trilok late@'),
  `a pending late switch lands at the end of the file (${ef.switches}; live ${ef.r.char})`
);
ef.r.replayLog(writeLog('session_2026-08-17T07-00-00-000.log', eofNextLog));
check(
  ef.r.stats.switches === 1 && roomsOf(ef.r).trilok === 'Stall',
  `...so the next run resumes trilok's stores (switches ${ef.r.stats.switches}, trilok ${roomsOf(ef.r).trilok})`
);

// --- each session file is an app restart ---
const two = replay({}, file1);
const townBefore = two.r.townMap;
const hexBefore = two.r.hexMap;
const roomsBefore = roomsOf(two.r);
two.r.replayLog(file2);
check(
  two.r.townMap !== townBefore && two.r.hexMap !== hexBefore,
  'restart: both stores are replaced by deserialized copies between files'
);
check(
  JSON.stringify(roomsOf(two.r)) === JSON.stringify(roomsBefore),
  `restart: rooms preserved (${JSON.stringify(roomsOf(two.r))} vs ${JSON.stringify(roomsBefore)})`
);

// --no-restart keeps the in-memory stores, but each file is still a new app
// run: its localizers start reset (file1 ends inside the keep, active)
const activeAtLogin: boolean[] = [];
const noRestart: TownReplay = new TownReplay(
  { expand: (raw) => [raw], restart: false },
  { onLogin: () => activeAtLogin.push(noRestart.townLocalizer.active) }
);
noRestart.replayLog(file1);
const activeAtEnd = noRestart.townLocalizer.active;
const storeAtEnd = noRestart.townMap;
noRestart.replayLog(file2);
check(
  noRestart.townMap === storeAtEnd &&
    activeAtEnd &&
    activeAtLogin[activeAtLogin.length - 1] === false,
  `--no-restart: same stores, localizers reset per file (active at the end of file 1: ${activeAtEnd}, at file 2's login: ${activeAtLogin[activeAtLogin.length - 1]})`
);

// --- counters bank per character across switches and restarts ---
// Link misses/heals (localizer) and nudges/stretches (store) live on the
// instances a switch or a restart replaces. Over three app runs (3
// switches, 2 restarts) the k-th block bumps every live counter by 2^k —
// a distinct weight per block, so any count lost or banked to the wrong
// character shows. Against an unbumped replay of the same logs, each
// character's totals grew by exactly the weights of the blocks resolved
// while HIS stores were live, and totals() is the sum over characters.
const bumpRun = (bump: boolean) => {
  const owed = new Map<string, number>();
  let k = 0;
  const r: TownReplay = new TownReplay(
    { expand: (raw) => [raw] },
    {
      onBlock: () => {
        if (!bump) return;
        const w = 2 ** k++;
        owed.set(r.char ?? 'unknown', (owed.get(r.char ?? 'unknown') ?? 0) + w);
        r.townLocalizer.linkMisses += w;
        r.townLocalizer.linkHeals += 2 * w;
        r.townMap.nudges += 3 * w;
        r.townMap.stretches += 4 * w;
      },
    }
  );
  for (const f of [file1, file2, file3]) r.replayLog(f);
  return { r, owed };
};
const { r: bumped, owed } = bumpRun(true);
const { r: unbumped } = bumpRun(false);
const grewBy = (c?: string) => {
  const a = bumped.totals(c);
  const b = unbumped.totals(c);
  return [
    a.linkMisses - b.linkMisses,
    a.linkHeals - b.linkHeals,
    a.nudges - b.nudges,
    a.stretches - b.stretches,
  ].join();
};
const times = (n: number) => [n, 2 * n, 3 * n, 4 * n].join();
const bankChars = [...bumped.stores().keys()].sort();
check(
  bankChars.join() === 'mazorn,trilok' &&
    [...owed.keys()].sort().join() === 'mazorn,trilok' &&
    bumped.stats.switches === 3 &&
    bumped.stats.blocks === 8 &&
    bumped.char === 'trilok',
  `counter run: 3 switches and 8 blocks over 3 files (${bankChars}; ${bumped.stats.switches}, ${bumped.stats.blocks}, live ${bumped.char})`
);
for (const c of bankChars) {
  check(
    grewBy(c) === times(owed.get(c) ?? 0),
    `${c}'s counters grew by his own blocks' weights (${grewBy(c)}, want ${times(owed.get(c) ?? 0)})`
  );
}
check(
  grewBy() === times(2 ** bumped.stats.blocks - 1),
  `totals() grew by every block (${grewBy()}, want ${times(2 ** bumped.stats.blocks - 1)})`
);
const summed = bankChars.reduce((s, c) => s + bumped.totals(c).linkMisses, 0);
check(
  summed === bumped.totals().linkMisses,
  `totals() is the sum over characters (${summed} vs ${bumped.totals().linkMisses})`
);

// --- a snapshot carries every character's stores ---
const snap = two.r.snapshot();
check(
  snap.character === 'mazorn' && Object.keys(snap.characters ?? {}).join() === 'trilok',
  `snapshot: mazorn live + trilok stored (${snap.character}; ${Object.keys(snap.characters ?? {})})`
);
const resumed = new TownReplay(
  { expand: (raw) => [raw] },
  { onSwitch: (ev) => check(!ev.fresh, `resumed switch to ${ev.to} restores the snapshot's map`) }
);
resumed.load(JSON.parse(JSON.stringify(snap)));
check(
  JSON.stringify(roomsOf(resumed)) === JSON.stringify(roomsOf(two.r)),
  `snapshot round trip keeps every character (${JSON.stringify(roomsOf(resumed))})`
);
resumed.replayLog(file3);
check(
  roomsOf(resumed).trilok === 'Royal Stables,Stall',
  `resumed replay: trilok continues on his own map (${roomsOf(resumed).trilok})`
);

// --- a live map-<char>.json names its owner only in its file name ---
check(
  mapFileOwner('C:/Users/x/Dropbox/DM/Dartforge/map-Mazorn.json') === 'mazorn' &&
    mapFileOwner('map-trilok.json') === 'trilok' &&
    mapFileOwner('scratch/live-map-mazorn.json') === 'mazorn' &&
    mapFileOwner('snap-1659.json') === null &&
    mapFileOwner('pc-towns-mazorn.json') === null &&
    mapFileOwner('bitmap-mazorn.json') === null,
  'map file owner from the live file name (map-<char>.json, a prefixed copy) only'
);
const mz = pc.r.stores().get('mazorn')!;
const liveMapFile = { mapData: mz.hex.serialize(), townData: mz.town.serialize() };
const liveSwitches: string[] = [];
const fromLive = new TownReplay(
  { expand: (raw) => [raw] },
  { onSwitch: (ev) => liveSwitches.push(`${ev.from}->${ev.to}${ev.fresh ? ' (new)' : ''}`) }
);
fromLive.load(JSON.parse(JSON.stringify(liveMapFile)), mapFileOwner('map-mazorn.json'));
fromLive.replayLog(file3);
check(
  liveSwitches.join() === 'mazorn->trilok (new)' &&
    roomsOf(fromLive).mazorn === 'Bedchamber,Keep Corridor' &&
    roomsOf(fromLive).trilok === 'Royal Stables',
  `a loaded map-mazorn.json stays mazorn's when trilok logs in (${liveSwitches}; ${JSON.stringify(roomsOf(fromLive))})`
);

// the rejoined lines are what the replay feeds
const live = liveLines([S('> You step into the no'), S('rth portal.'), S('Forecourt')], true);
check(
  live.lines[0] === null && live.lines[1]?.text === '> You step into the north portal.',
  'liveLines rejoins'
);
check(liveLines([S('a'), S('b')], false).joins.length === 0, '--no-rejoin keeps the raw lines');

// --- end to end: the replay rejoins, and counts what the parser drops ---
// The Day Room block above and a portal transit line, both split by the
// logger (session_2026-07-19T15-19-44-545.log:6277, with its Forecourt)
const FORECOURT = [
  'Forecourt',
  'This is a cobblestone paved courtyard in front of the Luminarian church.  The',
  'facade of the church is composed of the bell tower and its spire-topped steeple.',
  'A shallow set of stairs leads up to the broad double doors, above which is a',
  'large stained-glass rose window.  In the center of the courtyard is a lively',
  'fountain and a few marble benches provide seating.  To the south side is an',
  'arch-like portal.  A sheet of silvery-white fire fills the portal.  It is',
  'bright.',
  'There are two exits: west and an open set of oaken double doors leading east.',
];
const splitLog = [
  at(0, 'Running under version 3.2.10-dev.608.'),
  at(0, '> You are Mazorn the spyder.  You are a middle aged spyder.'),
  ...dayRoom.map((l) => at(1, l.text)),
  at(3, '>> enter north portal'),
  at(4, '> You step into the no'),
  at(4, 'rth portal.'),
  ...FORECOURT.map((l) => at(4, l)),
];
const splitFile = writeLog('session_2026-08-17T08-00-00-000.log', splitLog);
const dayRoomExits = lineOf(splitLog, at(1, dayRoom[dayRoom.length - 1].text));
const splitRun = (opts: Partial<ReplayOptions>) => {
  const seen = { blocks: [] as string[], portals: [] as (string | null)[], lost: [] as number[] };
  const r = new TownReplay(
    { expand: (raw) => [raw], ...opts },
    {
      onBlock: ({ block }) => seen.blocks.push(block.name),
      onPortal: (dir) => seen.portals.push(dir),
      onLostBlock: (line) => seen.lost.push(line),
    }
  );
  r.replayLog(splitFile);
  const s = r.stats;
  return {
    ...seen,
    s,
    desc: `rejoins ${s.rejoins}, blocks ${seen.blocks}, lost ${s.lostBlocks} at :${seen.lost}, portals ${JSON.stringify(seen.portals)}`,
  };
};
const joinedRun = splitRun({});
check(
  joinedRun.s.rejoins === 2 &&
    joinedRun.s.blocks === 2 &&
    joinedRun.blocks.join() === 'Day Room,Forecourt' &&
    joinedRun.s.lostBlocks === 0 &&
    joinedRun.s.portals === 1 &&
    joinedRun.portals.join() === 'north',
  `replay (rejoin by default): both blocks parse, the portal transit reaches the localizer (${joinedRun.desc})`
);
const rawRun = splitRun({ rejoin: false });
check(
  rawRun.s.rejoins === 0 &&
    rawRun.s.blocks === 1 &&
    rawRun.blocks.join() === 'Forecourt' &&
    rawRun.s.lostBlocks === 1 &&
    rawRun.lost.join() === String(dayRoomExits) &&
    rawRun.s.portals === 0,
  `replay --no-rejoin: the split Day Room is ONE lost block, at its exits line :${dayRoomExits}; the transit is missed (${rawRun.desc})`
);

// ---------------------------------------------------------------------------
// 5. Aliases: character first, then global; a bad file is an error
// ---------------------------------------------------------------------------
const alias = (pattern: string, body: string): Alias => ({
  id: `${pattern}-${body}`,
  pattern,
  matchMode: 'exact',
  body,
  enabled: true,
  group: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const expand = makeCharExpander({
  global: [alias('rt', 'retire tonfa'), alias('ep', 'enter portal')],
  byChar: { mazorn: [alias('rt', 'dis tonfa')] },
});
check(
  expand('rt', 'mazorn').join() === 'dis tonfa' &&
    expand('ep', 'mazorn').join() === 'enter portal' &&
    expand('rt', 'trilok').join() === 'retire tonfa' &&
    expand('rt', null).join() === 'retire tonfa',
  'character aliases win over global ones; others fall back to global'
);
const throws = (f: () => unknown, re: RegExp) => {
  try {
    f();
    return false;
  } catch (e) {
    return re.test((e as Error).message);
  }
};
check(
  throws(() => loadAliasSets(path.join(dir, 'no-such-aliases.json')), /cannot read aliases/),
  'a missing aliases file throws'
);
const notAliases = path.join(dir, 'settings.json');
fs.writeFileSync(notAliases, '{"townMapperEnabled": false}');
check(
  throws(() => loadAliasSets(notAliases), /not an aliases\.json/),
  'a non-aliases file throws'
);
const aliasesFile = path.join(dir, 'aliases.json');
fs.writeFileSync(
  aliasesFile,
  JSON.stringify({
    global: { a: alias('rt', 'retire tonfa'), b: { ...alias('x', 'y'), bodyMode: 'script' } },
    Mazorn: { c: alias('rt', 'dis tonfa'), d: { body: 'no pattern' } },
  })
);
const sets = loadAliasSets(aliasesFile);
check(
  sets.global.length === 1 && sets.byChar.mazorn?.length === 1,
  `alias sets: script and malformed records dropped, character keys lower-cased (${JSON.stringify(sets)})`
);

// ---------------------------------------------------------------------------
// 6. The tools' exits grammar mirrors the parser's
// ---------------------------------------------------------------------------
// Lost-block accounting and the rejoin's room scope use serverLines.ts's
// copy of townParser.ts's private EXITS_START_RE; a parser change that
// leaves the copy behind skews both without a sound. Same regex text...
const parserSrc = fs.readFileSync(new URL('../../src/lib/townParser.ts', import.meta.url), 'utf8');
const parserExits = /const EXITS_START_RE =\s*(\/.+\/[a-z]*);/.exec(parserSrc)?.[1];
check(
  parserExits === String(EXITS_START_RE),
  `scripts/lib/serverLines.ts EXITS_START_RE ${EXITS_START_RE} no longer mirrors ` +
    `src/lib/townParser.ts (${parserExits}): update the copy or export the parser's`
);
// ...and the same verdict on the exits forms the parser knows or may learn
for (const exits of [
  ['There is one obvious exit: west.'],
  ['> There are four exits: down, up, north, and south.'],
  ['There are many exits: north, northeast, east, southeast, south, southwest, west,', 'and up.'],
  ['There are no obvious exits.'],
]) {
  let blocks = 0;
  const p = new TownParser(() => blocks++);
  for (const l of [
    'Stone Cell',
    'This is a bare stone cell with damp walls.  It is bright.',
    ...exits,
  ]) {
    p.feedLine(l);
  }
  p.flushPending();
  check(
    (blocks === 1) === EXITS_START_RE.test(exits[0]),
    `${JSON.stringify(exits[0])}: the parser ${blocks ? 'emits a block' : 'emits nothing'} but ` +
      `serverLines EXITS_START_RE says ${EXITS_START_RE.test(exits[0])}`
  );
}

// ---------------------------------------------------------------------------
// 7. Merge-copy provenance (--tag-origins): only the rooms a merge copied
// ---------------------------------------------------------------------------
// The player walks s off the established Square into an unmapped Well; the
// room just left now matches a fragment's Square, which merges in and
// brings a Shrine the established town never saw. The Well (this block's
// own new room) is older than the copied Shrine and must keep its own
// origin: tagging every id past the block's start blamed it on the merge.
{
  const room = (name: string, exits: string): TownRoomBlock => ({
    name,
    descFirst: `This is the ${name.toLowerCase()}, a place with plenty of distinctive prose.`,
    desc: `This is the ${name.toLowerCase()}, a place with plenty of distinctive prose.  It is bright.`,
    exits: parseTownExits(`There are exits: ${exits}.`),
  });
  const map = new TownMapStore();
  const add = (t: Town, name: string, exits: string, x: number, y: number, z = 0): TownRoom =>
    map.addRoom(t, room(name, exits), x, y, z, 0);
  const E = map.createTown('Eris');
  const square = add(E, 'Square', 'east, north and south', 0, 0);
  map.link(E, square, 'e', add(E, 'Market', 'west', 1, 0));
  map.link(E, square, 'n', add(E, 'Temple', 'north and south', 0, -1));
  const F = map.createTown('Square');
  const fSquare = add(F, 'Square', 'east, north and south', 0, 0);
  const fTemple = add(F, 'Temple', 'north and south', 0, -1);
  map.link(F, fSquare, 'e', add(F, 'Market', 'west', 1, 0));
  map.link(F, fSquare, 'n', fTemple);
  map.link(F, fTemple, 'n', add(F, 'Shrine', 'south', 0, -2));
  const loc = new TownLocalizer(map);
  loc.active = true;
  map.pos = { townId: E.id, roomId: square.id };
  loc.trackCommand('s', 1000);
  const res = loc.onRoomBlock(room('Well', 'north'), null, 2000);
  const well = [...E.rooms.values()].find((r) => r.name === 'Well');
  const shrine = [...E.rooms.values()].find((r) => r.name === 'Shrine');
  check(
    res.kind === 'new-room' && res.merged?.into === E.id && res.merged.placed === 1,
    `provenance: the new Well's block merged the fragment in (${res.kind}, ${JSON.stringify(res.merged)})`
  );
  const copies = res.merged ? mergeCopyIds(map, res.merged) : [];
  check(
    !!well && !!shrine && copies.length === 1 && copies[0] === shrine.id,
    `provenance: only the copied Shrine is a merge copy (${JSON.stringify(copies)}; Well #${well?.id})`
  );
  // A same-town merge re-places the duplicate component's own rooms: no copies
  const T = map.createTown('Segliz');
  const main = add(T, 'Main Street', 'east and north', 0, 0);
  map.link(T, main, 'n', add(T, 'Harbor Way', 'north and south', 0, -1));
  map.link(T, main, 'e', add(T, 'Weathered Gate', 'west', 1, 0));
  const dup = add(T, 'Main Street', 'east and north', 5, 5, 1);
  const dupWay = add(T, 'Harbor Way', 'north and south', 5, 4, 1);
  map.link(T, dup, 'n', dupWay);
  map.link(T, dup, 'e', add(T, 'Weathered Gate', 'west', 6, 5, 1));
  map.link(T, dupWay, 'n', add(T, 'Warehouse', 'south', 5, 3, 1));
  const result = map.mergeTowns(T, dup.id, T, main.id);
  check(
    !!result &&
      result.placed === 1 &&
      mergeCopyIds(map, { from: T.id, into: T.id, ...result }).length === 0,
    `provenance: a same-town merge copies nothing (${JSON.stringify(result)})`
  );
}

// ---------------------------------------------------------------------------
// 8. The layout gate's grid audit (gridAudit → replay quality → layout line)
// ---------------------------------------------------------------------------
// A broken grid moves no localization count: with the stretch looking for
// the occupant on floor 0 whatever the arrival's floor, the frozen-corpus
// replay printed the same numbers (one stretch fewer) while its end state
// held two rooms in one cell. The audit counts what the index cannot hold.
{
  const block = (name: string): TownRoomBlock => ({
    name,
    descFirst: `The ${name.toLowerCase()}.`,
    desc: `The ${name.toLowerCase()}.`,
    exits: parseTownExits('There are exits: east and west.'),
  });
  const map = new TownMapStore();
  const T = map.createTown('Gridville');
  map.addRoom(T, block('Hall'), 0, 0, 1, 0);
  const gallery = map.addRoom(T, block('Gallery'), 1, 0, 1, 0);
  const alcove = map.addRoom(T, block('Alcove'), 0, 0, -1, 0);
  const audit = () => JSON.stringify(gridAudit(T));
  check(audit() === '{"sharedCells":0,"gridErrors":0}', `grid audit: a sound town (${audit()})`);
  // The alcove lands on the hall's cell (one floor up) and takes its index
  // entry: one room too many on that cell, and the hall's cell no longer
  // names the hall
  T.grid.delete('0,0,-1');
  alcove.z = 1;
  T.grid.set('0,0,1', alcove.id);
  check(audit() === '{"sharedCells":1,"gridErrors":1}', `grid audit: a shared cell (${audit()})`);
  // A room moved without its index entry: the old key names a room standing
  // elsewhere, and its new cell is not indexed
  gallery.x = 2;
  check(audit() === '{"sharedCells":1,"gridErrors":3}', `grid audit: a stale key (${audit()})`);
  // A key naming a room the town no longer has
  T.grid.set('9,9,1', 99);
  check(audit() === '{"sharedCells":1,"gridErrors":4}', `grid audit: a dangling key (${audit()})`);
}

fs.rmSync(dir, { recursive: true, force: true });
if (fail) process.exit(1);
console.log(
  'PASS: replay harness — rejoin guards and window, replayed rejoin + lost blocks, login ' +
    'characters, nested files, per-character stores, restarts, snapshots, map-file owners, ' +
    'counter banking, late switch (room, survey, deadline, next login, end of file), ' +
    'character aliases, exits grammar mirror, merge-copy provenance, grid audit'
);
