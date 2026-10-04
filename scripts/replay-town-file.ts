/** Verbose single-file town replay — pass session log path(s); prints every resolution.
 * Usage: npx tsx scripts/replay-town-file.ts [--load snapshot.json] [--legacy-expand]
 *          [--df-dir D] [--aliases F] [--single-store] [--switch-late] [--no-rejoin]
 *          [--from N] [--to M] [--quiet-towns] <log path|name> [<log path|name> ...]
 *
 * Same live-faithful engine as replay-town.ts (scripts/lib/townReplay.ts):
 * wall-clock timestamps drive the localizer clock; between files the stores
 * round-trip serialize/deserialize like an app restart (load-time cleanses
 * included); a log with sent lines (`>> [sent] cmd`, Oct 2026 on) tracks
 * those, an older one expands raw input through the real alias engine with
 * the active character's aliases first (scripts/lib/replayInput.ts); TCP
 * fragments are rejoined (older logs); each character gets its own stores,
 * swapped at login (--single-store: one shared store; --switch-late:
 * typed-name logins resolve the login burst's first room in the previous
 * character's map, like the live race before the login hold).
 *
 * `--load` starts from a saved store — replay-town.ts --snapshot-out (the
 * live map-file format {character, mapData, townData} plus every other
 * character's stores), a live map-<char>.json (owned by the character its
 * file name says), or a bare TownMapStore.serialize() — so a failure deep
 * in the corpus reproduces in isolation. A loaded file that names no
 * character, and a switch to a character it has no stores for, print a
 * WARNING (the first login adopts the stores; that character's map starts
 * empty). `--from/--to` limit
 * the per-line trace to a line window of the (last) file. Log names without
 * a directory resolve against --df-dir / DF_SESSIONS. A missing or
 * unreadable aliases file ends the run (exit 2).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  legacyExpandInput,
  loadAliasSetsOrExit,
  makeCharExpander,
  resolveAliasesFile,
} from './lib/replayInput';
import { resolveDfDir } from './lib/replayCorpus';
import { TownReplay, mapFileOwner } from './lib/townReplay';

const argv = process.argv.slice(2);
const files: string[] = [];
let loadFile: string | undefined;
let legacy = false;
let fromLine = 0;
let toLine = Infinity;
let quietTowns = false;
let dfDirFlag: string | undefined;
let aliasesFlag: string | undefined;
let perChar = true;
let switchLate = false;
let rejoin = true;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--load') loadFile = argv[++i];
  else if (a === '--legacy-expand') legacy = true;
  else if (a === '--from') fromLine = parseInt(argv[++i], 10);
  else if (a === '--to') toLine = parseInt(argv[++i], 10);
  else if (a === '--quiet-towns') quietTowns = true;
  else if (a === '--df-dir') dfDirFlag = argv[++i];
  else if (a === '--aliases') aliasesFlag = argv[++i];
  else if (a === '--single-store') perChar = false;
  else if (a === '--switch-late') switchLate = true;
  else if (a === '--no-rejoin') rejoin = false;
  else files.push(a);
}
const dfDir = resolveDfDir(dfDirFlag);
const resolved = files.map((f) =>
  fs.existsSync(f) || path.isAbsolute(f) || /[\\/]/.test(f) ? f : path.join(dfDir, f)
);
const expand = legacy
  ? legacyExpandInput
  : makeCharExpander(loadAliasSetsOrExit(resolveAliasesFile(aliasesFlag)));

let fileIdx = 0;
const inWindow = () =>
  fileIdx < resolved.length - 1 || (engine.line >= fromLine && engine.line <= toLine);
const log = (s: string) => {
  if (inWindow()) console.log(s);
};
const at = () => String(engine.line).padStart(5);
/** The pending queue as the trace prints it (a leading `!` marks a forced move) */
const queueStr = () =>
  engine.townLocalizer.pendingMoves
    .map(
      (m) =>
        (m.kind !== 'look' && m.forced ? '!' : '') +
        (m.kind === 'dir'
          ? m.verb
            ? `${m.verb}:${m.dir}`
            : m.dir
          : m.kind === 'named'
            ? `[${m.cmd}]`
            : 'look')
    )
    .join(' ');

