/**
 * Town replay harness — validates the town mapper pipeline against
 * historical logs, through the REAL production code path:
 *
 *   TownParser → TownLocalizer → TownMapStore
 *
 * The hex pipeline (RoomParser → HexLocalizer → HexMapStore) runs alongside,
 * exactly as the live app wires it, so town anchors come from real hex
 * positions and indoors/wilderness transitions are authentic.
 *
 * Modes:
 *   --mush       MUSHclient logs (no command echoes) — validates the PARSER
 *                (block extraction rate) only; the localizer needs commands.
 *   --dartforge  DartForge session logs (">> cmd" echoes) — full engine
 *                validation. Note: these logs fragment lines at TCP chunk
 *                boundaries (logging artifact), so rates are a lower bound.
 *
 * Usage:
 *   npx tsx scripts/replay-town.ts --dartforge [--limit N] [--file pattern]
 *       [--out towns.json] [--verbose]
 */

import * as fs from 'fs';
import * as path from 'path';
import { RoomParser } from '../src/lib/roomParser';
import { HexLocalizer } from '../src/lib/hexLocalizer';
import { HexMapStore } from '../src/lib/hexMap';
import { TownParser, PORTAL_TRANSIT_RE } from '../src/lib/townParser';
import { TownLocalizer } from '../src/lib/townLocalizer';
import { TownMapStore } from '../src/lib/townMap';
import { hexAnchorKey } from '../src/lib/townMap';

const MUSH_DIR = 'C:/Users/titom/Dropbox/MUSH/MUSHclient/logs';
const DF_DIR = 'C:/Users/titom/Dropbox/DM/Dartforge/sessions';

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
const traceIdx = args.indexOf('--trace');
const traceName = traceIdx >= 0 ? args[traceIdx + 1] : undefined;

if (!useMush && !useDartforge) {
  console.error('Specify --mush and/or --dartforge');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Raw input expansion (mirrors the live alias engine — same as replay-map.ts)
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
  exitsLines: 0,
  blocks: 0,
  kinds: {} as Record<string, number>,
  cmdTracked: 0,
  moveFails: 0,
  merges: 0,
  portals: 0,
};

const lostSamples: string[] = [];
const correctedSamples: string[] = [];
let curFile = '';
let curLineNo = 0;

// ---------------------------------------------------------------------------
// Replay engine — mirrors the live useMapTracker wiring
// ---------------------------------------------------------------------------

const hexMap = new HexMapStore();
const hexLocalizer = new HexLocalizer(hexMap);
const townMap = new TownMapStore();
const townLocalizer = new TownLocalizer(townMap);
let clock = 1_000_000;

function currentAnchor(): string | null {
  const pos = hexMap.pos;
  if (!pos || hexLocalizer.lost) return null;
  return hexAnchorKey(pos.island, pos.q, pos.r);
}

function replayFile(filePath: string, dartforge: boolean): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  curFile = path.basename(filePath);

  const townParser = new TownParser((block) => {
    metrics.blocks++;
    const before = townMap.room(townMap.pos);
    const res = townLocalizer.onRoomBlock(block, currentAnchor(), clock);
    metrics.kinds[res.kind] = (metrics.kinds[res.kind] || 0) + 1;
    if (res.merged) metrics.merges++;
    if (
      traceName &&
      block.name === traceName &&
      (res.kind === 'new-room' || res.kind === 'jumped')
    ) {
      const town = res.pos ? townMap.get(res.pos.townId) : null;
      const room = townMap.room(res.pos);
      console.log(
        `  [CREATE:${res.kind}] ${curFile}:${curLineNo} town=${town?.id}"${town?.name}" ` +
          `at(${room?.x},${room?.y},${room?.z}) from="${before?.name}"(${before?.x},${before?.y},${before?.z}) ` +
          `move=${res.moved ? JSON.stringify(res.moved) : 'none'} exits=[${block.exits.dirs.join(',')}]`
      );
    }
    if (res.kind === 'lost' && lostSamples.length < 20) {
      lostSamples.push(`${curFile}:${curLineNo} "${block.name}" [${block.exits.dirs.join(',')}]`);
    }
    if (res.kind === 'corrected' && correctedSamples.length < 15) {
      correctedSamples.push(`${curFile}:${curLineNo} → "${block.name}"`);
    }
    if (verbose && (res.kind === 'lost' || res.kind === 'corrected')) {
      console.log(`  [${res.kind}] ${curFile}:${curLineNo} "${block.name}"`);
    }
  });

  const hexParser = new RoomParser((event) => {
    // Live wiring: hex events drive the hex localizer; wilderness surveys
    // deactivate the town engine; move failures indoors pop the town queue.
    switch (event.type) {
      case 'survey':
        townLocalizer.onWilderness();
        hexLocalizer.onSurvey({ art: event.art, description: event.description, now: clock });
        townLocalizer.noteOutdoorPosition(currentAnchor());
        break;
      case 'move-failed':
        metrics.moveFails++;
        if (townLocalizer.active) townLocalizer.onMoveFailed();
        else hexLocalizer.onMoveFailed(event.hard);
        break;
      case 'forced-move':
        hexLocalizer.trackForcedMove(event.dir, clock);
        break;
      case 'town-room':
        hexLocalizer.onTownRoom(clock);
        break;
    }
  });

  hexLocalizer.reset();
  townLocalizer.reset();

  for (let i = 0; i < lines.length; i++) {
    curLineNo = i + 1;
    let line = lines[i].replace(/\r$/, '');
    metrics.lines++;
    clock += 100;

    if (dartforge) {
      const m = line.match(/^\[[^\]]{5,40}\] (.*)$/);
      if (m) line = m[1];
      const cmdMatch = line.match(/^>> (.+)$/);
      if (cmdMatch) {
        for (const cmd of expandRawInput(cmdMatch[1])) {
          // Live wiring: every send goes to both localizers; each gates itself
          if (townLocalizer.trackCommand(cmd, clock)) metrics.cmdTracked++;
          else if (hexLocalizer.trackCommand(cmd, clock)) metrics.cmdTracked++;
        }
        continue;
      }
    }

    if (/There (?:is one obvious exit|are \w+ exits):/.test(line)) metrics.exitsLines++;
    if (PORTAL_TRANSIT_RE.test(line)) {
      metrics.portals++;
      townLocalizer.onPortalTransit();
    }
    hexParser.feedLine(line);
    townParser.feedLine(line);
  }

  townParser.flushPending();
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

