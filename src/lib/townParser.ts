/**
 * Town room parser — detects DartMUD town/building room blocks.
 *
 * Towns are room-based (not hexes). A room block looks like:
 *
 *   Vestibule
 *   This is a small vestibule leading to the bedrooms on the south side of
 *   this floor.  ...  It is bright.
 *   There are four exits: north, a closed oak door leading west, a closed
 *   oak door leading south, and an open oak door leading east.
 *
 * The exits line is the anchor (wilderness hexes never print one). It wraps
 * at 80 columns, so continuation lines are joined until the sentence ends.
 * The room name is found by scanning BACKWARD from the exits line over the
 * description: description lines are long (~80 cols) or end with terminal
 * punctuation; the name line is short with no terminal period.
 *
 * This grammar was validated against 340k room blocks in 5 years of logs
 * (99.75% name-found rate). Feed lines from OutputFilter's onMapLine
 * callback — the same untrimmed feed the hex RoomParser uses. This parser
 * is a parallel module: it never touches the hex engine.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TownExits {
  /** Short direction codes present in the exits line, sorted (n,s,e,w,u,d,ne,...) */
  dirs: TownDir[];
  /** Directions reached through a door/gate ("a closed oak door leading west") */
  doorDirs: TownDir[];
  /** Doors currently standing open ("an open oak door leading east") */
  openDoorDirs: TownDir[];
  /** Non-directional exits ("back", "out", "exit") */
  named: string[];
  /** Raw exits sentence body (after the colon), for tooltips */
  raw: string;
}

export interface TownRoomBlock {
  name: string;
  /** First description line (stable-ish fingerprint component) */
  descFirst: string;
  /** Joined description (may embed dynamic content — display only) */
  desc: string;
  exits: TownExits;
}

export type TownDir = 'n' | 's' | 'e' | 'w' | 'u' | 'd' | 'ne' | 'nw' | 'se' | 'sw';

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

