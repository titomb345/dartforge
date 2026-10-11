/**
 * Regression test: every tool that reads session logs back reads them the
 * same way (Oct 2026 deep dive, app-wiring stage: the session log records
 * every send as `>> [sent] ...` next to the typed input, and the pager's
 * prompt never reaches the parsers live).
 *
 *  A. The shared readers (scripts/lib/replayCorpus.ts): a log with sent
 *     lines is a marked log; a logged command is a send or typed input; an
 *     output line loses a pager prompt in front of it, and a prompt alone is
 *     no line at all.
 *  B. The ground-truth oracle's extractor (scripts/gt/lib/extract.ts) reads
 *     a marked log's sends as its commands and leaves its typed input alone.
 *     It used to read `>> [sent] n` as typed input "[sent] n" — and expand
 *     the typed `door n` on top of the sends it had already made — so an
 *     oracle built from new logs would have aligned room blocks against
 *     commands nobody sent.
 *  C. Drift guard: the town replay, the hex replay (replay-map.ts), the
 *     loadout replay and the extractor read command lines and the pager
 *     prompt through those readers, none on its own. The hex replay used to
 *     feed the pager prompt to the parsers, so a survey the pager broke in
 *     two replayed unlike live.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PAGER_PROMPT } from '../../src/lib/partialLine';
import { SENT_PREFIX, TYPED_PREFIX } from '../../src/lib/sessionLog';
import { parseLogFile } from '../gt/lib/extract';
import { isMarkedLog, loggedCommand, parserText } from '../lib/replayCorpus';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// --- A: the shared readers ----------------------------------------------------------------
check(
  JSON.stringify(loggedCommand(`${SENT_PREFIX}lead n`)) === '{"command":"lead n","sent":true}',
  'A: a sent line is a send'
);
check(
  JSON.stringify(loggedCommand(`${TYPED_PREFIX}door n`)) === '{"command":"door n","sent":false}',
  'A: a typed line is typed input'
);
check(
  loggedCommand('There are two exits: north and south.') === null &&
    loggedCommand('') === null &&
    loggedCommand(TYPED_PREFIX) === null,
  'A: output is no command (nor is an empty command line: the logger writes none)'
);
check(
  isMarkedLog(['Market', `${TYPED_PREFIX}n`, `${SENT_PREFIX}n`]) &&
    !isMarkedLog(['Market', `${TYPED_PREFIX}n`]),
  'A: a log with sent lines is marked, one without is not'
);
check(parserText(PAGER_PROMPT) === null, 'A: a pager prompt alone is no line');
check(
  parserText(`${PAGER_PROMPT}lower left hand  (in perfect health):`) ===
    'lower left hand  (in perfect health):',
  "A: a MUSHclient line glued to the prompt is the next page's first line"
);
check(
  parserText('') === '' && parserText('  -----  ') === '  -----  ',
  'A: other lines as they are'
);

// --- B: the oracle's extractor --------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-readers-'));
  // The Day Room as the old logger split it (session_2026-07-04T13-54-29-349.log:158)
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
  ];
  const write = (name: string, commands: string[]) => {
    const log = path.join(dir, name);
    fs.writeFileSync(
      log,
      [
        '[2026-10-03 2:00:00 PM] Running under version 3.2.10-dev.608.',
        ...DAY_ROOM.map((l) => `[2026-10-03 2:00:00 PM] ${l}`),
        ...commands.map((c) => `[2026-10-03 2:00:01 PM] ${c}`),
        '',
      ].join('\n')
    );
    const expanded: string[] = [];
    const events = parseLogFile(log, true, (raw) => {
      expanded.push(raw);
      return [raw];
    });
    return {
      cmds: events.flatMap((e) => (e.k === 'cmd' ? [e.cmds] : [])),
      descs: events.flatMap((e) => (e.k === 'block' ? [e.b.desc] : [])),
      expanded,
    };
  };
  const marked = write('session_2026-10-03T14-00-00-000.log', [
    `${TYPED_PREFIX}door n`,
    `${SENT_PREFIX}unlock n door with key`,
    `${SENT_PREFIX}open n door`,
    `${SENT_PREFIX}n`,
  ]);
  check(
    JSON.stringify(marked.cmds) === '[["unlock n door with key"],["open n door"],["n"]]',
    `B: a marked log's commands are its sends (${JSON.stringify(marked.cmds)})`
  );
  check(marked.expanded.length === 0, `B: its typed input is not expanded (${marked.expanded})`);
  // (the new logger never splits a line: a pair like this one is two lines)
  check(
    !marked.descs.some((d) => d.includes('fireplace but it')),
    `B: its lines are read as they stand, nothing rejoined (${marked.descs.map((d) => d.slice(260, 300))})`
  );
  const old = write('session_2026-07-04T13-54-29-349.log', [`${TYPED_PREFIX}door n`]);
  check(
    JSON.stringify(old.cmds) === '[["door n"]]' && old.expanded.join() === 'door n',
    'B: an older log still expands its typed input'
  );
  check(
    old.descs.length === 1 && old.descs[0].includes('fireplace but it'),
    `B: ... and has its TCP fragments rejoined (${old.descs.map((d) => d.slice(260, 300))})`
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- C: one reader for every tool --------------------------------------------------------
{
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const code = (rel: string) =>
    fs
      .readFileSync(path.join(repo, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [rel, readers] of [
    ['scripts/lib/townReplay.ts', ['isMarkedLog(', 'loggedCommand(', 'parserText(']],
    ['scripts/replay-map.ts', ['isMarkedLog(', 'loggedCommand(', 'parserText(']],
    ['scripts/replay-loadout.ts', ['isMarkedLog(', 'loggedCommand(', 'parserText(']],
    ['scripts/gt/lib/extract.ts', ['isMarkedLog(', 'loggedCommand(']],
  ] as const) {
    const src = code(rel);
    for (const r of readers)
      check(src.includes(r), `C: ${rel} reads logs through ${r.slice(0, -1)}`);
    for (const own of ['SENT_PREFIX', 'PAGER_PROMPT', "'>> '", '/^>> ']) {
      check(!src.includes(own), `C: ${rel} parses no log line itself (found ${own})`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — log readers (sent lines, typed input, the pager prompt)');