console.log(`Replaying ${files.length} log files through the town mapper pipeline...\n`);

const t0 = Date.now();
for (const f of files) {
  metrics.files++;
  replayFile(f.path, f.dartforge);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`--- Town replay results (${elapsed}s) ---\n`);
console.log(`Files:            ${metrics.files}`);
console.log(`Lines:            ${metrics.lines}`);
console.log(`Exits lines:      ${metrics.exitsLines}`);
console.log(
  `Blocks parsed:    ${metrics.blocks} (${((metrics.blocks / Math.max(1, metrics.exitsLines)) * 100).toFixed(2)}% of exits lines)`
);
console.log(`Commands tracked: ${metrics.cmdTracked}`);
console.log(`Move failures:    ${metrics.moveFails}`);

console.log(`\nResolution kinds:`);
const totalRes = Object.values(metrics.kinds).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(metrics.kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v} (${((v / Math.max(1, totalRes)) * 100).toFixed(1)}%)`);
}
console.log(`\nLink misses (known link, wrong room): ${townLocalizer.linkMisses}`);
console.log(`Link heals (stale links re-pointed): ${townLocalizer.linkHeals}`);
console.log(`Placement nudges: ${townMap.nudges}`);
console.log(`Placement stretches: ${townMap.stretches}`);
console.log(`Town merges: ${metrics.merges}`);
console.log(`Portal transits: ${metrics.portals}`);

// Layout quality: how faithfully does the drawn grid reflect the graph?
// A cardinal link is "exact" when its rooms sit one cell apart along that
// axis; "long" when collinear but stretched (truthful long street); the
// rest are off-axis (drawn dashed — non-Euclidean or scarred layout).
{
  let exact = 0;
  let long = 0;
  let offAxis = 0;
  const CARD: Record<string, [number, number, number]> = {
    n: [0, -1, 0],
    s: [0, 1, 0],
    e: [1, 0, 0],
    w: [-1, 0, 0],
    u: [0, 0, 1],
    d: [0, 0, -1],
  };
  for (const town of townMap.towns.values()) {
    for (const room of town.rooms.values()) {
      for (const [dir, destId] of Object.entries(room.links)) {
        const vec = CARD[dir];
        if (!vec) continue;
        const dest = town.rooms.get(destId as number);
        if (!dest) continue;
        const dx = dest.x - room.x;
        const dy = dest.y - room.y;
        const dz = dest.z - room.z;
        if (dx === vec[0] && dy === vec[1] && dz === vec[2]) exact++;
        else {
          const along = dx * vec[0] + dy * vec[1] + dz * vec[2];
          if (along > 1 && dx === along * vec[0] && dy === along * vec[1] && dz === along * vec[2])
            long++;
          else offAxis++;
        }
      }
    }
  }
  const total = Math.max(1, exact + long + offAxis);
  console.log(
    `\nLayout quality (cardinal links): ${exact} exact (${((exact / total) * 100).toFixed(1)}%), ` +
      `${long} long-street, ${offAxis} off-axis`
  );
}

console.log(`\nTowns mapped: ${townMap.towns.size}`);
const townsBySize = [...townMap.towns.values()].sort((a, b) => b.rooms.size - a.rooms.size);
for (const town of townsBySize.slice(0, 15)) {
  const floors = townMap.floorsOf(town);
  console.log(
    `  [${town.id}] "${town.name}" — ${town.rooms.size} rooms, floors ${floors[0]}..${floors[floors.length - 1]}, anchors: ${Object.keys(town.anchors).length}`
  );
}
if (townsBySize.length > 15) console.log(`  ... and ${townsBySize.length - 15} more`);

// Duplicate-room diagnostic: same strict fingerprint appearing many times
// in one town suggests the localizer is duplicating instead of reusing.
let dupGroups = 0;
for (const town of townMap.towns.values()) {
  const seen = new Map<string, number>();
  for (const r of town.rooms.values()) {
    const key = `${r.name}|${r.exits.join(',')}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const count of seen.values()) {
    if (count >= 3) dupGroups++;
  }
}
console.log(`\nFingerprints appearing 3+ times within one town: ${dupGroups}`);

if (correctedSamples.length > 0) {
  console.log(`\nCorrected samples:\n  ${correctedSamples.join('\n  ')}`);
}
if (lostSamples.length > 0) {
  console.log(`\nLost samples:\n  ${lostSamples.join('\n  ')}`);
}

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(townMap.serialize(), null, 1));
  console.log(`\nTown maps written to ${outFile}`);
}
