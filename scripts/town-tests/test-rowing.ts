/**
 * Regression test: rows that leave the boat where it is are no hex moves.
 * Bill's first session rowing since boats count rows as hex moves
 * (session_2026-11-06T18-52-38-376.log) started three fresh hex islands on
 * one trip: only "You made some progress." moves the boat, but every row
 * was queued, so on open water (where every candidate fits) the map
 * followed the dead rows and was 8 hexes off when land came into view.
 *
 *  A. Each reply to a row that doesn't move the boat is a soft move failure
 *     (soft: ground a rowboat can't cross is ground a walk can), and a row
 *     into a harbor is an unseen move.
 *  B. A boat's view has no description, and the next row's reply came one
 *     or two lines after it, inside the parser's wait for the description,
 *     and went unread. It ends the wait, after the view.
 *  C. Dead rows between two real ones (log 12:00:13): the map moves by the
 *     real rows only.
 *  D. Into a harbor and back out (log 12:03:09-12:03:11): "You pull into
 *     the harbor." shows the dock, no view, and the boat is on the harbor's
 *     hex; the row after it that "plays around near the shore" goes
 *     nowhere. The view after rowing back out is one hex from the harbor.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RoomParser, type RoomParserEvent } from '../../src/lib/roomParser';
import { applyDirection, type HexCoord } from '../../src/lib/hexUtils';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

/** An open-water view from the rowboat (log 12:00:13), as the server sends it */
const WATER_VIEW = [
  'Outside you see:',
  'You gaze at your surroundings.',
  '',
  '              -----               1) a wooden rowboat christened "the minnow"',
  '             /~~ ~~\\             ',
  '        -----  ~  ~~-----        ',
  '       /~~  ~\\  ~  /  ~  \\       ',
  '  -----  ~~  ~-----~~  ~  -----  ',
  ' /  ~~ \\  ~~ / ~~ ~\\~~ ~~/~  ~~\\ ',
  '- ~  ~~ -----~  ~  ~-----  ~  ~~-',
  ' \\~~  ~/  ~~ \\~  ~ /~  ~~\\ ~~  / ',
  '  -----~~  ~  ----- ~~  ~ -----  ',
  ' / ~~  \\~~  ~/~~ ~~\\ ~~  /~ ~~ \\ ',
  '-~  ~~  -----  ~1 ~~----- ~  ~~ -',
  ' \\~  ~~/~ ~~ \\  ~  /~  ~~\\ ~  ~/ ',
  '  ----- ~  ~~ ----- ~~  ~ -----  ',
  ' /  ~~ \\ ~  ~/~  ~ \\ ~~  /~  ~~\\ ',
  '- ~  ~~ ----- ~~ ~~ ----- ~~  ~ -',
  ' \\~~  ~/~~  ~\\ ~  ~/~  ~ \\ ~~  / ',
  '  -----  ~~  ~----- ~~ ~~ -----  ',
  '       \\  ~~ /~  ~ \\ ~  ~/       ',
  '        ----- ~~  ~ -----        ',
  '             \\ ~~ ~/             ',
  '              -----              ',
];

// --- A. Row replies -------------------------------------------------------
{
  const events = (line: string): RoomParserEvent[] => {
    const out: RoomParserEvent[] = [];
    new RoomParser((e) => out.push(e)).feedLine(line);
    return out;
  };
  for (const line of [
    'You made a little progress.',
    'You catch a crab and make no progress.',
    'You just play around near the shore.',
    "Try as you might, the rowboat doesn't seem to want to be rowed over the ground.",
  ]) {
    const ev = events(line);
    check(
      ev.length === 1 && ev[0].type === 'move-failed' && !ev[0].hard,
      `A: "${line}" is a soft move failure (got ${JSON.stringify(ev)})`
    );
  }
  const harbor = events('You pull into the harbor.');
  check(
    harbor.length === 1 && harbor[0].type === 'unseen-move',
    `A: a row into a harbor is an unseen move (got ${JSON.stringify(harbor)})`
  );
  for (const line of ['You made some progress.', 'You row out away from land.']) {
    check(events(line).length === 0, `A: "${line}" is no event (the view follows)`);
  }
}

