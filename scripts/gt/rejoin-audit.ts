/**
 * Safety audit of the TCP-fragment rejoin (scripts/lib/rejoin.ts).
 *
 *   npx tsx scripts/gt/rejoin-audit.ts [--mush-dir D] [--df-dir D] [--all-scope] [--examples N]
 *
 * MUSHclient logs are line-intact (the client buffers whole lines), so the
 * rejoin must leave every room block the real TownParser extracts there
 * exactly as it was: the audit parses each MUSH log with and without the
 * rejoin and diffs the block multisets (name | exits | desc). Any block
 * lost, altered or gained there is a false join.
 *
 * On the DartForge session logs it reports what the rejoin buys: exits
 * lines whose room block was dropped by a logger split (scanName rejects
 * the fragment) and parses again, plus every join for eyeballing.
 *
 * --all-scope audits the rule without the room-prose restriction.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TownParser, type TownRoomBlock } from '../../src/lib/townParser';
import { rejoinFragments } from '../lib/rejoin';
import { listLogs, readSessionLog, resolveDfDir, resolveMushDir } from '../lib/replayCorpus';
import { EXITS_START_RE } from '../lib/serverLines';

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const roomOnly = !args.includes('--all-scope');
const exampleCap = Number(argValue('--examples') ?? 10);
const mushDir = resolveMushDir(argValue('--mush-dir'));
const dfDir = resolveDfDir(argValue('--df-dir'));

/** Block identity as every consumer sees it: whitespace runs are insignificant
 *  (descKey, the volatile-prose sentences and the oracle canon all collapse
 *  them), so a rejoined sentence gap ("it." + "  There") must not count. */
const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const blockKey = (b: TownRoomBlock) =>
  `${b.name}|${b.exits.dirs.join(',')}|${ws(b.exits.raw)}|${ws(b.desc)}`;

/**
 * Parse lines (null = consumed fragment, skipped) like the replay does:
 * logged commands never reach the parsers. Returns the block keys and the
 * indices of exits lines that produced no block.
 */
function parseBlocks(lines: readonly (string | null)[]): {
  keys: string[];
  exits: number;
  lost: number[];
} {
  const keys: string[] = [];
  const lost: number[] = [];
  let exits = 0;
  let pending = -1;
  let gotAtPending = 0;
  const parser = new TownParser((b) => keys.push(blockKey(b)));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === null || l.startsWith('>> ')) continue;
    if (EXITS_START_RE.test(l)) {
      // feedLine would finish a pending wrapped exits sentence first anyway;
      // flushing here attributes that block to ITS exits line
      parser.flushPending();
      if (pending >= 0 && keys.length === gotAtPending) lost.push(pending);
      exits++;
      pending = i;
      gotAtPending = keys.length;
    }
    parser.feedLine(l);
  }
  parser.flushPending();
  if (pending >= 0 && keys.length === gotAtPending) lost.push(pending);
  return { keys, exits, lost };
}

const t0 = Date.now();

// ---------------------------------------------------------------------------
// MUSH: line-intact — the rejoin must not change a single room block
// ---------------------------------------------------------------------------
let mushBlocks = 0;
let mushJoins = 0;
let lostOrAltered = 0;
let gained = 0;
const mushChanges: string[] = [];
const mushFiles = fs.existsSync(mushDir) ? listLogs(mushDir, '.txt') : [];
for (const f of mushFiles) {
  const raw = fs
    .readFileSync(f, 'latin1')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''));
  const before = parseBlocks(raw);
  const res = rejoinFragments(
    raw.map((text) => ({ text, t: null })),
    { roomOnly }
  );
  mushJoins += res.joins.length;
  const after = parseBlocks(res.lines);
  mushBlocks += before.keys.length;
  const diff = new Map<string, number>();
  for (const k of before.keys) diff.set(k, (diff.get(k) ?? 0) + 1);
  for (const k of after.keys) diff.set(k, (diff.get(k) ?? 0) - 1);
  for (const [k, d] of diff) {
    if (d === 0) continue;
    if (d > 0) lostOrAltered += d;
    else gained -= d;
    if (mushChanges.length < exampleCap)
      mushChanges.push(
        `${path.basename(f)} ${d > 0 ? 'LOST/ALTERED' : 'GAINED'} ${k.slice(0, 150)}`
      );
  }
}
console.log(
  `MUSH (${mushFiles.length} files, line-intact): ${mushBlocks} room blocks, ${mushJoins} joins → ` +
    `${lostOrAltered} blocks lost or altered, ${gained} gained`
);
for (const c of mushChanges) console.log(`  ${c}`);

// ---------------------------------------------------------------------------
// DartForge: blocks regained
// ---------------------------------------------------------------------------
let dfExits = 0;
let lostBefore = 0;
let lostAfter = 0;
let dfJoins = 0;
const regained: string[] = [];
const stillLost: string[] = [];
const joinSamples: string[] = [];
const dfFiles = fs.existsSync(dfDir) ? listLogs(dfDir, '.log') : [];
for (const f of dfFiles) {
  const lines = readSessionLog(f);
  const before = parseBlocks(lines.map((l) => l.text));
  const res = rejoinFragments(lines, { roomOnly });
  dfJoins += res.joins.length;
  for (const j of res.joins) {
    if (joinSamples.length < 100000)
      joinSamples.push(`${path.basename(f)}:${j.from + 1} ${JSON.stringify(j.text)}`);
  }
  const after = parseBlocks(res.lines);
  dfExits += before.exits;
  lostBefore += before.lost.length;
  lostAfter += after.lost.length;
  // a joined exits line moves to its tail's index: match within 2 lines
  const afterLost = new Set(after.lost);
  for (const i of before.lost) {
    const label = `${path.basename(f)}:${i + 1}`;
    if ([0, 1, 2].some((d) => afterLost.has(i + d))) stillLost.push(label);
    else regained.push(label);
  }
}
console.log(
  `DartForge (${dfFiles.length} files): ${dfExits} exits lines, ${dfJoins} joins; ` +
    `exits lines with no room block ${lostBefore} → ${lostAfter} (${regained.length} regain their block)`
);
for (const r of regained.slice(0, exampleCap)) console.log(`  regained ${r}`);
for (const r of stillLost.slice(0, exampleCap)) console.log(`  still lost ${r}`);
if (args.includes('--joins')) for (const s of joinSamples) console.log(`  join ${s}`);
console.log(
  `(${((Date.now() - t0) / 1000).toFixed(1)}s, scope: ${roomOnly ? 'room prose' : 'all lines'})`
);
