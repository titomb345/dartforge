/**
 * One compact block per replay mode for scripts/town-validate.sh.
 *
 *   npx tsx scripts/gt/validate-summary.ts <label> <replay.json> <check.txt> [tests.txt]
 *
 * <replay.json> is replay-town.ts --json output, <check.txt> the
 * check-towns.ts report (its GT-SUMMARY line is copied verbatim),
 * [tests.txt] the test-town.ts output. The first line names the inputs the
 * run actually used (corpus, alias counts, oracle) — a run on the wrong
 * inputs looks like a normal run otherwise.
 */
import * as fs from 'fs';

const [label, replayJson, checkTxt, testsTxt] = process.argv.slice(2);
if (!label || !replayJson || !checkTxt) {
  console.error('usage: validate-summary.ts <label> <replay.json> <check.txt> [tests.txt]');
  process.exit(1);
}

interface ReplayJson {
  config: {
    perChar: boolean;
    dfDir: string;
    dfLogs: number;
    aliasesFile: string | null;
    aliases: Record<string, number> | null;
    oracleFile: string | null;
  };
  stats: Record<string, number>;
  kinds: Record<string, number>;
  totals: { linkMisses: number; linkHeals: number; nudges: number; stretches: number };
  quality: Record<string, number>;
  characters: Record<string, { quality: { totalRooms: number } }>;
  metrics: { descDisagree: Record<string, number>; suspectDupCreations: number };
  skippedNested: string[];
  oracle: { wrong: number; checked: number; glueEvents: number; unclassified: number } | null;
}
const r = JSON.parse(fs.readFileSync(replayJson, 'utf8')) as ReplayJson;
const lastLine = (file: string, re: RegExp) =>
  fs.existsSync(file)
    ? (fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => re.test(l))
        .pop() ?? '(missing)')
    : '(missing)';

const n = (x: number | undefined) => (x ?? 0).toLocaleString('en-US');
const k = r.kinds;
const total = Object.values(k).reduce((a, b) => a + b, 0);
const pct = (x: number, d: number) => ((x / Math.max(1, d)) * 100).toFixed(1);
const q = r.quality;
const s = r.stats;
const c = r.config;
const chars = !c.perChar
  ? 'single store'
  : Object.entries(r.characters)
      .sort((a, b) => b[1].quality.totalRooms - a[1].quality.totalRooms)
      .map(([ch, v]) => `${ch} ${v.quality.totalRooms}`)
      .join(', ');
const aliases = c.aliases
  ? Object.entries(c.aliases)
      .map(([set, count]) => (set === 'global' ? `${count} global` : `${set} ${count}`))
      .join(', ')
  : 'legacy expansion';
const disagree = Object.values(r.metrics.descDisagree).reduce((a, b) => a + b, 0);

const out = [
  `== ${label} ==`,
  `inputs   corpus ${c.dfDir} (${c.dfLogs} logs)  aliases ${c.aliasesFile ?? '-'} (${aliases})  ` +
    `oracle ${c.oracleFile ?? '-'}`,
  `replay   expected ${n(k.expected)} (${pct(k.expected ?? 0, total)}%)  entered ${n(k.entered)}  ` +
    `stationary ${n(k.stationary)}  new-room ${n(k['new-room'])}  corrected ${n(k.corrected)}  ` +
    `relocalized ${n(k.relocalized)}  jumped ${n(k.jumped)}  lost ${n(k.lost)}`,
  `         link misses ${r.totals.linkMisses}  heals ${r.totals.linkHeals}  merges ${s.merges}  ` +
    `lost blocks ${s.lostBlocks}  rejoined ${s.rejoins}  switches ${s.switches}${s.lateSwitches ? ` (${s.lateSwitches} late)` : ''}  ` +
    `files ${s.files}${r.skippedNested.length ? ` (+${r.skippedNested.length} nested skipped)` : ''}`,
  `map      rooms ${q.totalRooms} (${chars})  excess dups ${q.dupExcess}  asym ${q.asymmetricLinks}  ` +
    `off-axis ${q.layoutOffAxis}  isolated ${q.isolatedRooms}  suspect dup creations ${r.metrics.suspectDupCreations}`,
  `truth    ` +
    (r.oracle
      ? `wrong-room ${r.oracle.wrong} of ${n(r.oracle.checked)} (${((r.oracle.wrong / Math.max(1, r.oracle.checked)) * 100).toFixed(2)}%)  glue events ${r.oracle.glueEvents}  `
      : '(no --oracle)  ') +
    `desc-disagree proxy ${disagree}`,
  lastLine(checkTxt, /^GT-SUMMARY /),
  // Where the rooms sit: a broken grid (two rooms on one cell) leaves every
  // count above unchanged, so the grid audit prints here too
  `layout   cardinal links ${q.layoutExact} exact ` +
    `(${pct(q.layoutExact, q.layoutExact + q.layoutLong + q.layoutOffAxis)}%) / ` +
    `${q.layoutLong} long / ${q.layoutOffAxis} off-axis   stretches ${r.totals.stretches}  ` +
    `nudges ${r.totals.nudges}  shared cells ${q.sharedCells ?? '-'}  grid errors ${q.gridErrors ?? '-'}`,
];
if (testsTxt) out.push(`tests    ${lastLine(testsTxt, /town regression tests passed/)}`);
console.log(out.join('\n'));
