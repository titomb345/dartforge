/**
 * Corpus plumbing shared by the town replay tools (replay-town.ts,
 * replay-town-file.ts) and the ground-truth toolkit (scripts/gt/):
 * where the logs live, how a DartForge session log is read (stamps, TCP
 * fragments, sent and typed command lines, the pager prompt — the last
 * three shared with the hex and loadout replays too), which session files
 * overlap in time, and which character each login belongs to.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PAGER_PROMPT } from '../../src/lib/partialLine';
import { SENT_PREFIX } from '../../src/lib/sessionLog';
import { rejoinFragments, type RejoinJoin } from './rejoin';
import { parseStamp } from './replayInput';

// ---------------------------------------------------------------------------
// Corpus locations (CLI flag → environment → Bill's Dropbox)
// ---------------------------------------------------------------------------

export const DEFAULT_DF_DIR = 'C:/Users/titom/Dropbox/DM/Dartforge/sessions';
export const DEFAULT_MUSH_DIR = 'C:/Users/titom/Dropbox/MUSH/MUSHclient/logs';

const slashes = (p: string) => p.replace(/\\/g, '/');

/** DartForge session logs: --df-dir, then DF_SESSIONS, then the live Dropbox dir */
export function resolveDfDir(flag?: string): string {
  return slashes(flag ?? process.env.DF_SESSIONS ?? DEFAULT_DF_DIR);
}

/** MUSHclient logs: --mush-dir, then MUSH_LOGS, then Dropbox */
export function resolveMushDir(flag?: string): string {
  return slashes(flag ?? process.env.MUSH_LOGS ?? DEFAULT_MUSH_DIR);
}

/** Sorted log files of a directory (name order = start-time order for session logs) */
export function listLogs(dir: string, ext: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// Reading a session log
// ---------------------------------------------------------------------------

export interface SessionLine {
  /** Line text without the log stamp (commands keep their '>> ') */
  text: string;
  /** Wall-clock time from the log stamp (ms), null for unstamped lines */
  t: number | null;
}

/** Split a DartForge session log into stamped lines (1:1 with file lines). */
export function readSessionLog(file: string): SessionLine[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((raw) => {
      const line = raw.replace(/\r$/, '');
      const ts = parseStamp(line);
      if (ts) return { text: ts.text, t: ts.t };
      // Pre-2026 stamp formats: drop the bracket, keep the text
      const m = /^\[[^\]]{5,40}\] (.*)$/.exec(line);
      return { text: m ? m[1] : line, t: null };
    });
}

/**
 * A log written since Oct 2026 records every command as it was sent
 * (`>> [sent] lead n`, src/lib/sessionLog.ts) — what live tracked — and
 * has whole lines (nothing to rejoin). Takes the lines without their stamps.
 */
export function isMarkedLog(texts: readonly string[]): boolean {
  return texts.some((t) => t.startsWith(SENT_PREFIX));
}

/**
 * A logged command line (stamp removed): a command as sent (`sent`), or
 * input as typed. Null for server output. The replay tools track the sent
 * lines of a marked log as they stand and skip its typed lines; an older log
 * has only typed input, which they expand the way the live client did.
 */
export function loggedCommand(text: string): { command: string; sent: boolean } | null {
  if (text.startsWith(SENT_PREFIX)) return { command: text.slice(SENT_PREFIX.length), sent: true };
  const typed = /^>> (.+)$/.exec(text);
  return typed ? { command: typed[1], sent: false } : null;
}

/**
 * A logged output line as the live parsers got it, or null when they got
 * nothing: the pager's prompt (PAGER_PROMPT) ends a read with no newline
 * and goes to the screen only (src/lib/partialLine.ts), but the loggers
 * wrote it as a line of its own and a MUSHclient log glues the next page's
 * first line onto it.
 */
export function parserText(text: string): string | null {
  if (!text.startsWith(PAGER_PROMPT)) return text;
  return text.length > PAGER_PROMPT.length ? text.slice(PAGER_PROMPT.length) : null;
}

/**
 * The lines the live parsers would have seen: TCP fragments rejoined
 * (scripts/lib/rejoin.ts). Same length and line numbers as the file — a
 * consumed fragment is null and a joined line sits at its last fragment.
 */
export function liveLines(
  lines: readonly SessionLine[],
  rejoin: boolean
): { lines: (SessionLine | null)[]; joins: RejoinJoin[] } {
  if (!rejoin) return { lines: [...lines], joins: [] };
  const res = rejoinFragments(lines);
  return {
    lines: res.lines.map((text, i) => (text === null ? null : { text, t: lines[i].t })),
    joins: res.joins,
  };
}

