/**
 * Ground-truth oracle, stage 1: extract every town-room block from both
 * corpora through the REAL TownParser and cache them, so the later stages
 * iterate in seconds.
 *
 *   npx tsx scripts/gt/cache-blocks.ts [--cache DIR] [--df-dir D] [--mush-dir D] [--aliases F]
 *
 * Writes DIR/variants.json — distinct exact variants (name|exits|named|full
 * desc) with sighting counts per corpus, date range, example location — and
 * DIR/seq.json — per-file event streams with blocks replaced by variant
 * indices (MUSH: blocks/logins/surveys/portals; DF additionally the
 * alias-expanded commands, move failures and forced moves).
 * DIR defaults to scripts/gt/.cache (gitignored).
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fileDate, parseLogFile, type LogEvent, type RawBlock } from './lib/extract';
import { listLogs, resolveDfDir, resolveMushDir } from '../lib/replayCorpus';
import { loadAliasSetsOrExit, makeExpander, resolveAliasesFile } from '../lib/replayInput';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const cacheDir = argValue('--cache') ?? path.join(here, '.cache');
const dfDir = resolveDfDir(argValue('--df-dir'));
const mushDir = resolveMushDir(argValue('--mush-dir'));
const aliasesFile = resolveAliasesFile(argValue('--aliases'));
// Global aliases only: the extraction does not track characters, and Bill's
// character aliases (combat/equipment) never change a tracked move — see
// replayInput.makeCharExpander
const expand = makeExpander(loadAliasSetsOrExit(aliasesFile).global);
fs.mkdirSync(cacheDir, { recursive: true });

export interface Variant {
  i: number;
  name: string;
  dirs: string[];
  named: string[];
  namedAll: string[];
  doorDirs: string[];
  desc: string;
  descEngine: string;
  n: number;
  nM: number;
  nD: number;
  first: string;
  last: string;
  files: number;
  ex: string;
}

const variants = new Map<string, Variant & { _lastFile?: string }>();
const vlist: (Variant & { _lastFile?: string })[] = [];
const vkey = (b: RawBlock) => `${b.name}|${b.dirs.join(',')}|${b.named.join(',')}|${b.desc}`;

function add(b: RawBlock, file: string, src: 'M' | 'D'): number {
  const k = vkey(b);
  const date = fileDate(file);
  let v = variants.get(k);
  if (!v) {
    v = {
      i: vlist.length,
      name: b.name,
      dirs: b.dirs,
      named: b.named,
      namedAll: b.namedAll,
      doorDirs: b.doorDirs,
      desc: b.desc,
      descEngine: b.descEngine,
      n: 0,
      nM: 0,
      nD: 0,
      first: date,
      last: date,
      files: 0,
      ex: `${path.basename(file)}:${b.line}`,
    };
    variants.set(k, v);
    vlist.push(v);
  }
  v.n++;
  if (src === 'M') v.nM++;
  else v.nD++;
  if (date < v.first) v.first = date;
  if (date > v.last) v.last = date;
  if (v._lastFile !== file) {
    v.files++;
    v._lastFile = file;
  }
  for (const d of b.doorDirs) if (!v.doorDirs.includes(d)) v.doorDirs = [...v.doorDirs, d].sort();
  for (const d of b.namedAll) if (!v.namedAll.includes(d)) v.namedAll = [...v.namedAll, d].sort();
  return v.i;
}

/** Compact event encoding: blocks become ['b', variantIdx, t, line]. */
type Packed = (string | number | boolean | null | string[])[];
function pack(e: LogEvent, file: string, src: 'M' | 'D'): Packed {
  switch (e.k) {
    case 'block':
      return ['b', add(e.b, file, src), e.t, e.line];
    case 'cmd':
      return ['c', e.raw, e.cmds, e.t, e.line];
    case 'survey':
      return ['s', e.t, e.line];
    case 'portal':
      return ['p', e.dir, e.t, e.line];
    case 'movefail':
      return ['f', e.hard, e.t, e.line, e.text];
    case 'forced':
      return ['F', e.dir, e.t, e.line];
    case 'login':
      return ['L', e.t, e.line];
    case 'logout':
      return ['O', e.t, e.line];
  }
}

const t0 = Date.now();
const seq: { file: string; src: 'M' | 'D'; ev: Packed[] }[] = [];
let mushBlocks = 0;
for (const f of listLogs(mushDir, '.txt')) {
  // MUSH logs carry no usable commands — keep the rest
  const packed: Packed[] = [];
  for (const e of parseLogFile(f, false)) {
    if (e.k === 'block') mushBlocks++;
    packed.push(pack(e, f, 'M'));
  }
  seq.push({ file: path.basename(f), src: 'M', ev: packed });
}
console.log(
  `MUSH ${mushDir}: ${seq.length} files, ${mushBlocks} blocks (${((Date.now() - t0) / 1000).toFixed(1)}s)`
);

let dfBlocks = 0;
let dfFiles = 0;
for (const f of listLogs(dfDir, '.log')) {
  dfFiles++;
  const packed: Packed[] = [];
  for (const e of parseLogFile(f, true, expand)) {
    if (e.k === 'block') dfBlocks++;
    packed.push(pack(e, f, 'D'));
  }
  seq.push({ file: path.basename(f), src: 'D', ev: packed });
}
console.log(
  `DF ${dfDir}: ${dfFiles} files, ${dfBlocks} blocks (${((Date.now() - t0) / 1000).toFixed(1)}s)`
);
console.log(`Distinct exact variants: ${vlist.length}`);

for (const v of vlist) delete v._lastFile;
fs.writeFileSync(path.join(cacheDir, 'variants.json'), JSON.stringify(vlist));
fs.writeFileSync(path.join(cacheDir, 'seq.json'), JSON.stringify(seq));
fs.writeFileSync(
  path.join(cacheDir, 'corpus.json'),
  JSON.stringify({
    built: new Date().toISOString(),
    dfDir,
    mushDir,
    aliasesFile,
    dfFiles,
    dfBlocks,
    mushBlocks,
  })
);
console.log(`Wrote ${cacheDir}`);
