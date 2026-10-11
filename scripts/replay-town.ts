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
 *                validation.
 *
 * Live fidelity (DartForge mode; scripts/lib/townReplay.ts has the details):
 *  - log timestamps drive the clock; each session log is one app run (the
 *    stores round-trip serialize → deserialize between files);
 *  - raw input goes through the REAL alias engine + /door built-in, with
 *    the active character's aliases ahead of the global ones like live
 *    (--legacy-expand: the old regex-only expansion); a missing or
 *    unreadable aliases file ends the run (exit 2) instead of silently
 *    replaying without aliases;
 *  - PER-CHARACTER stores, swapped at each login like map-<char>.json
 *    (--single-store: the old one-store-for-everyone replay, which glued
 *    Trilok's Soriktos into Mazorn's Eris);
 *  - TCP fragments rejoined (--no-rejoin to replay the raw log lines);
 *  - session files whose whole time span lies inside an earlier file's are
 *    a second, concurrent app instance and are skipped (--keep-nested);
 *  - --switch-late models the login race of the app before the Oct 2026
 *    login hold (typed-name logins resolved the login burst's first room
 *    in the PREVIOUS character's map); the default mode is today's app.
 * Known gaps the logs cannot close — in logs written before the Oct 2026
 * logger (every log of the frozen corpus): the session logger dropped blank
 * lines and logged only TYPED input (walk-executor, trigger, timer and
 * login-sync sends were tracked live but never logged: ~500 room changes
 * resolve with an empty queue), so logged input is expanded with the
 * CURRENT aliases.json (alias drift: `ep` changed mid-session on 07-01). A
 * newer log records every command as sent and whole lines, blank ones too,
 * and replays as it stands (scripts/lib/townReplay.ts).
 *
 * Quality metrics beyond resolution kinds ("expected" alone happily counts
 * a wrong-room snap as success):
 *  - desc disagreements on assignment (PROXY): the block's description vs
 *    the room it was assigned to (as last seen), after stripping lighting,
 *    ambient weather/portal-fire prose and the store's learned volatile
 *    sentences — still mostly day/night prose; --oracle gives the truth
 *  - ORACLE wrong-room assignments (--oracle <oracle.json>, built by
 *    scripts/gt/run-gt.sh build): true identity changes, a lower bound —
 *    see scripts/gt/lib/oracleTrace.ts
 *  - suspect duplicate creations: a new/floating room whose name, exits
 *    and description already exist in the same town
 *  - lost blocks: exits lines that produced no room block
 *  - end-state duplicate groups, link-graph components, contradicted and
 *    asymmetric links, layout quality — per character and summed
 *
 * Usage:
 *   npx tsx scripts/replay-town.ts --dartforge [--df-dir D] [--aliases F] [--mush-dir D]
 *       [--single-store] [--switch-late] [--no-rejoin] [--keep-nested]
 *       [--oracle oracle.json [--dump-wrong wrong.jsonl]]
 *       [--out towns.json] [--json metrics.json] [--limit N] [--file pattern]
 *       [--since YYYY-MM-DD] [--trace "<Room Name>"] [--trace-newtowns]
 *       [--tag-origins] [--samples N] [--verbose] [--legacy-expand]
 *       [--no-restart] [--snapshot-before <file pattern> --snapshot-out <path>]
 *   Corpus dirs fall back to DF_SESSIONS / MUSH_LOGS / DF_ALIASES, then
 *   Bill's live Dropbox (which drifts — measurements pin a frozen copy).
 *   --out writes one store per character (towns-<char>.json, like the live
 *   map-<char>.json townData; --single-store: towns.json); --json has a
 *   section per character. --snapshot-out writes the live character's map
 *   file plus every other character's stores (replay-town-file.ts --load
 *   resumes from it). The last line, REPLAY-SUMMARY, is the one-line A/B
 *   summary; scripts/town-validate.sh runs the whole gate.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  TownMapStore,
  descKey,
  descUsable,
  linkContradicted,
  type TownRoom,
} from '../src/lib/townMap';
import {
  describeAliasSets,
  legacyExpandInput,
  loadAliasSetsOrExit,
  makeCharExpander,
  resolveAliasesFile,
} from './lib/replayInput';
import {
  fileSpan,
  listLogs,
  nestedFiles,
  readSessionLog,
  resolveDfDir,
  resolveMushDir,
} from './lib/replayCorpus';
import { TownReplay, gridAudit, mergeCopyIds, type BlockEvent } from './lib/townReplay';
import { OracleIndex, loadOracle } from './gt/lib/oracle';
import { OracleTrace } from './gt/lib/oracleTrace';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const argValue = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const useMush = has('--mush');
const useDartforge = has('--dartforge');
const verbose = has('--verbose');
const legacyExpand = has('--legacy-expand');
const perChar = !has('--single-store');
const switchLate = has('--switch-late');
const rejoin = !has('--no-rejoin');
const keepNested = has('--keep-nested');
const restart = !has('--no-restart');
const limit = argValue('--limit') ? parseInt(argValue('--limit')!, 10) : Infinity;
const filePattern = argValue('--file');
const since = argValue('--since');
const outFile = argValue('--out');
const jsonFile = argValue('--json');
const traceName = argValue('--trace');
const traceNewTowns = has('--trace-newtowns');
const tagOrigins = has('--tag-origins');
const sampleCap = argValue('--samples') ? parseInt(argValue('--samples')!, 10) : 15;
const snapshotBefore = argValue('--snapshot-before');
const snapshotOut = argValue('--snapshot-out');
const oracleFile = argValue('--oracle');
const dumpWrong = argValue('--dump-wrong');
const dfDir = resolveDfDir(argValue('--df-dir'));
const mushDir = resolveMushDir(argValue('--mush-dir'));
const aliasesFile = resolveAliasesFile(argValue('--aliases'));

