/**
 * Regression test: the parser feed and the session log cut the stream into
 * the same whole lines (Oct 2026 deep dive, parser lens: outputfilter-
 * partial-flush and session-logger-fidelity — shipped together).
 *
 *  A. OutputFilter: a chunk's tail that is only indentation (spaces or
 *     tabs), or that ends in a "<tag>", waits for the rest of its line.
 *     Flushed at the chunk end (to the screen only), it cut the line in two
 *     for the parsers: 533 of 8,704 DartForge-logged surveys (6.1%) lost a
 *     row's indentation that way and with it hexes of the bottom row, and
 *     "     Chat" in the OOC Entry Hall reached the town parser as "Chat".
 *     Prompts flush at once: "> ", "Name:", and now the pager's "--- Press
 *     <enter> for more. ---", which ends in no ">": it stayed off the screen
 *     while the server waited for Enter, then reached the parsers glued to
 *     the next page's first line.
 *  B. The parser feed is the same whatever the TCP reads: a survey, the OOC
 *     Entry Hall (blank-framed, indented board names) and a peek line cut at
 *     every position give the intact stream's lines — and the same parsed
 *     hexes.
 *  C. The session logger's line splitter (useSessionLogger) gives exactly
 *     those lines too — blank lines included, bare prompts left out — so a
 *     replay reads what the parsers read. It used to log each chunk split on
 *     its own and drop blank lines ("marke" / "t." for a room name, the
 *     hall's notice without its frame). A line still waiting when the
 *     connection drops is logged as it stands.
 */
import { OutputFilter } from '../../src/lib/outputFilter';
import { RoomParser, type RoomParserEvent } from '../../src/lib/roomParser';
import { SessionLineSplitter, isLoggedOutputLine } from '../../src/lib/sessionLog';
import { TownParser, type TownRoomBlock } from '../../src/lib/townParser';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

/** Feed chunks through a fresh OutputFilter; returns the parser feed and the screen output */
function filterChunks(chunks: string[]): { lines: string[]; screen: string } {
  const lines: string[] = [];
  const filter = new OutputFilter({ onMapLine: (line) => lines.push(line) });
  filter.stripPrompts = true;
  let screen = '';
  for (const c of chunks) screen += filter.filter(c);
  return { lines, screen };
}

