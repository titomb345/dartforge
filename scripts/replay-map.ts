/**
 * Replay harness — validates the full automapper pipeline against historical logs.
 *
 * Replays MUD output through the REAL production code path:
 *   RoomParser → HexLocalizer → HexMapStore
 *
 * Modes:
 *   --mush       MUSHclient logs (no command echoes). Movement commands are
 *                synthesized via art-to-art shift inference (the "oracle"):
 *                when consecutive surveys admit exactly one consistent shift,
 *                that direction is fed as a tracked command — simulating a
 *                player whose commands we know.
 *   --dartforge  DartForge session logs ("[ts] " prefixes, ">> cmd" echoes).
 *                Real commands are tracked. Note: these logs fragment lines
 *                at TCP chunk boundaries (logging artifact — the live app
 *                reassembles), so art parse rates here are a lower bound.
 *
 * Usage:
 *   npx tsx scripts/replay-map.ts --mush [--limit N] [--file pattern]
 *       [--out map.json] [--verbose]
 */

import * as fs from 'fs';
import * as path from 'path';
import { RoomParser, type RoomParserEvent } from '../src/lib/roomParser';
import { HexLocalizer, type SurveyResolution } from '../src/lib/hexLocalizer';
import { HexMapStore } from '../src/lib/hexMap';
import type { ParsedHexArt } from '../src/lib/hexArtParser';
import type { Direction } from '../src/lib/hexUtils';
import { getDirectionOffset } from '../src/lib/hexUtils';

const MUSH_DIR = 'C:/Users/titom/Dropbox/MUSH/MUSHclient/logs';
const DF_DIR = 'C:/Users/titom/Dropbox/DM/Dartforge/sessions';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const useMush = args.includes('--mush');
const useDartforge = args.includes('--dartforge');
const verbose = args.includes('--verbose');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const fileIdx = args.indexOf('--file');
const filePattern = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

