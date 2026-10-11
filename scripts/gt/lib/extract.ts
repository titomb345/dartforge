/**
 * Block extraction for the ground-truth oracle.
 *
 * Uses the REAL TownParser (block detection, name scan and exits grammar are
 * the engine's), wrapped only to capture the FULL description (the parser
 * caps block.desc at 600 chars, which is what the map stores; identity needs
 * the whole text).
 *
 * Both corpora also yield an event stream: login markers (DartMUD resumes
 * you in the room you logged out in — cross-time same-room evidence),
 * wilderness surveys and portal transits (chain breakers), move failures and
 * forced moves (real RoomParser). DF session logs add the commands: raw
 * `>> input` expanded through the real alias engine + /door built-in
 * (scripts/lib/replayInput.ts) — what the live client actually sent — and
 * are read like the replay reads them: TCP fragments rejoined
 * (scripts/lib/rejoin.ts). A log written since Oct 2026 records the sends
 * themselves (`>> [sent] lead n`): they are its commands, its typed input
 * is not expanded, and its lines are whole.
 *
 * Oracle-only repairs (never in the engine): split direction words inside
 * an exits sentence, and the OOC Entry Hall's board notifications (the
 * parser skips those itself since Oct 2026; the oracle keeps its own skip so
 * an oracle built with an older parser reads the hall the same way).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  TownParser,
  PORTAL_TRANSIT_RE,
  parseTownExits,
  type TownRoomBlock,
} from '../../../src/lib/townParser';
import { RoomParser } from '../../../src/lib/roomParser';
import { isMarkedLog, liveLines, loggedCommand, readSessionLog } from '../../lib/replayCorpus';
import { EXITS_START_RE } from '../../lib/serverLines';

/** The oracle's login marker: the end of the MOTD (the login room follows)
 *  or a reconnect into the existing body. Not replayCorpus.LOGIN_RE — that
 *  one is the line live fires onCharacterName on ("Running under version",
 *  a few lines earlier in the same burst); the alignment only needs a walk
 *  break before the login room, and the oracle is fixed as built. */
export const MOTD_LOGIN_RE =
  /^(?:> )*(?:--- End of MOTD ---|You are already playing, reconnecting to old object\.)/;
/** Logout / link loss */
export const LOGOUT_RE = /^(?:> )*Saving [A-Z][a-z]+\.\s*$/;
/** Teleports the engine has no transit regex for (the warriors' temple
 *  pools; the OOC "plane shift") — chain breakers for the alignment */
export const TELEPORT_RE =
  /^(?:> )*(?:You step into the pool and feel power well up from deep within the ground, taking you elsewhere!|Your body becomes insubstantial\.)/;
const NO_NOTES = 'Sadly, there are no new notes for you to read.';

export interface RawBlock {
  name: string;
  dirs: string[];
  named: string[];
  /** EVERY non-directional exit name (hole, path, mudschool, a door "leading backroom"...) */
  namedAll: string[];
  doorDirs: string[];
  /** Full description, whitespace-collapsed */
  desc: string;
  /** What the engine stores (single-space join, 600-char cap) */
  descEngine: string;
  /** 1-based line of the exits line */
  line: number;
}

export type LogEvent =
  | { k: 'block'; b: RawBlock; t: number; line: number }
  | { k: 'cmd'; raw: string; cmds: string[]; t: number; line: number }
  | { k: 'survey'; t: number; line: number }
  | { k: 'portal'; dir: string | null; t: number; line: number }
  | { k: 'movefail'; hard: boolean; t: number; line: number; text: string }
  | { k: 'forced'; dir: string; t: number; line: number }
  | { k: 'login'; t: number; line: number }
  | { k: 'logout'; t: number; line: number };

const DIR_WORD_RE = /^(?:north|south|east|west|up|down|northeast|northwest|southeast|southwest)$/;

/** Non-directional exit names from an exits sentence body ("hole", "path",
 *  or the target of a door "leading backroom"). */
export function namedExitItems(raw: string): string[] {
  const out = new Set<string>();
  for (const tok of raw.replace(/\.\s*$/, '').split(/,\s*(?:and\s+)?|\s+and\s+/)) {
    const t = tok.trim().toLowerCase();
    if (!t) continue;
    const lead = /\bleading (\w+)$/.exec(t);
    const word = lead ? lead[1] : t;
    if (DIR_WORD_RE.test(word) || /\s/.test(word)) continue;
    out.add(word);
  }
  return [...out].sort();
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const DIR_WORDS = new Set([
  'north',
  'south',
  'east',
  'west',
  'up',
  'down',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
]);

/**
 * The parser joins a wrapped exits sentence's lines with a space, so a
 * logger split inside a direction word ("leading nor" + "th.") that the
 * rejoin could not prove becomes "nor th" and the direction drops out of
 * the dir-set. Rejoin adjacent tokens that only form a direction together.
 */
export function repairSplitDirections(raw: string): string {
  const toks = raw.split(' ');
  const word = (t: string) => t.replace(/[^a-z]/g, '');
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (!/^[a-z]+$/.test(a)) continue; // a must not end in punctuation
    const wb = word(b);
    if (!wb || DIR_WORDS.has(a) || DIR_WORDS.has(wb)) continue;
    if (DIR_WORDS.has(a + wb)) toks.splice(i, 2, a + b);
  }
  return toks.join(' ');
}

/** The parser's private name scan, wrapped once so the full desc lines of
 *  the block being emitted are readable from the callback. */