let queueBefore = '';
const engine: TownReplay = new TownReplay(
  { expand, perChar, switchLate, rejoin },
  {
    beforeBlock() {
      queueBefore = queueStr();
    },
    onBlock({ block, res }) {
      const room = engine.townMap.room(res.pos);
      log(
        `${at()} [${res.kind.padEnd(11)}] #${room?.id} "${block.name}" [${block.exits.dirs.join(',')}] ` +
          `at(${room?.x},${room?.y},${room?.z}) town=${res.pos?.townId}${res.merged ? ' MERGED' : ''}  ` +
          `q=[${queueBefore}]→[${queueStr()}] misses=${engine.townLocalizer.linkMisses}`
      );
    },
    onCommand(raw, sent, _tracked, typed) {
      // (A log with sent lines: the typed input tracks nothing itself)
      if (typed) {
        log(`${at()} >> ${raw}  (typed)`);
        return;
      }
      const shown = sent.length !== 1 || sent[0] !== raw.trim() ? `  → ${sent.join(' | ')}` : '';
      log(`${at()} >> ${raw}${shown}`);
    },
    onSurvey() {
      log(`${at()} (wilderness survey)`);
    },
    onMoveFailed(inTown) {
      log(`${at()} (move-failed${inTown ? ' town' : ''})`);
    },
    onUnknownCommand(verb, failed) {
      log(
        `${at()} (${verb ? `${verb} what?` : 'What ?'}${failed ? ' — failed a queued move' : ''})`
      );
    },
    onPortal(dir) {
      log(`${at()} (portal transit${dir ? `: ${dir}` : ''})`);
    },
    onTeleport() {
      log(`${at()} (teleport transit)`);
    },
    onForcedMove(move, queued) {
      log(`${at()} (led: ${move}${queued ? '' : ', not queued'})`);
    },
    onDarkArrival(result) {
      log(`${at()} (pitch black: ${result})`);
    },
    onLostBlock(line, text, context) {
      log(
        `${String(line).padStart(5)} (LOST BLOCK — no room parsed: ` +
          `${context.map((l) => JSON.stringify(l.slice(0, 50))).join(' / ')} → ${text.slice(0, 50)})`
      );
    },
    onLogin(login, switching) {
      log(
        `${at()} (login: ${login.char ?? 'unidentified'}${login.via ? ` via ${login.via}` : ''}` +
          `${login.typed ? ', name typed' : ''}${switching ? ', character switch' : ''})`
      );
    },
    onSwitch({ from, to, late, fresh }) {
      log(
        `${at()} (stores: ${from ?? '?'} → ${to}${fresh ? ' (new empty map)' : ''}` +
          `${late ? ', late — the login burst went to ' + (from ?? '?') : ''})`
      );
      if (fresh && loadFile) {
        console.log(
          `WARNING: ${loadFile} holds no stores for ${to} — ${to} continues on an EMPTY map ` +
            `(snapshot every character: replay-town.ts --snapshot-out)`
        );
      }
    },
  }
);

if (loadFile) {
  // A live map file says nothing about its owner: its name does
  // (map-mazorn.json); without one the first login would adopt the stores
  engine.load(JSON.parse(fs.readFileSync(loadFile, 'utf8')), mapFileOwner(loadFile));
  if (engine.char === null) {
    console.log(
      `WARNING: ${loadFile} names no character (neither a --snapshot-out file nor a ` +
        `map-<char>.json) — the first identified login's character takes these stores over`
    );
  }
}

for (fileIdx = 0; fileIdx < resolved.length; fileIdx++) {
  const f = resolved[fileIdx];
  console.log(`\n=== ${path.basename(f)} ===`);
  engine.replayLog(f);
}

if (!quietTowns) {
  for (const [char, s] of engine.stores()) {
    console.log(`\n--- final towns${perChar ? ` (${char})` : ''} ---`);
    for (const t of s.town.towns.values()) {
      console.log(`[${t.id}] "${t.name}" ${t.rooms.size} rooms`);
      for (const r of t.rooms.values()) {
        console.log(
          `   #${r.id} "${r.name}" [${r.exits.join(',')}] at(${r.x},${r.y},${r.z}) links=${JSON.stringify(r.links)} named=${JSON.stringify(r.namedLinks)}`
        );
      }
    }
  }
}