if (!useMush && !useDartforge) {
  console.error('Specify --mush and/or --dartforge');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Art-to-art shift inference (oracle for command-less logs)
// ---------------------------------------------------------------------------

type Shift = Direction | 'stay';
const ALL_SHIFTS: Shift[] = ['stay', 'n', 'ne', 'se', 's', 'sw', 'nw'];

function shiftOffset(s: Shift): { dq: number; dr: number } {
  if (s === 'stay') return { dq: 0, dr: 0 };
  return getDirectionOffset(s);
}

/** Which shifts are consistent between two consecutive survey patches? */
function consistentShifts(prev: ParsedHexArt, cur: ParsedHexArt, minOverlap = 3): Shift[] {
  const out: Shift[] = [];
  for (const s of ALL_SHIFTS) {
    const o = shiftOffset(s);
    let overlap = 0;
    let ok = true;
    for (const [rel, t] of cur.hexes) {
      if (t === 'unknown') continue;
      const comma = rel.indexOf(',');
      const dq = Number(rel.slice(0, comma));
      const dr = Number(rel.slice(comma + 1));
      const prevT = prev.hexes.get(`${dq + o.dq},${dr + o.dr}`);
      if (!prevT || prevT === 'unknown') continue;
      overlap++;
      if (prevT !== t) {
        ok = false;
        break;
      }
    }
    if (ok && overlap >= minOverlap) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw input expansion (mirrors the live alias engine for replay purposes)
// ---------------------------------------------------------------------------

const SPEEDWALK_LINE = /^(?:\d+(?:n|s|e|w|ne|nw|se|sw|u|d))+$/i;
const SPEEDWALK_SEG = /(\d+)(n|s|e|w|ne|nw|se|sw|u|d)/gi;

function expandRawInput(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (!p) continue;
    if (SPEEDWALK_LINE.test(p)) {
      SPEEDWALK_SEG.lastIndex = 0;
      let m;
      while ((m = SPEEDWALK_SEG.exec(p)) !== null) {
        const count = Math.min(parseInt(m[1], 10), 50);
        for (let i = 0; i < count; i++) out.push(m[2]);
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = {
  files: 0,
  lines: 0,
  gazeLines: 0,
  surveys: 0,
  artParsed: 0,
  artTemplate: 0,
  artSearch: 0,
  artFailed: 0,
  blind: 0,
  moveFails: 0,
  // pair-shift analysis
  pairs: 0,
  pairUnique: 0,
  pairUniqueMove: 0,
  pairAmbiguous: 0,
  pairNone: 0,
  // resolution kinds
  kinds: {} as Record<string, number>,
  conflicts: 0,
  merges: 0,
  cmdTracked: 0,
  correctedEmptyQueue: 0,
  correctedWithQueue: 0,
};

// ---------------------------------------------------------------------------
// Replay engine
// ---------------------------------------------------------------------------

const map = new HexMapStore();
const localizer = new HexLocalizer(map);
let clock = 1_000_000;

let prevArt: ParsedHexArt | null = null;
let pendingOracleDir: Direction | null = null;

const artFailSamples: string[] = [];
const lostSamples: string[] = [];
const correctedSamples: string[] = [];
let curFile = '';
let curLineNo = 0;

function handleEvent(event: RoomParserEvent, oracle: boolean): void {
  if (event.type === 'move-failed') {
    metrics.moveFails++;
    localizer.onMoveFailed(event.hard);
    return;
  }
  if (event.type === 'forced-move') {
    localizer.trackForcedMove(event.dir, clock);
    metrics.cmdTracked++;
    return;
  }
  if (event.type === 'town-room') {
    localizer.onTownRoom(clock);
    return;
  }

  metrics.surveys++;
  if (event.art) {
    metrics.artParsed++;
    if (event.art.source === 'template') metrics.artTemplate++;
    else metrics.artSearch++;
  } else {
    metrics.blind++;
  }

  // Oracle: infer the movement command from consecutive art patches
  if (oracle && event.art) {
    if (prevArt) {
      metrics.pairs++;
      const shifts = consistentShifts(prevArt, event.art);
      if (shifts.length === 1) {
        metrics.pairUnique++;
        if (shifts[0] !== 'stay') {
          metrics.pairUniqueMove++;
          localizer.trackCommand(shifts[0], clock);
          metrics.cmdTracked++;
        }
      } else if (shifts.length > 1) {
        metrics.pairAmbiguous++;
        // Ambiguous — a real player's command would disambiguate. Feed the
        // most plausible move (a non-stay shift) if there is exactly one,
        // mirroring how the live command queue breaks ties.
        const moves = shifts.filter((s) => s !== 'stay');
        if (moves.length === 1) {
          localizer.trackCommand(moves[0], clock);
          metrics.cmdTracked++;
        }
      } else {
        metrics.pairNone++;
      }
    }
    prevArt = event.art;
  }

  const qlenBefore = localizer.pendingMoves.length;
  const res: SurveyResolution = localizer.onSurvey({
    art: event.art,
    description: event.description,
    now: clock,
  });
  if (res.kind === 'corrected') {
    if (qlenBefore === 0) metrics.correctedEmptyQueue++;
    else metrics.correctedWithQueue++;
    if (correctedSamples.length < 15) {
      correctedSamples.push(`${curFile}:${curLineNo} q=${qlenBefore} moved=${res.moved}`);
    }
  }

  metrics.kinds[res.kind] = (metrics.kinds[res.kind] || 0) + 1;
  metrics.conflicts += res.conflicts;
  if (res.merged) metrics.merges++;
  if (res.kind === 'lost' && lostSamples.length < 20) {
    lostSamples.push(`${curFile}:${curLineNo}`);
  }
  if (verbose && (res.kind === 'corrected' || res.kind === 'relocalized' || res.kind === 'new-island')) {
    console.log(`  [${res.kind}] ${curFile}:${curLineNo} → ${res.pos ? `${res.pos.island}:${res.pos.q},${res.pos.r}` : 'lost'}`);
  }
}

function replayFile(filePath: string, dartforge: boolean): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  curFile = path.basename(filePath);

  const parser = new RoomParser((e) => handleEvent(e, !dartforge));
  localizer.reset();
  prevArt = null;
  pendingOracleDir = null;
  void pendingOracleDir;

  for (let i = 0; i < lines.length; i++) {
    curLineNo = i + 1;
    let line = lines[i].replace(/\r$/, '');
    metrics.lines++;
    clock += 100;

    if (dartforge) {
      // Strip "[timestamp] " prefix
      const m = line.match(/^\[[^\]]{5,40}\] (.*)$/);
      if (m) line = m[1];
      // Command echo? Session logs record RAW input, so expand separators
      // and speedwalk ("3n2ne") the way the live alias engine would.
      const cmdMatch = line.match(/^>> (.+)$/);
      if (cmdMatch) {
        for (const cmd of expandRawInput(cmdMatch[1])) {
          if (localizer.trackCommand(cmd, clock)) metrics.cmdTracked++;
        }
        continue;
      }
    }

    if (line.includes('You gaze at your surroundings')) metrics.gazeLines++;
    parser.feedLine(line);
  }

  // Flush any survey still being collected at EOF
  parser.feedLine('');
  parser.feedLine('There are two exits: north, and south.');

  clock += 60_000; // gap between sessions
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function collectFiles(dir: string, ext: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .filter((f) => !filePattern || f.includes(filePattern))
    .sort()
    .map((f) => path.join(dir, f));
}

let files: { path: string; dartforge: boolean }[] = [];
if (useMush) {
  files.push(...collectFiles(MUSH_DIR, '.txt').map((p) => ({ path: p, dartforge: false })));
}
if (useDartforge) {
  files.push(...collectFiles(DF_DIR, '.log').map((p) => ({ path: p, dartforge: true })));
}
if (files.length > limit) files = files.slice(-limit);

console.log(`Replaying ${files.length} log files through the automapper pipeline...\n`);

const t0 = Date.now();
for (const f of files) {
  metrics.files++;
  replayFile(f.path, f.dartforge);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const islands = map.islandSizes();
const cells = [...map.allCells()];
const visited = cells.filter((c) => c.visited).length;
const withLandmarks = cells.filter((c) => c.landmarks.length > 0).length;

console.log(`--- Replay results (${elapsed}s) ---\n`);
console.log(`Files:            ${metrics.files}`);
console.log(`Lines:            ${metrics.lines}`);
console.log(`Gaze lines:       ${metrics.gazeLines}`);
console.log(`Surveys emitted:  ${metrics.surveys}`);
console.log(`  art parsed:     ${metrics.artParsed} (${((metrics.artParsed / Math.max(1, metrics.surveys)) * 100).toFixed(2)}%)`);
console.log(`    via template: ${metrics.artTemplate}, via search: ${metrics.artSearch}`);
console.log(`  blind/no art:   ${metrics.blind}`);
console.log(`Move failures:    ${metrics.moveFails}`);
console.log(`Commands tracked: ${metrics.cmdTracked}`);

if (metrics.pairs > 0) {
  console.log(`\nShift inference over consecutive surveys (${metrics.pairs} pairs):`);
  console.log(`  unique:    ${metrics.pairUnique} (${((metrics.pairUnique / metrics.pairs) * 100).toFixed(1)}%) — ${metrics.pairUniqueMove} moves`);
  console.log(`  ambiguous: ${metrics.pairAmbiguous} (${((metrics.pairAmbiguous / metrics.pairs) * 100).toFixed(1)}%)`);
  console.log(`  none:      ${metrics.pairNone} (${((metrics.pairNone / metrics.pairs) * 100).toFixed(1)}%)`);
}

console.log(`\nResolution kinds:`);
for (const [k, v] of Object.entries(metrics.kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}

console.log(`\nPaint conflicts:  ${metrics.conflicts}`);
console.log(`Island merges:    ${metrics.merges}`);
console.log(`\nMap: ${cells.length} cells, ${visited} visited, ${withLandmarks} with landmarks`);
console.log(`Islands: ${islands.size}`);
const sortedIslands = [...islands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [id, count] of sortedIslands) {
  console.log(`  island ${id}: ${count} cells`);
}
if (islands.size > 10) console.log(`  ... and ${islands.size - 10} more`);

if (metrics.correctedEmptyQueue + metrics.correctedWithQueue > 0) {
  console.log(
    `\nCorrected breakdown: empty-queue=${metrics.correctedEmptyQueue}, with-queue=${metrics.correctedWithQueue}`
  );
  console.log(`Corrected samples:\n  ${correctedSamples.join('\n  ')}`);
}
if (lostSamples.length > 0) {
  console.log(`\nFirst lost-events: ${lostSamples.slice(0, 10).join(', ')}`);
}
if (artFailSamples.length > 0) {
  console.log(`\nArt failures: ${artFailSamples.slice(0, 10).join(', ')}`);
}

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(map.serialize(), null, 1));
  console.log(`\nMap written to ${outFile}`);
}