// --- A: what waits and what flushes -------------------------------------------------------
{
  const hall = filterChunks([
    'There are new notes to read on the following boards:\r\n     ',
    'Chat\r\n',
  ]);
  check(
    hall.lines[1] === '     Chat',
    `A: an indentation-only tail waits for its line (${JSON.stringify(hall.lines)})`
  );
  const tabbed = filterChunks(['notes:\r\n\t', 'Chat\r\n']);
  check(tabbed.lines[1] === '\tChat', `A: ... tabs included (${JSON.stringify(tabbed.lines)})`);
  const peek = filterChunks(["Healer's Hall: a comfortable guest hall < n s u >", '\r\nok\r\n']);
  check(
    peek.lines[0] === "Healer's Hall: a comfortable guest hall < n s u >",
    `A: a tail ending in a <tag> waits for its line (${JSON.stringify(peek.lines)})`
  );
  const prompt = filterChunks(['You open the gate.\r\n> ']);
  check(
    prompt.lines.join('|') === 'You open the gate.' && !prompt.screen.includes('> '),
    `A: the "> " prompt still flushes at once (${JSON.stringify(prompt)})`
  );
  // (With prompts shown, the flush is visible: the prompt is on the screen)
  const shown = new OutputFilter({});
  shown.stripPrompts = false;
  check(
    shown.filter('You open the gate.\r\n> ').endsWith('> '),
    'A: ... shown at once when prompts are shown'
  );
  // The pager stops the output and waits for Enter; the next page goes on
  // on the same line (dm-2021-*.txt: "--- Press <enter> for more. ---lower
  // left hand  (in perfect health):")
  const paged = [
    'upper left hand  (in perfect health):\r\n--- Press <enter> for more. ---',
    'lower left hand  (in perfect health):\r\n',
  ];
  const first = filterChunks(paged.slice(0, 1));
  check(
    first.screen.endsWith('--- Press <enter> for more. ---'),
    `A: the pager prompt reaches the screen while the server waits (${JSON.stringify(first.screen)})`
  );
  const pager = filterChunks(paged);
  check(
    pager.lines.join('|') ===
      'upper left hand  (in perfect health):|lower left hand  (in perfect health):',
    `A: ... and the next page's first line reaches the parsers whole (${JSON.stringify(pager.lines)})`
  );
  const splitter = new SessionLineSplitter();
  check(
    JSON.stringify(paged.flatMap((c) => splitter.push(c))) ===
      JSON.stringify([
        'upper left hand  (in perfect health):',
        '--- Press <enter> for more. ---',
        'lower left hand  (in perfect health):',
      ]),
    'A: the log shows the prompt as a line of its own'
  );
  // A read that ends inside the prompt ("--- Press <enter>" ends in a tag)
  const [head, tail] = [
    paged[0].slice(0, paged[0].indexOf('---')),
    '--- Press <enter> for more. ---',
  ];
  let cutPrompts = 0;
  for (let p = 1; p < tail.length; p++) {
    const parts = filterChunks([head + tail.slice(0, p), tail.slice(p), paged[1]]);
    if (parts.lines.join('|') !== pager.lines.join('|')) cutPrompts++;
  }
  check(cutPrompts === 0, `A: ... whichever read it ends (${cutPrompts} cuts differ)`);
  const name = filterChunks(['Name: ']);
  check(name.screen === 'Name: ', 'A: the login prompt reaches the screen at once');
}

// --- B/C: one stream, cut every which way ----------------------------------------------------

const SURVEY = [
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
  'worn deep ruts in the ground here.  It is extremely light here.',
];
const HALL = [
  'OOC Entry Hall',
  'This is the entry hall of the OOC area.  Archways lead off in every direction',
  'and a large board hangs on the wall.',
  '',
  'There are new notes to read on the following boards:',
  '     Chat',
  '     Ideas',
  '',
  'It is painfully bright.',
  'There are three exits: north, south, and east.',
];
/** The server's lines, then the burst ends in a prompt */
const reply = (lines: string[]) => lines.map((l) => `${l}\r\n`).join('') + '> ';
const STREAM =
  reply(SURVEY) +
  reply(HALL) +
  reply(["Healer's Hall: a comfortable guest hall < n s u >"]) +
  reply(['You open the gate.']);
/** Prompt positions — a TCP read never splits the 2-byte "> " in this model */
const promptAt = new Set<number>();
for (let i = STREAM.indexOf('> '); i >= 0; i = STREAM.indexOf('> ', i + 1)) promptAt.add(i + 1);

const cutAt = (points: number[]) => {
  const chunks: string[] = [];
  let from = 0;
  for (const p of [...points].sort((a, b) => a - b)) {
    if (p <= from || p >= STREAM.length || promptAt.has(p)) continue;
    chunks.push(STREAM.slice(from, p));
    from = p;
  }
  chunks.push(STREAM.slice(from));
  return chunks;
};
const intact = filterChunks([STREAM]).lines;
check(
  intact.includes('     Chat') && intact.includes(''),
  'B: the intact feed has indentation and blanks'
);

function parse(lines: string[]) {
  const surveys: string[] = [];
  const blocks: TownRoomBlock[] = [];
  const hex = new RoomParser((e: RoomParserEvent) => {
    if (e.type === 'survey') surveys.push(JSON.stringify(e.art));
  });
  const town = new TownParser((b) => blocks.push(b));
  for (const l of lines) {
    hex.feedLine(l);
    town.feedLine(l);
  }
  hex.flushPending();
  town.flushPending();
  return { surveys, blocks };
}
const intactParse = parse(intact);
check(
  intactParse.surveys.length === 1 && intactParse.surveys[0] !== 'null',
  'B: the intact survey parses'
);
check(intactParse.blocks.map((b) => b.name).join() === 'OOC Entry Hall', 'B: the hall parses');