export const TOWN_DIR_ALIASES: Record<string, TownDir> = {
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

export const TOWN_REVERSE: Record<TownDir, TownDir> = {
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

/**
 * Grid vectors for CARDINAL directions and up/down only. Corpus-validated:
 * diagonal town exits do NOT compose like vectors (sw ≠ s+w) — they are
 * graph shortcuts and must never constrain grid placement.
 */
export const TOWN_DIR_VEC: Partial<Record<TownDir, [number, number, number]>> = {
  n: [0, -1, 0],
  s: [0, 1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
  u: [0, 0, 1],
  d: [0, 0, -1],
};

export function isTownGridDir(dir: TownDir): boolean {
  return dir in TOWN_DIR_VEC;
}

/** Full names for user-facing messages and sent commands */
export const TOWN_DIR_COMMAND: Record<TownDir, string> = {
  n: 'n',
  s: 's',
  e: 'e',
  w: 'w',
  u: 'u',
  d: 'd',
  ne: 'ne',
  nw: 'nw',
  se: 'se',
  sw: 'sw',
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PROMPT_PREFIX = /^(?:> )+/;

/** Exits line — printed by town/dungeon rooms, never by wilderness hexes */
const EXITS_START_RE =
  /^(?:> )*There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits):/;

/**
 * Portal transit — "You step into the north portal." (hub side, direction
 * named) or "You step into the portal." (spoke side); into/through and an
 * optional adjective cover mage-portal variants. Portals teleport between
 * distant towns; the owner must call TownLocalizer.onPortalTransit when
 * this line arrives so the arrival room starts a fresh town entry.
 * (Teleports with unknown messages — recall spells — are caught by the
 * localizer's generic teleport heuristic instead.)
 */
export const PORTAL_TRANSIT_RE = /^(?:> )*You step (?:into|through) the(?: \w+)? portal\.\s*$/;

const DIR_WORD_RE = /\b(north(?:east|west)?|south(?:east|west)?|east|west|up|down)\b/g;

/** Non-directional exit keywords seen in the corpus ("back and south", "exit and a closed hatch") */
const NAMED_EXIT_RE = /\b(back|out|exit)\b/g;

/** Lines that can never be a room name or description member */
const NOISE_RE =
  /^(?:>> |\* |\*\*|< |\[|You gaze|Held:|Worn:|Concentration|Encumbrance|Movement:|Aura:|Needs:)/;

/** Max continuation lines an exits sentence may wrap onto */
const MAX_EXITS_WRAP = 4;
/** Max lines scanned backward for the room name */
const MAX_NAME_SCAN = 14;
/** Rolling history size for the backward name scan */
const HISTORY = 20;

// ---------------------------------------------------------------------------
// Exits parsing
// ---------------------------------------------------------------------------

export function parseTownExits(sentence: string): TownExits {
  const body = sentence
    .replace(/^.*?:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const dirs = new Set<TownDir>();
  const doorDirs = new Set<TownDir>();
  const openDoorDirs = new Set<TownDir>();

  // Door/gate phrases name their directions after "leading": mark those dirs.
  // "a closed pair of oak doors leading west and east" → doors west+east.
  for (const m of body.matchAll(/\bleading ([a-z, and]+?)(?=[,.]|$)/g)) {
    for (const w of m[1].split(/[^a-z]+/)) {
      const d = TOWN_DIR_ALIASES[w];
      if (d) doorDirs.add(d);
    }
  }
  // Doors standing open ("an open oak door leading east") — the state word
  // sits earlier in the same comma-separated phrase as its "leading" dirs.
  // Phrases without an "open" (closed doors, bare gates) default to closed.
  for (const m of body.matchAll(/\bopen\b[^,.]*?\bleading ([a-z, and]+?)(?=[,.]|$)/g)) {
    for (const w of m[1].split(/[^a-z]+/)) {
      const d = TOWN_DIR_ALIASES[w];
      if (d) openDoorDirs.add(d);
    }
  }
  for (const m of body.matchAll(DIR_WORD_RE)) {
    const d = TOWN_DIR_ALIASES[m[1]];
    if (d) dirs.add(d);
  }
  const named = new Set<string>();
  for (const m of body.matchAll(NAMED_EXIT_RE)) named.add(m[1]);

  return {
    dirs: [...dirs].sort(),
    doorDirs: [...doorDirs].sort(),
    openDoorDirs: [...openDoorDirs].sort(),
    named: [...named].sort(),
    raw: body,
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type TownParserState = 'idle' | 'in-exits';

export class TownParser {
  private history: string[] = [];
  private state: TownParserState = 'idle';
  private exitsText = '';
  private exitsWrap = 0;
  private onRoom: (block: TownRoomBlock) => void;

  constructor(onRoom: (block: TownRoomBlock) => void) {
    this.onRoom = onRoom;
  }

  /** Feed an ANSI-stripped line (leading whitespace is fine either way). */
  feedLine(rawLine: string): void {
    const line = rawLine.replace(/[\r\n]+$/, '');

    if (this.state === 'in-exits') {
      const t = line.replace(PROMPT_PREFIX, '').trim();
      // A wrapped exits sentence continues on the next line(s) until it
      // closes with a period. Bail if a clearly-foreign line interrupts.
      if (t && !EXITS_START_RE.test(line) && !NOISE_RE.test(t) && this.exitsWrap < MAX_EXITS_WRAP) {
        this.exitsText += ' ' + t;
        this.exitsWrap++;
        if (/\.\s*$/.test(this.exitsText)) this.finishExits();
        return;
      }
      // Interrupted — emit what we have (sentence may be truncated)
      this.finishExits();
      // fall through to process this line in idle
    }

    const stripped = line.replace(PROMPT_PREFIX, '');
    if (EXITS_START_RE.test(line)) {
      this.exitsText = stripped.trim();
      this.exitsWrap = 0;
      if (/\.\s*$/.test(this.exitsText)) {
        this.finishExits();
      } else {
        this.state = 'in-exits';
      }
      return;
    }

    this.history.push(line);
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** True while a wrapped exits sentence is still being collected. */
  hasPending(): boolean {
    return this.state === 'in-exits';
  }

  /** Flush a wrapped exits sentence that never completed (stream idle). */
  flushPending(): void {
    if (this.state === 'in-exits') this.finishExits();
  }

  private finishExits(): void {
    this.state = 'idle';
    const text = this.exitsText;
    this.exitsText = '';
    const found = this.scanName();
    // Room blocks end at their exits line — the history before it belongs
    // to this room; clear so the next block can't bleed into stale lines.
    this.history = [];
    if (!found) return;
    this.onRoom({
      name: found.name,
      descFirst: found.descLines[0] ?? '',
      desc: found.descLines.join(' ').slice(0, 600),
      exits: parseTownExits(text),
    });
  }

  /**
   * Backward scan over the history for the room name. Description lines are
   * long (>=55 chars) or end with terminal punctuation; the name line is
   * short, capitalized, with no terminal period.
   */
  private scanName(): { name: string; descLines: string[] } | null {
    const desc: string[] = [];
    for (
      let i = this.history.length - 1, steps = 0;
      i >= 0 && steps < MAX_NAME_SCAN;
      i--, steps++
    ) {
      const t = this.history[i].replace(PROMPT_PREFIX, '').trim();
      if (!t) return null; // blank inside a block → not a room block
      if (NOISE_RE.test(t)) return null;
      const endsSentence = /[.!?"]$/.test(t);
      if (t.length < 55 && !endsSentence) {
        // Candidate name line. Capitalized start filters mid-sentence
        // fragments; length guards against stray tokens.
        if (t.length < 3 || t.length > 60 || !/^[A-Z0-9"']/.test(t)) return null;
        return { name: t, descLines: desc };
      }
      desc.unshift(t);
    }
    return null;
  }
}
