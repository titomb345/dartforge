/**
 * Regression test: a session log written by the new logger replays like
 * live (Oct 2026 deep dive: commands/replay-cannot-see-unlogged-sends,
 * walking/walk-sends-invisible-in-logs, duplicates/session-log-fidelity).
 *
 * The logger used to record typed input only, and output split at every TCP
 * read with blank lines dropped. A replay re-expanded the typed input with
 * TODAY's aliases (Leading mode never applied), never saw a walk's steps,
 * door sequences, trigger or timer sends (192 room changes of the July
 * sessions arrived with nothing queued), and parsed half-lines live never
 * saw. Now every command is logged as it is sent (`>> [sent] lead n`) next
 * to the typed line, and output is cut into the parser feed's own lines.
 *
 *  A. One scripted session — a login, a survey and town blocks cut at odd
 *     TCP reads, a walk (sends nobody typed), `door n` through the /door
 *     built-in, Bill's `port` alias failing with "What ?", a move in Leading
 *     mode whose block the pager breaks in two, a send held by the action
 *     blocker and released later — runs
 *     through the LIVE pipeline (OutputFilter → onMapLine → the shared line
 *     dispatcher → RoomParser → TownParser; every send tracked) and,
 *     logged by the session logger's own writer (SessionLogWriter), through
 *     the replay engine. Every room block resolves alike, to the same rooms,
 *     and the maps match.
 *  B. In a log with sent lines the typed input is never expanded or
 *     tracked: a typed line reaches the hooks as typed, the sent lines are
 *     tracked as they stand.
 *  C. An older log (typed input only) still goes through the alias engine,
 *     and still has its TCP fragments rejoined; a log with sent lines is
 *     read as it stands (the new logger never splits a line).
 *  D. A command the action blocker held is tracked when it was sent, not
 *     when it was typed.
 *  E. /unblock releases what the blocker held through the same send path
 *     as the automatic release (tracked and logged as sent): it used to
 *     send them raw, so a move typed during a cast and released by /unblock
 *     was a room change the mapper never saw.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActionBlocker } from '../../src/lib/actionBlocker';
import { dispatchBuiltinCommand, type BuiltinContext } from '../../src/lib/builtinCommands';
import { HexLocalizer } from '../../src/lib/hexLocalizer';
import { HexMapStore } from '../../src/lib/hexMap';
import { OutputFilter } from '../../src/lib/outputFilter';
import { PAGER_PROMPT } from '../../src/lib/partialLine';
import { RoomParser } from '../../src/lib/roomParser';
import {
  SENT_PREFIX,
  SessionLogWriter,
  TYPED_PREFIX,
  formatLogStamp,
} from '../../src/lib/sessionLog';
import { dispatchTownLine } from '../../src/lib/townLineEvents';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { TownMapStore, hexAnchorKey } from '../../src/lib/townMap';
import { TownParser } from '../../src/lib/townParser';
import { FakeTimers } from '../lib/fakeTimers';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marked-sends-'));
let files = 0;
const writeLog = (lines: string[]) => {
  const f = path.join(dir, `session_test-${String(files++).padStart(3, '0')}.log`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
};
/** The session logger's stamp (12-hour clock, local time) */
const stamp = (t: number) => `[${formatLogStamp(new Date(t), '12h')}]`;

// --- the scripted session ------------------------------------------------------------------

type Step =
  /** Server output as TCP reads deliver it (chunk boundaries anywhere) */
  | { at: number; out: string[] }
  /** Typed input and the commands it really sent (aliases, movement mode) */
  | { at: number; typed?: string; sent: string[] }
  /** The action blocker releases commands typed earlier */
  | { at: number; released: string[] };

const T0 = new Date(2026, 9, 3, 14, 0, 0).getTime();
const s = (sec: number) => T0 + sec * 1000;
const lines = (...l: string[]) => l.map((x) => `${x}\r\n`).join('');
const SURVEY = lines(
  'You gaze at your surroundings.',
  '',
  '        -----        ',
  '       / ..  \\       ',
  '  -----.. ..  -----  ',
  ' /   . \\.. ../.  . \\ ',
  '- .   . -----  .  . -',
  ' \\ .  ./.  . \\  .  / ',
  '  ----- .. .. -----  ',
  ' / h   \\ .  ./. .. \\ ',
  '-h  h  h-----... .. -',
  ' \\h  h /  .  \\.. ../ ',
  '  -----    .  -----  ',
  '       \\.    /       ',
  '        -----        ',
  'This is a large wet plain.  It is raining.  The passage of feet and wagons has',
  'worn deep ruts in the ground here.  It is extremely light here.'
);
const room = (name: string, desc: string, exits: string) =>
  lines(name, desc, 'It is bright.', exits);