/**
 * The session logger, as useSessionLogger drives it. The log keeps a prompt
 * that shares a line with the reply after it ("> OOC Entry Hall") as the
 * server sent it; the OutputFilter strips it from the parser feed
 * (stripPrompts) — every parser reads both alike (`(?:> )*`), so the lines
 * compare with it stripped the filter's way.
 */
function logLines(chunks: string[]): string[] {
  const splitter = new SessionLineSplitter();
  const out: string[] = [];
  for (const c of chunks) out.push(...splitter.push(c).filter(isLoggedOutputLine));
  out.push(...splitter.flush().filter(isLoggedOutputLine));
  return out.map((l) => (/^> \S/.test(l) ? l.slice(2) : l));
}

let seed = 20261003;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let feedDiffs = 0;
let parseDiffs = 0;
let logDiffs = 0;
const runs: number[][] = [];
// Every single cut position, then 300 random multi-cut reads
for (let p = 1; p < STREAM.length; p++) runs.push([p]);
for (let i = 0; i < 300; i++) {
  const n = 1 + Math.floor(rnd() * 12);
  runs.push(Array.from({ length: n }, () => 1 + Math.floor(rnd() * (STREAM.length - 1))));
}
for (const points of runs) {
  const chunks = cutAt(points);
  const feed = filterChunks(chunks).lines;
  if (feed.join('\n') !== intact.join('\n')) {
    if (feedDiffs++ === 0) {
      console.error(`  first feed difference at cuts ${points}: ${JSON.stringify(feed)}`);
    }
    continue;
  }
  const p = parse(feed);
  if (JSON.stringify(p) !== JSON.stringify(intactParse)) parseDiffs++;
  const logged = logLines(chunks);
  if (logged.join('\n') !== intact.join('\n')) {
    if (logDiffs++ === 0) {
      console.error(`  first log difference at cuts ${points}: ${JSON.stringify(logged)}`);
    }
  }
}
check(
  feedDiffs === 0,
  `B: the parser feed is cut-invariant (${feedDiffs} of ${runs.length} reads differ)`
);
check(parseDiffs === 0, `B: ... and so are the parsed hexes and rooms (${parseDiffs} differ)`);
check(
  logDiffs === 0,
  `C: the session log has exactly the parser feed's lines (${logDiffs} of ${runs.length} differ)`
);

// --- C: the splitter's own rules ---------------------------------------------------------------
{
  const s = new SessionLineSplitter();
  check(
    JSON.stringify(s.push('one\r\n\r\ntw')) === '["one",""]',
    'C: a blank line is a line; a cut line waits'
  );
  check(JSON.stringify(s.push('o\r\n')) === '["two"]', 'C: ... and comes back whole');
  check(JSON.stringify(s.push('Name: ')) === '["Name: "]', 'C: the Name: prompt is logged at once');
  check(JSON.stringify(s.push('\r')) === '[]', 'C: a lone CR is no line');
  check(JSON.stringify(s.push('\nhalf a li')) === '[""]', 'C: (the CR ends a blank line)');
  check(JSON.stringify(s.flush()) === '["half a li"]', 'C: a disconnect logs a waiting line as is');
  check(JSON.stringify(s.flush()) === '[]', 'C: ... once');
  check(!isLoggedOutputLine('> ') && !isLoggedOutputLine('>'), 'C: bare prompts are not logged');
  check(isLoggedOutputLine('') && isLoggedOutputLine('> You open it.'), 'C: everything else is');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — session log lines = parser feed');
