/**
 * FIFO alignment of DF session commands with the room blocks they produced
 * — the same model the live localizer uses (one tracked move consumes one
 * block; move-failure lines pop the oldest move; moves expire after 20s),
 * but tuned for PRECISION instead of coverage: an edge is only emitted when
 * the departure room's exits list the direction AND the arrival room's
 * exits list the way back (or offer named exits). Anything ambiguous
 * breaks the chain instead of guessing.
 *
 * Every edge carries a CHAIN id: consecutive edges with the same chain id
 * form one physically continuous walk (no survey, portal, login, forced
 * move or unexplained block in between). Chains are what places are built
 * from — a walk cannot jump between cities, while a text class can (the
 * same generic room text exists in several cities).
 *
 * Also emits same-room evidence pairs:
 *  - 'look'   : a block consumed by a queued look (re-print of the room)
 *  - 'resume' : the first block after a login vs the last block before it
 *               (DartMUD resumes you where you logged out — the same room
 *               seen at a different time of day)
 */

export type Move =
  | { kind: 'dir'; dir: string; t: number }
  | { kind: 'named'; cmd: string; t: number }
  | { kind: 'look'; t: number };

const DIRS: Record<string, string> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  u: 'u',
  up: 'u',
  d: 'd',
  down: 'd',
  ne: 'ne',
  northeast: 'ne',
  nw: 'nw',
  northwest: 'nw',
  se: 'se',
  southeast: 'se',
  sw: 'sw',
  southwest: 'sw',
};
export const REV: Record<string, string> = {
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
const NAMED_WORDS = new Set(['enter', 'board', 'exit', 'out', 'leave', 'back', 'disembark']);
const PREFIX_WORDS = new Set(['go', 'sneak', 'climb', 'lead', 'swim', 'row']);

export function classifyCommand(command: string, t: number): Move | null {
  const c = command.trim().toLowerCase();
  if (!c) return null;
  if (c === 'l' || c === 'look' || c === 'lo') return { kind: 'look', t };
  if (DIRS[c]) return { kind: 'dir', dir: DIRS[c], t };
  const sp = c.indexOf(' ');
  const first = sp > 0 ? c.slice(0, sp) : c;
  if (sp > 0 && PREFIX_WORDS.has(first)) {
    const d = DIRS[c.slice(sp + 1).trim()];
    if (d) return { kind: 'dir', dir: d, t };
  }
  if (NAMED_WORDS.has(first)) return { kind: 'named', cmd: c, t };
  return null;
}

export interface BlockInfo {
  v: number;
  dirs: string[];
  named: string[];
  /** every non-directional exit name of the room */
  namedAll?: string[];
  group: string;
}

export interface EdgeObs {
  from: number; // variant idx
  to: number;
  move: string; // dir code or 'named:<cmd>'
  conf: 'clean' | 'repaired' | 'named';
  file: string;
  line: number;
  chain: number;
  t: number;
}
export interface SamePair {
  a: number;
  b: number;
  kind: 'look' | 'resume';
  file: string;
  line: number;
}

type Packed = (string | number | boolean | null | string[])[];
const QUEUE_MAX_AGE = 20_000;

export interface AlignCarry {
  prev: number | null;
  loginPending: boolean;
  chain: number;
}

/**
 * Walk one file's packed events. `info(v)` gives the block's exits/group.
 * For MUSH files (no commands) only resume pairs come out.
 */
export function alignFile(
  file: string,
  ev: Packed[],
  info: (v: number) => BlockInfo,
  edges: EdgeObs[],
  same: SamePair[],
  carry: AlignCarry
): void {
  let prev: number | null = carry.prev;
  let loginPending = carry.loginPending;
  let chain = carry.chain + 1; // a new file never continues a walk
  let q: Move[] = [];
  const fits = (from: BlockInfo, dir: string, to: BlockInfo) =>
    from.dirs.includes(dir) && (to.dirs.includes(REV[dir]) || to.named.length > 0);
  const breakChain = () => {
    chain++;
  };

  for (const e of ev) {
    const k = e[0];
    if (k === 'c') {
      const t = e[3] as number;
      for (const c of e[2] as string[]) {
        let m = classifyCommand(c, t);
        // A bare custom exit name of the current room ("hole", "path",
        // "mudschool") moves the player too — the engine misses these.
        const lc = c.trim().toLowerCase();
        if (!m && prev !== null && (info(prev).namedAll ?? []).includes(lc))
          m = { kind: 'named', cmd: lc, t };
        if (m) q.push(m);
      }
      if (q.length > 24) q.splice(0, q.length - 24);
    } else if (k === 'f') {
      const i = q.findIndex((m) => m.kind !== 'look');
      if (i >= 0) q.splice(i, 1);
    } else if (k === 's' || k === 'p' || k === 'F') {
      q = [];
      prev = null;
      breakChain();
    } else if (k === 'L') {
      q = [];
      loginPending = true;
      breakChain();
    } else if (k === 'O') {
      q = [];
      breakChain();
    } else if (k === 'b') {
      const v = e[1] as number;
      const t = e[2] as number;
      const line = e[3] as number;
      while (q.length && t - q[0].t > QUEUE_MAX_AGE) q.shift();
      const cur = info(v);
      if (loginPending) {
        loginPending = false;
        if (prev !== null && info(prev).group === cur.group) {
          same.push({ a: prev, b: v, kind: 'resume', file, line });
        }
        prev = v;
        q = [];
        breakChain();
        continue;
      }
      if (prev === null) {
        prev = v;
        q = [];
        breakChain();
        continue;
      }
      const p = info(prev);
      const head = q[0];
      if (!head) {
        // Unsolicited block: a server re-print (same fingerprint) keeps the
        // walk; anything else is an untracked move/teleport — break.
        if (p.group !== cur.group) breakChain();
        prev = v;
        continue;
      }
      if (head.kind === 'look') {
        q.shift();
        if (p.group === cur.group) same.push({ a: prev, b: v, kind: 'look', file, line });
        else {
          q = []; // misaligned — resync
          breakChain();
        }
        prev = v;
        continue;
      }
      if (head.kind === 'named') {
        q.shift();
        if (/\bportal\b/.test(head.cmd)) {
          // portal travel even when its transit line was missed (teleport
          // pools print their own message → a 'p' event breaks the chain;
          // "enter pool" in the Blue Pearl garden is an ordinary exit)
          breakChain();
          prev = v;
          continue;
        }
        edges.push({
          from: prev,
          to: v,
          move: 'named:' + head.cmd,
          conf: 'named',
          file,
          line,
          chain,
          t,
        });
        prev = v;
        continue;
      }
      // dir move — but an IDENTICAL re-print with a queued look behind the
      // head is the look's output after a silently dead move (accepting it
      // as a move would invent a self-loop between "twins").
      if (v === prev) {
        const li = q.findIndex((m) => m.kind === 'look');
        if (li > 0) {
          q.splice(0, li + 1);
          same.push({ a: prev, b: v, kind: 'look', file, line });
          continue;
        }
      }
      if (fits(p, head.dir, cur)) {
        q.shift();
        edges.push({ from: prev, to: v, move: head.dir, conf: 'clean', file, line, chain, t });
        prev = v;
        continue;
      }
      // Silent failures desync the queue: a LATER dir move that fits (with
      // only dir moves skipped) is the repaired alignment.
      let fixed = -1;
      for (let i = 1; i < q.length; i++) {
        const m = q[i];
        if (m.kind !== 'dir') break;
        if (fits(p, m.dir, cur)) {
          fixed = i;
          break;
        }
      }
      if (fixed > 0) {
        const m = q[fixed] as { dir: string };
        edges.push({ from: prev, to: v, move: m.dir, conf: 'repaired', file, line, chain, t });
        q.splice(0, fixed + 1);
      } else if (p.group === cur.group) {
        q.shift(); // re-print after a dead move — no evidence either way
      } else {
        q = []; // unexplainable — resync
        breakChain();
      }
      prev = v;
    }
  }
  carry.prev = prev;
  carry.loginPending = loginPending;
  carry.chain = chain;
}
