/**
 * Which room blocks does the REAL TownParser drop on the line-intact MUSH
 * corpus (the live stream format: whole lines, blank lines included)?
 *
 *   npx tsx scripts/gt/lost-blocks.ts [--mush-dir D]
 *
 * The DartForge session logs drop blank lines and split lines at TCP chunk
 * boundaries, so they cannot answer this; replay-town.ts reports its own
 * "lost blocks" for those. To test a parser change, run this in a scratch
 * copy of the repo holding the changed src/lib/townParser.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TownParser } from '../../src/lib/townParser';
import { listLogs, resolveMushDir } from '../lib/replayCorpus';
import { EXITS_START_RE } from '../lib/serverLines';

const args = process.argv.slice(2);
const mi = args.indexOf('--mush-dir');
const dir = resolveMushDir(mi >= 0 ? args[mi + 1] : undefined);

let exitsLines = 0;
let blocks = 0;
const lostBy = new Map<string, number>();
const reason = new Map<string, number>();
const examples = new Map<string, string>();
for (const f of listLogs(dir, '.txt')) {
  const lines = fs
    .readFileSync(f, 'latin1')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''));
  let got = 0;
  const p = new TownParser(() => {
    got++;
    blocks++;
  });
  for (let i = 0; i < lines.length; i++) {
    if (!EXITS_START_RE.test(lines[i])) {
      p.feedLine(lines[i]);
      continue;
    }
    exitsLines++;
    const before = got;
    p.feedLine(lines[i]);
    // a wrapped exits sentence completes on a later line (up to the parser's
    // MAX_EXITS_WRAP of 6, a stray blank line included)
    let j = i;
    while (got === before && j + 1 < lines.length && j - i < 6 && !/\.\s*$/.test(lines[j])) {
      j++;
      p.feedLine(lines[j]);
    }
    i = j;
    if (got > before) continue;
    let name = '?';
    let blank = false;
    for (let k = i - 1; k >= Math.max(0, i - 16); k--) {
      const t = lines[k].replace(/^(?:> )+/, '').trim();
      if (!t) {
        blank = true;
        continue;
      }
      if (t.length < 40 && /^[A-Z]/.test(t) && !/[.!?:]$/.test(t)) {
        name = t;
        break;
      }
    }
    lostBy.set(name, (lostBy.get(name) ?? 0) + 1);
    const r = blank ? 'blank line inside block' : 'other';
    reason.set(r, (reason.get(r) ?? 0) + 1);
    if (!examples.has(name)) examples.set(name, `${path.basename(f)}:${i + 1}`);
  }
  p.flushPending();
}
console.log(`exits lines ${exitsLines}, blocks ${blocks}, lost ${exitsLines - blocks}`);
console.log([...reason.entries()]);
for (const [n, c] of [...lostBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(String(c).padStart(6), n.padEnd(40), examples.get(n));
}