if (!useMush && !useDartforge) {
  console.error('Specify --mush and/or --dartforge');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Raw input expansion (mirrors the live send path — see scripts/lib/replayInput.ts)
// ---------------------------------------------------------------------------

const aliasSets = useDartforge && !legacyExpand ? loadAliasSetsOrExit(aliasesFile) : null;
const expandRawInput = aliasSets ? makeCharExpander(aliasSets) : legacyExpandInput;
const aliasCounts = aliasSets
  ? {
      global: aliasSets.global.length,
      ...Object.fromEntries(Object.entries(aliasSets.byChar).map(([c, l]) => [c, l.length])),
    }
  : null;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = {
  /** Assignments whose block desc disagrees with the room's last-seen desc */
  descDisagree: {} as Record<string, number>,
  /** Assignments where both descs were comparable */
  descCompared: 0,
  /** new-room/jumped creations duplicating an existing room's name+exits+desc */
  suspectDupCreations: 0,
  /** First room block after a login: resolution / name vs the previous room */
  loginFirst: {} as Record<string, number>,
};

interface Sample {
  file: string;
  line: number;
  text: string;
}
const samples: Record<string, Sample[]> = {};
function sample(kind: string, text: string, line = engine.line): void {
  const list = (samples[kind] ??= []);
  if (list.length < sampleCap) list.push({ file: engine.file, line, text });
}

/** Per-file breakdown (which sessions contribute the trouble) */
interface FileStats {
  blocks: number;
  jumped: number;
  newRoom: number;
  linkMisses: number;
  descDisagree: number;
  lostBlocks: number;
}
const perFile: Record<string, FileStats> = {};
let curStats: FileStats = {
  blocks: 0,
  jumped: 0,
  newRoom: 0,
  linkMisses: 0,
  descDisagree: 0,
  lostBlocks: 0,
};

// ---------------------------------------------------------------------------
// Description comparison (the wrong-room PROXY)
// ---------------------------------------------------------------------------

/**
 * Ambient prose that comes and goes on the SAME room and that the store can
 * never learn as volatile (it is appended/omitted, never swapped): the
 * weather line and the temple portal-fire sentence — the latter alone was
 * 852 of the legacy baseline's 1,616 "disagreements".
 */
const AMBIENT_RE =
  /\b(?:The air is quite (?:warm|humid|chilly|dry|cold|hot|cool|mild)\.|A sheet of silvery-white fire (?:fills|suddenly appears in) the (?:[a-z]+ )?portals?(?: and the [a-z]+ portal)?\.)/g;

/** descKey minus ambient prose and the store's learned volatile sentences */
function canon(text: string, store: TownMapStore): string {
  const kept = text
    .replace(/\s+/g, ' ')
    .replace(AMBIENT_RE, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !store.volatileSentences.has(s.trim()));
  return descKey(kept.join(' '));
}

function descsAgree(a: string, b: string, store: TownMapStore): boolean {
  const ka = canon(a, store);
  const kb = canon(b, store);
  return ka === kb || ka.endsWith(kb) || kb.endsWith(ka);
}

/**
 * Desc each room carried BEFORE the current block touched it — touchRoom
 * overwrites room.desc, so the comparison needs this shadow. Keyed by the
 * room object: merges/deserialize create new objects, which simply start
 * a fresh history.
 */
let lastDesc = new WeakMap<TownRoom, string>();

// ---------------------------------------------------------------------------
// Replay engine (scripts/lib/townReplay.ts) + per-block metrics
// ---------------------------------------------------------------------------

const oracle = oracleFile ? new OracleTrace(new OracleIndex(loadOracle(oracleFile))) : null;
const lostBlockText: string[] = [];

const engine: TownReplay = new TownReplay(
  { expand: expandRawInput, perChar, switchLate, rejoin, restart },
  {
    beforeBlock(block) {
      if (!traceNewTowns) return;
      entryCandidates = [];
      for (const t of engine.townMap.towns.values()) {
        for (const r of t.rooms.values()) {
          if (engine.townMap.matchesEntry(r, block)) entryCandidates.push(`t${t.id}#${r.id}`);
        }
      }
    },
    onBlock: onResolved,
    onLostBlock(line, text, context) {
      curStats.lostBlocks++;
      lostBlockText.push(`${engine.file}:${line}`);
      sample(
        'lost-block',
        `${context.map((l) => JSON.stringify(l.slice(0, 40))).join(' / ')} → ${text.slice(0, 50)}`,
        line
      );
    },
    onStoresChanged() {
      lastDesc = new WeakMap();
      for (const town of engine.townMap.towns.values()) {
        for (const r of town.rooms.values()) lastDesc.set(r, r.desc);
      }
    },
  }
);
let entryCandidates: string[] = [];

function onResolved(ev: BlockEvent): void {
  const { block, res, before } = ev;
  const map = engine.townMap;
  const char = engine.char ?? 'unknown';
  curStats.blocks++;
  if (res.kind === 'jumped') curStats.jumped++;
  if (res.kind === 'new-room') curStats.newRoom++;
  oracle?.observe(char, block, res, before, engine.file, engine.line);
  if (ev.afterLogin) {
    const k = `${res.kind}/${before && before.name === block.name ? 'same-name' : 'other-name'}`;
    metrics.loginFirst[k] = (metrics.loginFirst[k] ?? 0) + 1;
    if (traceNewTowns) {
      console.log(
        `  [LOGIN-FIRST] ${engine.file}:${engine.line} ${char} "${block.name}" -> ${res.kind} ` +
          `prev="${before?.name ?? '-'}" wasActive=${ev.wasActive}`
      );
    }
  }
  if (tagOrigins) tagProvenance(ev);
  if (traceNewTowns) traceTownEvents(ev);

  const town = res.pos ? map.get(res.pos.townId) : undefined;
  const room = map.room(res.pos);
  if (res.kind === 'lost') sample('lost', `"${block.name}" [${block.exits.dirs.join(',')}]`);
  if (res.kind === 'jumped') {
    sample('jumped', `"${block.name}" [${block.exits.dirs.join(',')}] from="${before?.name}"`);
  }
  if (res.kind === 'corrected') sample('corrected', `→ "${block.name}" from="${before?.name}"`);
  if (verbose && (res.kind === 'lost' || res.kind === 'corrected' || res.kind === 'jumped')) {
    console.log(`  [${res.kind}] ${engine.file}:${engine.line} "${block.name}"`);
  }
  if (traceName && block.name === traceName && (res.kind === 'new-room' || res.kind === 'jumped')) {
    console.log(
      `  [CREATE:${res.kind}] ${engine.file}:${engine.line} ${char} town=${town?.id}"${town?.name}" ` +
        `at(${room?.x},${room?.y},${room?.z}) from="${before?.name}"(${before?.x},${before?.y},${before?.z}) ` +
        `move=${res.moved ? JSON.stringify(res.moved) : 'none'} exits=[${block.exits.dirs.join(',')}]`
    );
  }
  if (!room || !town) return;

  const created = res.kind === 'new-room' || res.kind === 'jumped' || !lastDesc.has(room);
  if (!created) {
    const prev = lastDesc.get(room)!;
    if (descUsable(prev) && descUsable(block.desc)) {
      metrics.descCompared++;
      if (!descsAgree(prev, block.desc, map)) {
        metrics.descDisagree[res.kind] = (metrics.descDisagree[res.kind] || 0) + 1;
        curStats.descDisagree++;
        sample(
          `desc-disagree:${res.kind}`,
          `"${block.name}" #${room.id} town=${town.id} from="${before?.name}"#${before?.id} ` +
            `move=${res.moved ? JSON.stringify(res.moved) : '-'}\n        was: ${canon(prev, map).slice(-110)}\n        now: ${canon(block.desc, map).slice(-110)}`
        );
      }
    }
  }
  if (res.kind === 'new-room' || res.kind === 'jumped') {
    const exits = room.exits.join(',');
    const twin = [...town.rooms.values()].find(
      (r) =>
        r !== room &&
        r.name === room.name &&
        r.exits.join(',') === exits &&
        descUsable(r.desc) &&
        descUsable(block.desc) &&
        descsAgree(r.desc, block.desc, map)
    );
    if (twin) {
      metrics.suspectDupCreations++;
      sample(
        `dup-creation:${res.kind}`,
        `"${block.name}" new #${room.id} at(${room.x},${room.y},${room.z}) duplicates #${twin.id} ` +
          `at(${twin.x},${twin.y},${twin.z}) town=${town.id} from="${before?.name}"#${before?.id} ` +
          `move=${res.moved ? JSON.stringify(res.moved) : '-'}`
      );
    }
  }
  lastDesc.set(room, room.desc);
}

/**
 * --tag-origins: creation provenance stamped on the rooms (__origin =
 * resolution kind + file:line; __merged on merge copies). The tags ride
 * along serialize/deserialize and --out, and scripts/gt/check-towns.ts
 * attributes every surplus duplicate to how it was made.
 */
type TaggedRoom = TownRoom & { __origin?: string; __merged?: string };
function tagProvenance(ev: BlockEvent): void {
  const map = engine.townMap;
  const here = map.room(ev.res.pos) as TaggedRoom | undefined;
  if (here && !here.__origin) here.__origin = `${ev.res.kind}@${engine.file}:${engine.line}`;
  const merged = ev.res.merged;
  if (merged) {
    const into = map.get(merged.into);
    for (const id of mergeCopyIds(map, merged)) {
      const r = into?.rooms.get(id) as TaggedRoom | undefined;
      if (r) r.__merged = `t${merged.from}->t${merged.into}@${engine.file}:${engine.line}`;
    }
  }
}

/** --trace-newtowns: every town creation (why) and structural merge (how big) */
function traceTownEvents(ev: BlockEvent): void {
  const map = engine.townMap;
  const char = engine.char ?? 'unknown';
  const { block, res, before } = ev;
  if (res.merged) {
    const m = res.merged;
    const fromN = ev.sizeBefore.get(m.from) ?? 0;
    const intoBefore = ev.sizeBefore.get(m.into) ?? 0;
    const here = map.room(map.pos);
    // Only the matched link component moves (the rest of the town stays);
    // a same-town merge re-places a duplicate component instead of copying
    const into = m.from === m.into ? 'itself' : `town ${m.into} (${intoBefore} rooms)`;
    console.log(
      `  [MERGE] ${engine.file}:${engine.line} ${char} town ${m.from} (${fromN} rooms) -> ` +
        `${into}: moved ${m.moved}, ${m.fused} fused, ${m.placed} ` +
        `${m.from === m.into ? 're-placed' : 'copied'}; at "${block.name}" now #${here?.id}` +
        `@(${here?.x},${here?.y},${here?.z}) kind=${res.kind}`
    );
  }
  for (const id of map.towns.keys()) {
    if (ev.townsBefore.has(id)) continue;
    const bc = oracle?.classOfBlock(block);
    const place = bc && bc.place >= 0 ? oracle!.index.oracle.places[bc.place].label : bc?.place;
    console.log(
      `  [NEWTOWN] ${engine.file}:${engine.line} ${char} town ${id} "${block.name}" [${block.exits.dirs}] ` +
        `class=${bc ? `c${bc.id}/${place}` : '?'} wasActive=${ev.wasActive} ` +
        `prevPos="${before?.name ?? '-'}"#${before?.id ?? '-'} entryMatches=${entryCandidates.length} ` +
        `[${entryCandidates.slice(0, 6).join(' ')}] kind=${res.kind}`
    );
  }
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function collectFiles(dir: string, ext: string): string[] {
  return listLogs(dir, ext)
    .filter((f) => !filePattern || path.basename(f).includes(filePattern))
    .filter((f) => {
      if (!since) return true;
      const m = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(f));
      return !m || m[1] >= since;
    });
}

/** A missing or empty corpus must fail the run, not report a clean empty one */
function corpusFiles(dir: string, ext: string, what: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`ERROR: ${what} directory not found: ${dir}`);
    process.exit(2);
  }
  const found = collectFiles(dir, ext);
  if (!found.length) {
    console.error(`ERROR: no ${what} (*${ext}) in ${dir}${filePattern || since ? ' match' : ''}`);
    process.exit(2);
  }
  return found;
}