const GATEHOUSE = room(
  'Gatehouse',
  'Thick stone walls rise on either side of this gatehouse, its portcullis raised.',
  'There are three exits: north, east, and west.'
);
const BAILEY = room(
  'Bailey',
  'The bailey of the keep is a wide yard of packed earth between the outer walls.',
  'There are two exits: south and a closed oak door leading north.'
);
const HALL = room(
  'Great Hall',
  'Long tables fill the great hall, and a fire burns in a hearth along one wall.',
  'There are two exits: west and a closed oak door leading south.'
);
const ARMORY = room(
  'Armory',
  'Racks of spears and shields line the walls of this cramped and dusty armory.',
  'There is one obvious exit: east.'
);
/** Cut a string at the given offsets (TCP reads) */
const cut = (text: string, ...at: number[]) => {
  const out: string[] = [];
  let from = 0;
  for (const p of at) {
    out.push(text.slice(from, p));
    from = p;
  }
  out.push(text.slice(from));
  return out;
};

const DOOR = [
  'unlock n door with key',
  'unlock n door with key 2',
  'open n door',
  'n',
  'close s door',
  'lock s door with key',
  'lock s door with key 2',
];
const script: Step[] = [
  {
    at: s(0),
    out: [
      lines(
        'Running under version 3.2.10-dev.608.',
        'You are Mazorn the spyder.  You are a middle aged spyder.'
      ) + '> ',
    ],
  },
  // a survey the pager breaks in two (Enter brings the rest), its bottom
  // rows cut inside their indentation
  {
    at: s(2),
    out: [SURVEY.slice(0, SURVEY.indexOf(' / h')) + PAGER_PROMPT],
  },
  {
    at: s(3),
    out: [
      ...cut(
        SURVEY.slice(SURVEY.indexOf(' / h')),
        SURVEY.indexOf('  -----    .') + 1 - SURVEY.indexOf(' / h'),
        SURVEY.indexOf('       \\.') + 3 - SURVEY.indexOf(' / h')
      ),
      '> ',
    ],
  },
  { at: s(4), typed: 'e', sent: ['e'] },
  // the Gatehouse, cut mid-word
  { at: s(5), out: [...cut(GATEHOUSE, GATEHOUSE.indexOf('gatehouse') + 3), '> '] },
  // a walk: steps nobody typed
  { at: s(7), sent: ['n'] },
  { at: s(8), out: [BAILEY + '> '] },
  // `door n` (Bill's alias) runs the /door built-in
  { at: s(10), typed: 'door n', sent: DOOR },
  {
    at: s(11),
    out: [
      lines('You unlock the oak door.', "You don't have one of those.", 'You open the oak door.') +
        HALL.replace('a closed oak door', 'an open oak door') +
        lines('You close the oak door.', 'You lock the oak door.', "You don't have one of those.") +
        '> ',
    ],
  },
  // `port` where there is no portal: "What ?" twice
  { at: s(14), typed: 'port', sent: ['activate portal', 'enter portal'] },
  { at: s(15), out: [lines('What ?', 'What ?') + '> '] },
  // Leading mode: the typed "w" went out as "lead w"
  { at: s(17), typed: 'w', sent: ['lead w'] },
  // ... its block broken by the pager: the read ends with the prompt, the
  // rest comes once the player presses Enter
  { at: s(18), out: [ARMORY.slice(0, ARMORY.indexOf('It is bright.')) + PAGER_PROMPT] },
  { at: s(19), typed: '', sent: [''] },
  { at: s(19), out: [ARMORY.slice(ARMORY.indexOf('It is bright.')) + '> '] },
  // typed during a cast (held by the action blocker), sent 6 s later
  { at: s(20), typed: 'e', sent: [] },
  { at: s(26), released: ['e'] },
  { at: s(27), out: cut(HALL + '> ', 5) },
];

// --- A: live -------------------------------------------------------------------------------