interface ScanResult {
  name: string;
  descLines: string[];
}
type ScanHost = { scanName: () => ScanResult | null; __last?: ScanResult | null };
const proto = TownParser.prototype as unknown as ScanHost & { __wrapped?: boolean };
if (!proto.__wrapped) {
  const orig = proto.scanName;
  proto.scanName = function (this: ScanHost) {
    const r = orig.call(this);
    this.__last = r;
    return r;
  };
  proto.__wrapped = true;
}

function makeParser(onBlock: (b: RawBlock) => void, getLine: () => number): TownParser {
  const parser: TownParser = new TownParser((block: TownRoomBlock) => {
    const last = (parser as unknown as ScanHost).__last;
    const full = last ? last.descLines.join(' ') : block.desc;
    const fixed = repairSplitDirections(block.exits.raw);
    const exits = fixed !== block.exits.raw ? parseTownExits(':' + fixed) : block.exits;
    onBlock({
      name: block.name,
      dirs: exits.dirs,
      named: exits.named,
      namedAll: namedExitItems(exits.raw),
      doorDirs: exits.doorDirs,
      desc: collapse(full),
      descEngine: block.desc,
      line: getLine(),
    });
  });
  return parser;
}

/**
 * Parse one log into an ordered event stream. `df` = DartForge session log
 * ("[stamp] text" lines, ">> input" echoes, TCP fragments rejoined);
 * otherwise MUSHclient (output only, line-intact, no stamps — t is the line
 * number).
 */
export function parseLogFile(
  file: string,
  df: boolean,
  expand?: (raw: string) => string[]
): LogEvent[] {
  const out: LogEvent[] = [];
  const logged = df ? readSessionLog(file) : [];
  // A log written since Oct 2026 has whole lines and records every command
  // as sent — what live tracked: those are the commands, and its typed lines
  // are not (see scripts/lib/townReplay.ts)
  const marked = isMarkedLog(logged.map((l) => l.text));
  const lines: ({ text: string; t: number | null } | null)[] = df
    ? liveLines(logged, !marked).lines
    : fs
        .readFileSync(file, 'latin1')
        .split('\n')
        .map((l) => ({ text: l.replace(/\r$/, ''), t: null }));
  let exitsLine = 0;
  let clock = 0;
  let lineNo = 0;
  let curText = '';
  let inBoards = false;
  const parser = makeParser(
    (b) => out.push({ k: 'block', b, t: clock, line: b.line }),
    () => exitsLine
  );
  const hex = new RoomParser((ev) => {
    if (ev.type === 'survey') out.push({ k: 'survey', t: clock, line: lineNo });
    else if (ev.type === 'move-failed')
      out.push({ k: 'movefail', hard: ev.hard, t: clock, line: lineNo, text: curText });
    else if (ev.type === 'forced-move')
      out.push({ k: 'forced', dir: ev.dir, t: clock, line: lineNo });
  });
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i];
    if (!entry) continue; // rejoined into a later line
    lineNo = i + 1;
    const line = entry.text;
    if (df) {
      clock = entry.t !== null && entry.t > clock ? entry.t : clock + 1;
      const cmd = loggedCommand(line);
      if (cmd) {
        if (cmd.sent || !marked) {
          const raw = cmd.command;
          const cmds = cmd.sent || !expand ? [raw] : expand(raw);
          out.push({ k: 'cmd', raw, cmds, t: clock, line: lineNo });
        }
        continue;
      }
    } else {
      clock = lineNo;
    }
    curText = line;
    if (MOTD_LOGIN_RE.test(line)) out.push({ k: 'login', t: clock, line: lineNo });
    else if (LOGOUT_RE.test(line)) out.push({ k: 'logout', t: clock, line: lineNo });
    if (EXITS_START_RE.test(line)) exitsLine = lineNo;
    const portal = PORTAL_TRANSIT_RE.exec(line);
    if (portal) out.push({ k: 'portal', dir: portal[1] ?? null, t: clock, line: lineNo });
    else if (TELEPORT_RE.test(line))
      out.push({ k: 'portal', dir: 'teleport', t: clock, line: lineNo });
    hex.feedLine(line);
    // Board notifications inside the OOC Entry Hall's description ("There
    // are new notes to read on the following boards:" + indented board
    // names + blank + indented lighting) make the real parser take a board
    // name as the ROOM NAME (session logs drop the blank) or drop the block
    // (MUSH/live keep it) — before Oct 2026. The oracle hides them from the
    // town parser either way.
    const bare = line.replace(/^(?:> )+/, '');
    if (/^There are new notes to read on the following boards:\s*$/.test(bare)) {
      inBoards = true;
      continue;
    }
    if (bare.startsWith(NO_NOTES)) {
      // the session logger drops the blank line after it, so the rejoin can
      // glue the hall's indented lighting line onto it — keep that part
      const rest = bare.slice(NO_NOTES.length);
      if (rest.trim()) parser.feedLine(rest);
      continue;
    }
    if (inBoards) {
      if (!bare.trim() || /^\s+\S/.test(bare)) continue;
      inBoards = false;
    }
    parser.feedLine(line);
  }
  parser.flushPending();
  return out;
}

/** "dm-2021-04-16.txt" / "session_2026-06-19T..." → "2021-04-16" */
export function fileDate(file: string): string {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(file));
  return m ? m[1] : '0000-00-00';
}