let files: { path: string; dartforge: boolean }[] = [];
if (useMush) {
  files.push(
    ...corpusFiles(mushDir, '.txt', 'MUSHclient logs').map((p) => ({ path: p, dartforge: false }))
  );
}
/** Session logs in the corpus dir (before --file/--since/--limit) */
let dfLogs = 0;
if (useDartforge) {
  files.push(
    ...corpusFiles(dfDir, '.log', 'session logs').map((p) => ({ path: p, dartforge: true }))
  );
  dfLogs = listLogs(dfDir, '.log').length;
}
if (files.length > limit) files = files.slice(-limit);

const skippedNested: string[] = [];
if (!keepNested) {
  const spans = files.map((f) =>
    f.dartforge ? fileSpan(readSessionLog(f.path)) : ([0, 0] as [number, number])
  );
  const skip = nestedFiles(spans);
  for (const i of skip) skippedNested.push(path.basename(files[i].path));
  files = files.filter((_, i) => !skip.has(i));
}

console.log(
  `Replaying ${files.length} log files through the town mapper pipeline` +
    (useDartforge
      ? `${aliasSets ? ` (aliases: ${describeAliasSets(aliasSets)})` : ' (legacy expansion)'}: ` +
        `${perChar ? 'per-character stores' : 'single store'}` +
        `${switchLate ? ', late switch on typed logins' : ''}` +
        `${rejoin ? ', TCP fragments rejoined' : ', raw log lines'}` +
        `${keepNested ? ', nested files kept' : `, ${skippedNested.length} nested files skipped`}`
      : ' (MUSHclient logs: parser validation)') +
    '...'
);
for (const f of skippedNested) console.log(`  [SKIP-NESTED] ${f} (concurrent app instance)`);
console.log('');