interface Resolution {
  name: string;
  kind: string;
  room: number | undefined;
}
function runLive(): { resolved: Resolution[]; town: unknown; hex: unknown } {
  const hexMap = new HexMapStore();
  const hexLoc = new HexLocalizer(hexMap);
  const townMap = new TownMapStore();
  const townLoc = new TownLocalizer(townMap);
  let now = 0;
  const resolved: Resolution[] = [];
  const anchor = () => {
    const p = hexMap.pos;
    return p && !hexLoc.lost ? hexAnchorKey(p.island, p.q, p.r) : null;
  };
  const townParser = new TownParser((block) => {
    const res = townLoc.onRoomBlock(block, anchor(), now);
    resolved.push({ name: block.name, kind: res.kind, room: res.pos?.roomId });
  });
  const hexParser = new RoomParser((e) => {
    // useMapTracker's hex wiring
    if (e.type === 'survey') {
      townLoc.onWilderness();
      hexLoc.onSurvey({ art: e.art, description: e.description, now });
      townLoc.noteOutdoorPosition(anchor());
    } else if (e.type === 'move-failed') {
      if (townLoc.active) townLoc.onMoveFailed();
      else hexLoc.onMoveFailed(e.hard);
    } else if (e.type === 'forced-move') hexLoc.trackForcedMove(e.dir, now);
    else hexLoc.onTownRoom(now);
  });
  const filter = new OutputFilter({
    onMapLine: (line, raw) => {
      // useMapTracker.processLine
      dispatchTownLine(line, townLoc, now);
      hexParser.feedLine(line, raw);
      townParser.feedLine(line);
    },
  });
  filter.stripPrompts = true;
  const track = (cmd: string) => {
    if (!townLoc.trackCommand(cmd, now)) hexLoc.trackCommand(cmd, now);
  };
  for (const step of script) {
    now = step.at;
    if ('out' in step) {
      for (const chunk of step.out) {
        // useMudConnection: the login line fires onLogin before the chunk is filtered
        if (/Running under version/.test(chunk)) townLoc.onLogin();
        filter.filter(chunk);
      }
    } else if ('released' in step) {
      for (const c of step.released) track(c);
    } else {
      for (const c of step.sent) track(c);
    }
  }
  townParser.flushPending();
  return { resolved, town: townMap.serialize(), hex: hexMap.serialize() };
}

// --- A: the log, written by the session logger's own writer, replayed --------------------------

function writeSessionLog(): string {
  let now = T0;
  let content = '';
  const timers = new FakeTimers(() => now);
  const writer = new SessionLogWriter({
    append: (_file, text) => {
      content += text;
      return true;
    },
    newFilename: () => 'session_test.log',
    now: () => new Date(now),
    timers,
  });
  writer.setEnabled(true);
  for (const step of script) {
    now = step.at;
    timers.run();
    if ('out' in step) {
      for (const chunk of step.out) writer.output(chunk);
    } else if ('released' in step) {
      for (const c of step.released) writer.sent(c);
    } else {
      // App.handleSend logs non-empty typed input, then each send goes out
      // through sendReleasedRef, which logs it (an empty one is not)
      if (step.typed) writer.typed(step.typed);
      for (const c of step.sent) writer.sent(c);
    }
  }
  writer.close();
  const f = path.join(dir, `session_test-${String(files++).padStart(3, '0')}.log`);
  fs.writeFileSync(f, content);
  return f;
}

const live = runLive();
const logFile = writeSessionLog();
const expanded: string[] = [];
const commands: { raw: string; sent: string[]; typed: boolean }[] = [];
const replayed: Resolution[] = [];
const r = new TownReplay(
  {
    expand: (raw) => {
      expanded.push(raw);
      return [raw];
    },
  },
  {
    onBlock: ({ block, res }) =>
      replayed.push({ name: block.name, kind: res.kind, room: res.pos?.roomId }),
    onCommand: (raw, sent, _tracked, typed) => commands.push({ raw, sent, typed: !!typed }),
  }
);
r.replayLog(logFile);

check(
  live.resolved.map((x) => x.name).join() === 'Gatehouse,Bailey,Great Hall,Armory,Great Hall',
  `A: live resolves every block (${live.resolved.map((x) => `${x.name}:${x.kind}`).join(', ')})`
);
check(
  JSON.stringify(replayed) === JSON.stringify(live.resolved),
  `A: the replay resolves every block like live\n    live:   ${JSON.stringify(live.resolved)}\n    replay: ${JSON.stringify(replayed)}`
);
check(
  !live.resolved.some((x) => x.kind === 'jumped' || x.kind === 'lost'),
  'A: no block went unexplained live'
);
const shape = (town: unknown) => JSON.stringify(town, (k, v) => (k === 'lastSeen' ? undefined : v));
check(shape(r.townMap.serialize()) === shape(live.town), 'A: the replayed map is the live map');
check(
  !JSON.stringify(live.town).includes('Press <enter>'),
  'A: the pager prompt is in no room of the map (it never reaches the parsers)'
);
{
  // The paged survey paints what the whole survey paints
  const map = new HexMapStore();
  const loc = new HexLocalizer(map);
  const parser = new RoomParser((e) => {
    if (e.type === 'survey') loc.onSurvey({ art: e.art, description: e.description, now: s(2) });
  });
  for (const l of SURVEY.split('\r\n')) parser.feedLine(l);
  parser.flushPending();
  const cells = (hex: unknown) => shape((hex as { cells: unknown }).cells);
  check(cells(live.hex) === cells(map.serialize()), 'A: live, the paged survey parses whole');
  check(cells(r.hexMap.serialize()) === cells(live.hex), 'A: ... and so it does in the replay');
}
check(r.stats.markedFiles === 1 && r.stats.rejoins === 0, 'A: read as a log with sent lines');