// ---------------------------------------------------------------------------
// Concurrent app instances
// ---------------------------------------------------------------------------

/** First and last stamped time of a session log ([0,0] when unstamped) */
export function fileSpan(lines: readonly SessionLine[]): [number, number] {
  let first = 0;
  let last = 0;
  for (const l of lines) {
    if (l.t === null) continue;
    if (!first) first = l.t;
    if (l.t > last) last = l.t;
  }
  return [first, last];
}

/**
 * Session files whose whole time span lies inside an EARLIER file's span:
 * a second app instance running concurrently (dev builds) that stole the
 * connection ("You are already playing, reconnecting to old object") while
 * the host instance sat silent. Replayed in name order they inject
 * out-of-order positions into the host's map, which live never saw: the
 * host instance kept its own in-memory store and overwrote the file.
 * Returns the indices (into `spans`) to skip.
 */
export function nestedFiles(spans: readonly [number, number][]): Set<number> {
  const skip = new Set<number>();
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i];
    if (!a) continue;
    for (let j = 0; j < i; j++) {
      const [x, y] = spans[j];
      if (x && x <= a && b <= y) {
        skip.add(i);
        break;
      }
    }
  }
  return skip;
}

// ---------------------------------------------------------------------------
// Logins and characters
// ---------------------------------------------------------------------------

/** The lines useMudConnection treats as a successful login (onCharacterName fires) */
export const LOGIN_RE = /Running under version|reconnecting to old object/;
/** The login burst's auto-`score` line: "You are Mazorn the spyder.  You are a
 *  middle aged spyder." — also bare, wrapped, or with parentheticals
 *  ("You are Mazorn the spyder (grappling with Carrion demon)."). */
const SCORE_RE = /^(?:> )*You are ([A-Z][a-z]+) the [a-z][a-z' -]*(?:\.|\s*\(|$)/;
/** Quit line closing a login segment */
const SAVING_RE = /^(?:> )*Saving ([A-Z][a-z]+)\.\s*$/;
const NAME_PROMPT_RE = /^(?:> )*Name:\s*$/;
/** The login burst: the score reply lands within ~3 s / 70 lines of the
 *  login line in the corpus (335 logins). Generous bounds, but well short of
 *  in-game prose like a shapeshifter's "You are Danor the rabbit." */
const BURST_MS = 30_000;
const BURST_LINES = 150;

export interface LoginInfo {
  /** Line index of the login line */
  index: number;
  /** Lower-case character name, or null when the segment never says */
  char: string | null;
  /** How the character was identified */
  via: 'score' | 'saving' | null;
  /** The name was TYPED at the Name: prompt (a logged `>> name`), as
   *  opposed to auto-login / the character-switch button */
  typed: boolean;
}

/**
 * Every login in a session log with its character. A segment runs from a
 * login line to the next one; its character is the login burst's `score`
 * line (App.tsx sends score on every login), else the "Saving <Name>." quit
 * line that closes the segment.
 */
export function loginInfos(
  lines: readonly ({ text: string; t: number | null } | null)[]
): LoginInfo[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && LOGIN_RE.test(l.text)) starts.push(i);
  }
  const out: LoginInfo[] = [];
  for (let k = 0; k < starts.length; k++) {
    const i0 = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const t0 = lines[i0]!.t;
    let char: string | null = null;
    let via: LoginInfo['via'] = null;
    for (let i = i0; i < Math.min(end, i0 + BURST_LINES); i++) {
      const l = lines[i];
      if (!l) continue;
      if (t0 !== null && l.t !== null && l.t - t0 > BURST_MS) break;
      const m = SCORE_RE.exec(l.text);
      if (m) {
        char = m[1].toLowerCase();
        via = 'score';
        break;
      }
    }
    if (!char) {
      for (let i = i0; i < end; i++) {
        const m = lines[i] ? SAVING_RE.exec(lines[i]!.text) : null;
        if (m) {
          char = m[1].toLowerCase();
          via = 'saving';
          break;
        }
      }
    }
    // Typed name: a logged one-word command between the last Name: prompt
    // and the login line (auto-login sends the name without logging it)
    let typed = false;
    const prevLogin = k > 0 ? starts[k - 1] : -1;
    for (let i = i0 - 1; i > prevLogin; i--) {
      const l = lines[i];
      if (!l) continue;
      if (NAME_PROMPT_RE.test(l.text)) {
        for (let j = i + 1; j < i0; j++) {
          const c = lines[j] ? /^>> (\S+)\s*$/.exec(lines[j]!.text) : null;
          if (c && (!char || c[1].toLowerCase() === char)) typed = true;
        }
        break;
      }
    }
    out.push({ index: i0, char, via, typed });
  }
  return out;
}