const t0 = Date.now();
for (const f of files) {
  if (snapshotBefore && snapshotOut && path.basename(f.path).includes(snapshotBefore)) {
    const snap = engine.snapshot();
    fs.writeFileSync(snapshotOut, JSON.stringify(snap));
    const others = Object.keys(snap.characters ?? {});
    console.log(
      `Snapshot (${engine.char ?? '?'} live${others.length ? `; also ${others.join(', ')}` : ''}) ` +
        `before ${path.basename(f.path)} written to ${snapshotOut}`
    );
  }
  curStats = { blocks: 0, jumped: 0, newRoom: 0, linkMisses: 0, descDisagree: 0, lostBlocks: 0 };
  const missesAtStart = engine.totals().linkMisses;
  engine.replayLog(f.path, !f.dartforge);
  curStats.linkMisses = engine.totals().linkMisses - missesAtStart;
  perFile[path.basename(f.path)] = curStats;
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// End-state map quality (per character store, summed)
// ---------------------------------------------------------------------------

const CARD: Record<string, [number, number, number]> = {
  n: [0, -1, 0],
  s: [0, 1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
  u: [0, 0, 1],
  d: [0, 0, -1],
};
const REV: Record<string, string> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  u: 'd',
  d: 'u',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
};

interface Quality {
  layoutExact: number;
  layoutLong: number;
  layoutOffAxis: number;
  contradictedLinks: number;
  asymmetricLinks: number;
  /** Rooms with no links in or out (floaters) */
  isolatedRooms: number;
  /** Rooms beyond one per (name, exits, desc-tail) group, summed over towns */
  dupExcess: number;
  /** Fingerprints (name+exits) appearing 3+ times within one town */
  dupGroups3: number;
  /** Rooms beyond the first on one (x,y,z) cell, and town.grid entries that
   *  disagree with the rooms (gridAudit): 0 on a sound map */
  sharedCells: number;
  gridErrors: number;
  totalRooms: number;
  towns: number;
}
const emptyQuality = (): Quality => ({
  layoutExact: 0,
  layoutLong: 0,
  layoutOffAxis: 0,
  contradictedLinks: 0,
  asymmetricLinks: 0,
  isolatedRooms: 0,
  dupExcess: 0,
  dupGroups3: 0,
  sharedCells: 0,
  gridErrors: 0,
  totalRooms: 0,
  towns: 0,
});

interface TownReport {
  char: string;
  id: number;
  name: string;
  rooms: number;
  floors: string;
  anchors: number;
  components: number[];
  dupGroups: { key: string; count: number }[];
}

function measureStore(
  char: string,
  store: TownMapStore
): { quality: Quality; towns: TownReport[] } {
  const quality = emptyQuality();
  const towns: TownReport[] = [];
  for (const town of store.towns.values()) {
    quality.towns++;
    quality.totalRooms += town.rooms.size;
    const audit = gridAudit(town);
    quality.sharedCells += audit.sharedCells;
    quality.gridErrors += audit.gridErrors;
    const inbound = new Map<number, number>();
    for (const room of town.rooms.values()) {
      for (const id of [...Object.values(room.links), ...Object.values(room.namedLinks)]) {
        if (id !== undefined) inbound.set(id, (inbound.get(id) || 0) + 1);
      }
    }
    for (const room of town.rooms.values()) {
      const out = Object.keys(room.links).length + Object.keys(room.namedLinks).length;
      if (out === 0 && !inbound.get(room.id)) quality.isolatedRooms++;
      for (const [dir, destId] of Object.entries(room.links) as [string, number][]) {
        const dest = town.rooms.get(destId);
        if (!dest) continue;
        if (linkContradicted(room, dir as never, dest)) quality.contradictedLinks++;
        const back = dest.links[REV[dir] as never];
        if (back !== undefined && back !== room.id) quality.asymmetricLinks++;
        const vec = CARD[dir];
        if (!vec) continue;
        const dx = dest.x - room.x;
        const dy = dest.y - room.y;
        const dz = dest.z - room.z;
        if (dx === vec[0] && dy === vec[1] && dz === vec[2]) quality.layoutExact++;
        else {
          const along = dx * vec[0] + dy * vec[1] + dz * vec[2];
          if (along > 1 && dx === along * vec[0] && dy === along * vec[1] && dz === along * vec[2])
            quality.layoutLong++;
          else quality.layoutOffAxis++;
        }
      }
    }

    // Connected components over links (undirected)
    const comp = new Map<number, number>();
    const adj = new Map<number, Set<number>>();
    for (const room of town.rooms.values()) adj.set(room.id, new Set());
    for (const room of town.rooms.values()) {
      for (const id of [...Object.values(room.links), ...Object.values(room.namedLinks)]) {
        if (id === undefined || !adj.has(id)) continue;
        adj.get(room.id)!.add(id);
        adj.get(id)!.add(room.id);
      }
    }
    const sizes: number[] = [];
    for (const id of adj.keys()) {
      if (comp.has(id)) continue;
      let size = 0;
      const stack = [id];
      comp.set(id, sizes.length);
      while (stack.length) {
        const cur = stack.pop()!;
        size++;
        for (const n of adj.get(cur)!) {
          if (!comp.has(n)) {
            comp.set(n, sizes.length);
            stack.push(n);
          }
        }
      }
      sizes.push(size);
    }
    sizes.sort((a, b) => b - a);

    // Duplicates: same name + exits + description tail (fragmented captures
    // keep the tail, so the tail is the robust part)
    const groups = new Map<string, number>();
    const fp = new Map<string, number>();
    for (const r of town.rooms.values()) {
      const key = `${r.name}|${r.exits.join(',')}`;
      fp.set(key, (fp.get(key) || 0) + 1);
      if (!descUsable(r.desc)) continue;
      const dkey = `${key}|${canon(r.desc, store).slice(-80)}`;
      groups.set(dkey, (groups.get(dkey) || 0) + 1);
    }
    for (const c of groups.values()) quality.dupExcess += c - 1;
    for (const c of fp.values()) if (c >= 3) quality.dupGroups3++;
    const floors = store.floorsOf(town);
    towns.push({
      char,
      id: town.id,
      name: town.name,
      rooms: town.rooms.size,
      floors: `${floors[0]}..${floors[floors.length - 1]}`,
      anchors: Object.keys(town.anchors).length,
      components: sizes,
      dupGroups: [...groups.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => ({ key: key.split('|').slice(0, 2).join(' ['), count })),
    });
  }
  towns.sort((a, b) => b.rooms - a.rooms);
  return { quality, towns };
}

const stores = engine.stores();
const quality = emptyQuality();
const byChar: Record<
  string,
  { quality: Quality; towns: TownReport[]; kinds: Record<string, number>; linkMisses: number }
> = {};
for (const [char, s] of stores) {
  const m = measureStore(char, s.town);
  for (const k of Object.keys(quality) as (keyof Quality)[]) quality[k] += m.quality[k];
  byChar[char] = {
    ...m,
    kinds: engine.kindsByChar[char] ?? {},
    linkMisses: engine.totals(char).linkMisses,
  };
}
const charOrder = Object.keys(byChar).sort(
  (a, b) => byChar[b].quality.totalRooms - byChar[a].quality.totalRooms
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const totals = engine.totals();
const st = engine.stats;
const kinds = engine.kinds;
const pct = (n: number, d: number) => ((n / Math.max(1, d)) * 100).toFixed(1);
const totalRes = Object.values(kinds).reduce((a, b) => a + b, 0);
console.log(`--- Town replay results (${elapsed}s) ---\n`);
console.log(
  `Files:            ${st.files}${skippedNested.length ? ` (+${skippedNested.length} nested skipped)` : ''}`
);
console.log(
  `Lines:            ${st.lines}${useDartforge && rejoin ? ` (${st.rejoins} logger-split lines rejoined)` : ''}`
);
console.log(
  `Exits lines:      ${st.exitsLines}` +
    `${st.noExitsRooms ? ` (${st.noExitsRooms} "There are no obvious exits.")` : ''}`
);
console.log(`Blocks parsed:    ${st.blocks} (${pct(st.blocks, st.exitsLines)}% of exits lines)`);
console.log(`Lost blocks:      ${st.lostBlocks} exits lines with no room block`);
console.log(`Commands tracked: ${st.cmdTracked}`);
console.log(`Move failures:    ${st.moveFails}`);
console.log(
  `"What ?" fails:   ${st.replyFails} queued moves failed by a "What ?" / "<Verb> what?" reply`
);
if (useDartforge) {
  console.log(
    `Logins:           ${st.logins} (${st.loginsTyped} typed at Name:, ${st.loginsUnidentified} unidentified); ` +
      `${perChar ? `${st.switches} character switches${switchLate ? ` (${st.lateSwitches} late)` : ''}` : 'single store'}`
  );
  for (const s of engine.switchLog) console.log(`  switch ${s}`);
}

console.log(`\nResolution kinds:`);
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v} (${pct(v, totalRes)}%)`);
}
console.log(`\nLink misses (known link, wrong room): ${totals.linkMisses}`);
console.log(`Link heals (stale links re-pointed): ${totals.linkHeals}`);
console.log(`Placement nudges: ${totals.nudges}`);
console.log(`Placement stretches: ${totals.stretches}`);
console.log(`Town merges: ${st.merges}`);
console.log(`Portal transits: ${st.portals}`);
console.log(
  `Teleports (plane shift, temple pool): ${st.teleports}; forced moves queued: ${st.forcedMoves}; ` +
    `dark arrivals: ${st.darkArrivals}`
);
const sumStores = (f: (s: TownMapStore) => number) =>
  [...stores.values()].reduce((a, s) => a + f(s.town), 0);
console.log(`Portal destinations learned: ${sumStores((s) => s.portalDests.size)}`);
console.log(`Volatile desc sentences learned: ${sumStores((s) => s.volatileSentences.size)}`);
if (verbose) {
  for (const s of stores.values()) {
    for (const v of s.town.volatileSentences) console.log(`  ~ ${v.slice(0, 90)}`);
  }
}

const disagreeTotal = Object.values(metrics.descDisagree).reduce((a, b) => a + b, 0);
console.log(
  `\nDesc disagreements on assignment (proxy): ${disagreeTotal} of ${metrics.descCompared} compared ` +
    `(${pct(disagreeTotal, metrics.descCompared)}%) — ` +
    Object.entries(metrics.descDisagree)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
);
if (oracle) {
  console.log(`ORACLE wrong-room assignments: ${oracle.describe()}`);
  console.log(`ORACLE unclassified blocks (text not in the oracle): ${oracle.unclassified}`);
  console.log(
    `ORACLE glue events (block of another place filed into a town): ${oracle.glueEvents}`
  );
  for (const l of oracle.glueLines) console.log(l);
  if (verbose) for (const s of oracle.sampleLines(40)) console.log(`   ${s}`);
  if (dumpWrong) {
    fs.writeFileSync(dumpWrong, oracle.wrongList.map((w) => JSON.stringify(w)).join('\n') + '\n');
  }
}
console.log(
  `Suspect duplicate creations (name+exits+desc already in town): ${metrics.suspectDupCreations}`
);
if (traceNewTowns) {
  console.log(
    `First block after a login (resolution/name vs previous room): ${JSON.stringify(metrics.loginFirst)}`
  );
}

const layoutTotal = quality.layoutExact + quality.layoutLong + quality.layoutOffAxis;
console.log(
  `\nLayout quality (cardinal links): ${quality.layoutExact} exact (${pct(quality.layoutExact, layoutTotal)}%), ` +
    `${quality.layoutLong} long-street, ${quality.layoutOffAxis} off-axis`
);
console.log(
  `Grid integrity: ${quality.sharedCells} rooms sharing a cell, ${quality.gridErrors} grid index errors`
);
console.log(
  `Link integrity: ${quality.contradictedLinks} contradicted by exits, ${quality.asymmetricLinks} asymmetric`
);
console.log(
  `Rooms: ${quality.totalRooms} total, ${quality.isolatedRooms} isolated (no links), ` +
    `${quality.dupExcess} excess duplicates (same name+exits+desc), ` +
    `${quality.dupGroups3} fingerprints 3+ times in a town`
);

console.log(`\nTowns mapped: ${quality.towns}${perChar ? ' (per character)' : ''}`);
for (const char of charOrder) {
  const c = byChar[char];
  const q = c.quality;
  if (perChar) {
    console.log(
      `  ${char}: ${q.towns} towns, ${q.totalRooms} rooms, ${q.dupExcess} excess duplicates, ` +
        `${q.asymmetricLinks} asymmetric, ${q.layoutOffAxis} off-axis, ${q.isolatedRooms} isolated, ` +
        `link misses ${c.linkMisses}`
    );
  }
  const shown = perChar ? 12 : 15;
  for (const t of c.towns.slice(0, shown)) {
    const comps =
      t.components.length > 1
        ? `, ${t.components.length} components [${t.components.slice(0, 6).join(',')}${t.components.length > 6 ? ',…' : ''}]`
        : '';
    console.log(
      `  ${perChar ? '  ' : ''}[${t.id}] "${t.name}" — ${t.rooms} rooms, floors ${t.floors}, anchors: ${t.anchors}${comps}`
    );
    if (verbose) for (const g of t.dupGroups) console.log(`       x${g.count} ${g.key}]`);
  }
  if (c.towns.length > shown)
    console.log(`  ${perChar ? '  ' : ''}... and ${c.towns.length - shown} more`);
}

for (const [kind, list] of Object.entries(samples).sort()) {
  console.log(`\n${kind} samples:`);
  for (const s of list) console.log(`  ${s.file}:${s.line} ${s.text}`);
}

if (outFile) {
  const written: string[] = [];
  if (perChar) {
    // One file per character, like the live map-<char>.json townData
    const base = outFile.replace(/\.json$/, '');
    for (const [char, s] of stores) {
      const f = `${base}-${char}.json`;
      fs.writeFileSync(f, JSON.stringify(s.town.serialize(), null, 1));
      written.push(f);
    }
  } else {
    fs.writeFileSync(outFile, JSON.stringify(engine.townMap.serialize(), null, 1));
    written.push(outFile);
  }
  console.log(`\nTown maps written: ${written.join(' ')}`);
}
if (jsonFile) {
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        config: {
          perChar,
          switchLate,
          rejoin,
          keepNested,
          restart,
          legacyExpand,
          dfDir,
          dfLogs,
          aliasesFile: aliasSets ? aliasesFile : null,
          aliases: aliasCounts,
          oracleFile: oracleFile ?? null,
        },
        stats: st,
        kinds,
        totals,
        metrics,
        quality,
        characters: byChar,
        switches: engine.switchLog,
        skippedNested,
        lostBlocks: lostBlockText,
        oracle: oracle
          ? {
              ...oracle.totals(),
              byKind: { wrong: oracle.wrong, checked: oracle.checked },
              unclassified: oracle.unclassified,
              glueEvents: oracle.glueEvents,
            }
          : null,
        perFile,
        samples,
      },
      null,
      1
    )
  );
  console.log(`Metrics written to ${jsonFile}`);
}

// One line for A/B comparisons (grep REPLAY-SUMMARY)
const kv = (k: string) => kinds[k] ?? 0;
const ow = oracle?.totals();
console.log(
  `\nREPLAY-SUMMARY files=${st.files} skippedNested=${skippedNested.length} blocks=${st.blocks} ` +
    `lostBlocks=${st.lostBlocks} rejoins=${st.rejoins} switches=${st.switches} ` +
    `expected=${kv('expected')}(${pct(kv('expected'), totalRes)}%) entered=${kv('entered')} ` +
    `stationary=${kv('stationary')} new-room=${kv('new-room')} corrected=${kv('corrected')} ` +
    `relocalized=${kv('relocalized')} jumped=${kv('jumped')} lost=${kv('lost')} ` +
    `linkMisses=${totals.linkMisses} heals=${totals.linkHeals} merges=${st.merges} ` +
    `rooms=${quality.totalRooms} excessDups=${quality.dupExcess} isolated=${quality.isolatedRooms} ` +
    `asym=${quality.asymmetricLinks} offAxis=${quality.layoutOffAxis} contradicted=${quality.contradictedLinks} ` +
    `suspectDups=${metrics.suspectDupCreations} descDisagree=${disagreeTotal}` +
    `${ow ? ` wrongRoom=${ow.wrong}/${ow.checked} glue=${oracle!.glueEvents}` : ''}`
);