// --- B. The next row's reply ends the wait for a description ----------------
{
  const kinds: string[] = [];
  const parser = new RoomParser((e) => kinds.push(e.type));
  for (const line of WATER_VIEW) parser.feedLine(line);
  parser.feedLine('You try to row to the northeast.');
  parser.feedLine('You made a little progress.');
  check(
    kinds.join(',') === 'survey,move-failed',
    `B: the view, then the dead row (got ${kinds.join(',') || 'nothing'})`
  );
}

// --- C, D. Through the live wiring ------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowing-'));
let fileNo = 0;
/** One session log: `|`-prefixed lines are server output, `>> ` lines input */
function sessionLog(lines: string[]): string {
  const t0 = Date.UTC(2026, 10, 6, 9, 0, 0) + fileNo * 3_600_000;
  const stamped = lines.map((raw, i) => {
    const d = new Date(t0 + i * 100);
    const h = d.getUTCHours();
    const stamp =
      `[${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')} ${h % 12 || 12}:` +
      `${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ` +
      `${h < 12 ? 'AM' : 'PM'}]`;
    return `${stamp} ${raw}`;
  });
  const f = path.join(dir, `session_2026-11-06T${String(fileNo++).padStart(2, '0')}-00-00-000.log`);
  fs.writeFileSync(f, stamped.join('\n') + '\n');
  return f;
}
const row = (d: string, ...reply: string[]) => [`>> row ${d}`, 'You try to row.', ...reply];
const moved = (d: string) => row(d, 'You made some progress.', ...WATER_VIEW);
/** Live, the parser's idle flush ends the wait for a view's description
 *  once output goes quiet; the replay has none, so the first view (the
 *  map's origin, which takes the head move) would wait for the first row's
 *  reply and take that row, and the last view would never be read. Three
 *  lines end the wait. */
const QUIET = Array(3).fill("You're distracted and off balance.");
function replay(lines: string[]) {
  const r = new TownReplay({ expand: (raw) => [raw] });
  r.replayLog(sessionLog(['You board the boat.', ...WATER_VIEW, ...QUIET, ...lines, ...QUIET]));
  return r;
}
const at = (r: TownReplay, want: HexCoord, msg: string) => {
  const pos = r.hexMap.pos;
  check(
    pos !== null && pos.island === 0 && pos.q === want.q && pos.r === want.r,
    `${msg}: want 0:${want.q},${want.r}, got ${pos ? `${pos.island}:${pos.q},${pos.r}` : 'none'}`
  );
};
const origin: HexCoord = { q: 0, r: 0 };

// C. Dead rows between two real ones
{
  const r = replay([
    ...moved('se'),
    ...row('ne', 'You made a little progress.'),
    ...row('ne', 'You catch a crab and make no progress.'),
    ...moved('se'),
  ]);
  at(r, applyDirection(applyDirection(origin, 'se'), 'se'), 'C: two real rows southeast');
  check(r.hexLocalizer.pendingMoves.length === 0, 'C: no dead row left queued');
}

// D. Into a harbor and back out
{
  const r = replay([
    ...moved('se'),
    ...row(
      'se',
      'You made some progress.',
      'You pull into the harbor.',
      'Outside you see:',
      'Beach: A beach of sparkling gold and silver sand ',
      '< n >',
      'a wooden rowboat christened "The Minnow", and a fairy ship.'
    ),
    ...row('se', 'You just play around near the shore.'),
    ...row('ne', 'You row out away from land.', ...WATER_VIEW),
  ]);
  const harbor = applyDirection(applyDirection(origin, 'se'), 'se');
  at(r, applyDirection(harbor, 'ne'), 'D: one hex northeast of the harbor');
  check(r.hexLocalizer.pendingMoves.length === 0, 'D: no row left queued');
}

fs.rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('rowing: all checks passed');