// --- B: typed input in a log with sent lines --------------------------------------------------
check(expanded.length === 0, `B: typed input is never expanded (${expanded.join(' | ')})`);
const typedPort = commands.find((c) => c.raw === 'port');
check(
  typedPort?.typed === true && typedPort.sent.length === 0,
  `B: a typed line reaches the hooks as typed (${JSON.stringify(typedPort)})`
);
const lead = commands.find((c) => c.raw === 'lead w');
check(
  lead?.typed === false && lead.sent.join() === 'lead w',
  'B: a sent line is tracked as it stands (Leading mode included)'
);

// --- C: an older log --------------------------------------------------------------------------
// The Day Room split by the old logger (session_2026-07-04T13-54-29-349.log:158)
const DAY_ROOM = [
  'Day Room',
  'This is a comfortable sitting room on the second floor of the keep where the',
  'rangers can come and relax between their duties and training.  Daylight streams',
  'in through a window on the west wall.  The floor is covered by a soft, red wool',
  'rug and the walls are hung with various weapons and shields.  In one corner is a',
  'large fireplace b',
  'ut it remains unlit.  The room is furnished with a pair of oak',
  'settles and a small table.  It is bright.',
  'There are four exits: down, up, north, and south.',
].map((l) => `${stamp(s(1))} ${l}`);
{
  const old = writeLog([
    `${stamp(s(0))} Running under version 3.2.10-dev.608.`,
    ...DAY_ROOM,
    `${stamp(s(3))} >> door n`,
  ]);
  const seen: string[] = [];
  const o = new TownReplay({
    expand: (raw) => {
      seen.push(raw);
      return ['n'];
    },
  });
  o.replayLog(old);
  check(seen.join() === 'door n', 'C: an older log expands its typed input');
  check(o.stats.cmdTracked === 1, 'C: ... and tracks the expansion');
  check(o.stats.rejoins === 1 && o.stats.lostBlocks === 0, 'C: ... and rejoins its TCP fragments');

  const marked = writeLog([
    `${stamp(s(0))} Running under version 3.2.10-dev.608.`,
    ...DAY_ROOM,
    `${stamp(s(3))} ${SENT_PREFIX}n`,
  ]);
  const m = new TownReplay({ expand: () => [] });
  m.replayLog(marked);
  check(m.stats.rejoins === 0, 'C: a log with sent lines is read as it stands');
}

// --- D: a held command is tracked when it was sent ----------------------------------------------
{
  const f = writeLog([
    `${stamp(s(0))} Running under version 3.2.10-dev.608.`,
    `${stamp(s(1))} Bailey`,
    `${stamp(s(1))} The bailey of the keep is a wide yard of packed earth between the outer walls.`,
    `${stamp(s(1))} It is bright.`,
    `${stamp(s(1))} There are two exits: south and north.`,
    `${stamp(s(2))} ${TYPED_PREFIX}n`,
    `${stamp(s(8))} ${SENT_PREFIX}n`,
  ]);
  const d = new TownReplay({ expand: () => ['n'] });
  d.replayLog(f);
  const pending = d.townLocalizer.pendingMoves;
  check(
    pending.length === 1 && pending[0].at >= s(8),
    `D: the move is queued at its send, not its typing (${JSON.stringify(pending)})`
  );
}

// --- E: /unblock releases through the tracked send path --------------------------------------
{
  const blocker = new ActionBlocker();
  blocker.block({ key: 'cast', label: 'casting', pattern: /^cast\b/ });
  blocker.enqueue('n');
  blocker.enqueue('look');
  const released: string[] = [];
  const raw: string[] = [];
  const ctx = {
    writeToTerm: () => {},
    sendCommand: async (cmd: string) => void raw.push(cmd),
    sendReleased: async (cmd: string) => void released.push(cmd),
    actionBlocker: blocker,
    actionBlockingEnabled: () => true,
  } as unknown as BuiltinContext;
  await dispatchBuiltinCommand('/unblock', ctx);
  check(
    released.join() === 'n,look' && raw.length === 0 && !blocker.blocked,
    `E: /unblock sends what the blocker held through the tracked, logged path (${released}; raw ${raw})`
  );
}

fs.rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — marked sends: a new log replays like live');
