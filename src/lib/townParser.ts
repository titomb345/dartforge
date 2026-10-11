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
 * Validated against 340k room blocks in 5 years of MUSHclient logs (the live
 * line format: whole lines, blank lines kept): 99.996% of exits lines yield
 * a block, and the output is identical with blank lines removed (the
 * DartForge session logger drops them). Feed lines from OutputFilter's
 * onMapLine callback — the same untrimmed feed the hex RoomParser uses. This
 * parser is a parallel module: it never touches the hex engine.
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
  /**
   * Each door's noun, per direction, as the exits line prints it — "door",
   * "gate", "doors", "trapdoor", "curtain", "hatch", "grate", "gates",
   * "closet" (every noun in both corpora). DartMUD's door commands name it:
   * "open s gate", "close u trapdoor" ("door" does not find a gate).
   */
  doorNouns: Partial<Record<TownDir, string>>;
  /**
   * Non-directional exits, sorted: every exit the line lists that is not a
   * direction — "out", "back", "exit", "in", "path", "hole", "pool",
   * "ocean", "mudschool", ... and the target of a door onto one ("a closed
   * curtain leading backroom"). Typed bare, each word walks that exit.
   */
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

/**
 * Direction words -> TownDir. Looked up with raw player input
 * (classifyTownCommand, the door-close tracking), so the table has no
 * prototype: as a plain object it also answered the names every object
 * inherits — "constructor" was queued as a move in direction Object, and in a
 * room listing no exits the next block threw placing its destination.
 */
export const TOWN_DIR_ALIASES: Record<string, TownDir> = Object.assign(
  Object.create(null) as Record<string, TownDir>,
  {
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
  } satisfies Record<string, TownDir>
);

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

/**
 * Exits line — printed by town/dungeon rooms, never by wilderness hexes.
 * Rooms without an exit print "There are no obvious exits." (the spirit
 * plane's Arena, climbing spots like the Rift and "A ledge": 4,095 MUSH /
 * 21 DF lines) — still a room block. Unrecognized, those rooms vanished and
 * the move into them stayed queued: the Arena's "n" claimed the Dressing
 * Room the arena later returned the player to (a false link walks then
 * followed 10 times).
 */
const EXITS_START_RE =
  /^(?:> )*There (?:is one obvious exit:|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits:|are no obvious exits\.)/;
const NO_EXITS_RE = /^(?:> )*There are no obvious exits\./;

/**
 * Portal transit — "You step into the north portal." (hub side, direction
 * named) or "You step into the portal." (spoke side); into/through and an
 * optional adjective cover mage-portal variants. Portals teleport between
 * distant towns; the owner must call TownLocalizer.onPortalTransit when
 * this line arrives so the arrival room starts a fresh town entry.
 * (Teleports with unknown messages — recall spells — are caught by the
 * localizer's generic teleport heuristic instead.)
 */
/** Captures the portal word ("north", "shimmering", ...) when present —
 *  hub-side transits name their portal by direction, which identifies the
 *  destination (see portal destination memory in townMap.ts). */
export const PORTAL_TRANSIT_RE = /^(?:> )*You step (?:into|through) the(?: (\w+))? portal\.\s*$/;

/**
 * Teleports that are not portals — the owner calls TownLocalizer.onTeleport
 * when this line arrives, before the arrival room's block:
 *  - `plane shift` between a city's OOC Entrance and the OOC Entry Hall:
 *    "Your body becomes insubstantial.  Red and green lights swirl around
 *    you ..." (546 MUSH / 22 DF lines; one line on the way in, wrapped at 80
 *    columns on the way back — the regex reads only the first sentence).
 *    Every one is followed by the hall (273) or a city OOC Entrance (273).
 *    Unrecognized, the arrival was an unexplained block: the OOC realm was
 *    filed as floaters inside whichever city the player shifted from (Bill's
 *    live save: a 6-room OOC Area component in Eris; the corpus replay: 6
 *    OOC rooms glued into Eris, 11 into Soriktos).
 *  - the warriors' temple pools, Sanctum <-> Cave of Spirits, both ways with
 *    the same line ("enter pool": 8 DF / 46 MUSH). Only the success line
 *    counts: the failure, "... trying to take you elsewhere, but something
 *    seems unreceptive on the other end." (4 MUSH), leaves the player where
 *    they stand.
 * Deliberately absent: the arena's "You feel reality bend around you as you
 * are taken bodily to the spirit plane." — its way back ("You are
 * transported back to the mortal plane.") lands in the Dressing Room, not
 * where the player left, so return memory cannot place it, and a fresh
 * entry there splits the temple (measured with both lines as teleports: a
 * duplicate Dressing Room, one more glued town, two more merges); and
 * scroll casts ("the spell is unleashed!" ends EVERY scroll, 472 corpus
 * hits, teleport or not).
 */
export const TELEPORT_TRANSIT_RE =
  /^(?:> )*(?:Your body becomes insubstantial\.|You step into the pool and feel power well up from deep within the ground, taking you elsewhere!)/;

/**
 * Forced movement — a group leader moved the player: "Esira leads you up.",
 * "Arthur leads you enter clearing.", "Rikter leads you off to the west"
 * (the one form without a period). Captures the move as a command ("up",
 * "enter clearing", "path"); the owner hands it to
 * TownLocalizer.onForcedMove. All 3,666 "leads you" lines of both corpora
 * have this shape (every direction, u/d, "enter <thing>", exit words). The
 * hex parser's FORCED_MOVE_RE keeps its own hex-direction-only pattern.
 * Leaders are capitalized names: a lowercase NPC ("The guard leads you
 * north.") is not matched — none occurs in five years of logs.
 */
export const TOWN_FORCED_MOVE_RE =
  /^(?:> )*[A-Z][\w']*(?: [A-Z][\w']*)? leads you (?:off to the )?([a-z][a-z ]*?)\.?\s*$/;

/**
 * Dark arrival — in an unlit room DartMUD prints "It is pitch black."
 * (often followed by the room's night prose: "The odors of the day have
 * faded ...") INSTEAD of the room block. The owner calls
 * TownLocalizer.onDarkArrival: the move happened, but no block will say
 * where it led. Never part of a room block — 0 of the 1,631 MUSH / 10 DF
 * lines that start with it sit inside one.
 */
export const TOWN_DARK_RE = /^(?:> )*It is pitch black\./;

/**
 * DartMUD's reply to a command it could not carry out as typed: a bare
 * "What ?" (unknown verb, or a verb whose object isn't here) or
 * "<Verb> what?" — the verb is captured ("Enter", "Leave", "Climb", ...).
 * This is how named moves FAIL: "enter portal" outside a portal room, "out"
 * from a room with no out, "enter" with nothing to enter ("Enter what?": 28
 * DF / 492 MUSH lines). No movement-failure pattern ever covered them, so
 * the dead named move sat at the queue head and claimed the NEXT room
 * block: Bill's `port` alias (activate + enter portal) left "Market -[enter
 * portal]-> Wharf Street" and two more such links in his live save. Most of
 * these replies answer ordinary commands, though (typos, "Read what?",
 * "Unlock what?" — 1,412 "What ?" lines in the DF corpus), so the owner
 * hands every match to TownLocalizer.onUnknownCommand, which attributes it
 * in command order.
 */
export const UNKNOWN_COMMAND_RE = /^(?:> )*(?:What \?|([A-Z][a-z]+) what\?)\s*$/;

const DIR_WORD_RE = /\b(north(?:east|west)?|south(?:east|west)?|east|west|up|down)\b/g;

/**
 * The non-directional exits the rules that judge a room by a MISSING word
 * keep to (the load cleanse, the dead-named-move repair): typed bare, "out"
 * / "back" / "exit" lead somewhere only from a room whose exits line names
 * them — a room that lists none of them answers "What ?". (Other named moves
 * — "enter pool", "climb branch" — name objects the exits line never
 * mentions.) The parser lists every exit word since Oct 2026, but rooms
 * saved before then carry only these three, and other words come and go
 * with the room ("move mat" uncovers Syphe's "hole":
 * session_2026-07-25T20-28-24-529.log:2138-2147) — a missing one proves
 * nothing.
 */
export const LISTED_NAMED_EXITS: ReadonlySet<string> = new Set(['back', 'out', 'exit']);
const NAMED_EXIT_RE = new RegExp(`\\b(${[...LISTED_NAMED_EXITS].join('|')})\\b`, 'g');

/** Lines that can never be a room name or description member */
const NOISE_RE =
  /^(?:>> |\* |\*\*|< |\[|You gaze|Held:|Worn:|Concentration|Encumbrance|Movement:|Aura:|Needs:)/;

/** Max continuation lines an exits sentence may wrap onto (the corpus
 *  maximum is 4, plus the stray blank line the server's wrapper sometimes
 *  emits inside one) */
const MAX_EXITS_WRAP = 6;
/** Max non-blank lines scanned backward for the room name (a 15-line
 *  Garden description outran the old 14) */
const MAX_NAME_SCAN = 20;
/** Rolling history size for the backward name scan: blank lines are never
 *  kept, and the scan reads at most MAX_NAME_SCAN lines back (nameLineAbove
 *  included), so a longer history would never be read */
const HISTORY = MAX_NAME_SCAN;

// ---------------------------------------------------------------------------
// Exits parsing
// ---------------------------------------------------------------------------

/** The exits line's count word ("There are four exits:"); "many" (always
 *  7+) carries no count */
const EXIT_COUNT: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Directions as an exits list names them: always spelled out in full */
const EXIT_DIR_WORDS: ReadonlySet<string> = new Set([
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
 * A door item of an exits list: "<a|an|the> <open|closed> <description>
 * leading <target>" — "a closed oak door leading west", "an open set of
 * oaken double doors leading north", "an open stone door leading building"
 * (a door onto a NAMED exit). Groups: state, description (its last word is
 * the door's noun), target. Every one of the 206,693 door items in both
 * corpora has this shape, always with an explicit state; a missing one
 * reads as closed (the walker then runs the full door sequence — the safe
 * side).
 */
const EXIT_DOOR_ITEM_RE = /^(?:an?|the) (?:(open|closed) )?(.+?) leading ([a-z]+)$/;

/** An exits-list item: a bare word (a direction or a named exit like
 *  "path") or a door phrase */
function isExitItem(item: string): boolean {
  return /^[a-z]+$/.test(item) || EXIT_DOOR_ITEM_RE.test(item);
}

/**
 * Split an exits list by DartMUD's list grammar — "A", "A and B", "A, B,
 * and C" — into its items, or null when the text doesn't fit the grammar:
 * a capture cut short or garbled (session-log fragments: "a closed oak door
 * leadin g west"), or an item count that disagrees with the count word.
 * A two-item list joins with a bare " and ", which also occurs INSIDE an
 * item ("a closed pair of oak doors leading west and east"), so the split
 * point is the first " and " that leaves two valid items: here a door WEST
 * plus a plain exit EAST. A door phrase names exactly one target — when
 * both exits are doors the phrase is repeated ("an open steel trapdoor
 * leading up and an open iron trapdoor leading down") — and the neighbours
 * agree: the Assembly Hall's east is the Messhall, whose plain "west"
 * leads back (session_2026-07-07T02-57-52-521.log:158-169), and all 470
 * corpus walks through an exit the two readings disagree on find the far
 * side agreeing with this one.
 */
function splitExitItems(body: string, count: number | undefined): string[] | null {
  let items: string[];
  if (count === 1) {
    items = [body];
  } else if (body.includes(', ')) {
    items = body.split(/,\s+/);
    const last = items.length - 1;
    if (items[last].startsWith('and ')) items[last] = items[last].slice(4);
  } else {
    items = [body];
    for (let i = body.indexOf(' and '); i >= 0; i = body.indexOf(' and ', i + 1)) {
      const a = body.slice(0, i);
      const b = body.slice(i + 5);
      if (isExitItem(a) && isExitItem(b)) {
        items = [a, b];
        break;
      }
    }
  }
  if (count !== undefined && items.length !== count) return null;
  return items.every(isExitItem) ? items : null;
}

/**
 * Parse an exits sentence. DartMUD prints it as a list whose every item is
 * a direction, a named exit or a door phrase, each door with its OWN state
 * and noun — all 340,398 MUSH and 22,242 of 22,254 DartForge sentences
 * itemize exactly (the 12 others are session-log fragments). The old
 * single-regex parse captured across the list's bare "and", so "a closed
 * pair of oak doors leading west and east" flagged BOTH exits as doors
 * (13,463 MUSH / 1,530 DF room blocks: phantom door ticks, and the town walk
 * fired a full unlock/open/close/lock sequence at the Assembly Hall's plain
 * east exit), gave every door the first door's open/closed state (the walk
 * closed and locked Felora's shop door it had found open, and walked
 * straight into the Byre's closed iron gate), and knew only back/out/exit
 * as named exits. Text that doesn't fit the grammar falls back to that
 * loose parse, minus its two door bugs.
 */
export function parseTownExits(sentence: string): TownExits {
  if (NO_EXITS_RE.test(sentence)) {
    return { dirs: [], doorDirs: [], openDoorDirs: [], doorNouns: {}, named: [], raw: '' };
  }
  const body = sentence
    .replace(/^.*?:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const countWord = /There (?:is (one) obvious exit|are (\w+) exits)/.exec(sentence);
  const count = countWord ? EXIT_COUNT[countWord[1] ?? countWord[2]] : undefined;
  const items = /\.$/.test(body) ? splitExitItems(body.slice(0, -1).trim(), count) : null;
  if (!items) return parseTownExitsLoose(body);

  const dirs = new Set<TownDir>();
  const doors = new Map<TownDir, { open: boolean; noun: string }>();
  const named = new Set<string>();
  for (const item of items) {
    const door = EXIT_DOOR_ITEM_RE.exec(item);
    const target = door ? door[3] : item;
    const dir = EXIT_DIR_WORDS.has(target) ? TOWN_DIR_ALIASES[target] : undefined;
    if (!dir) {
      named.add(target);
      continue;
    }
    dirs.add(dir);
    if (door) doors.set(dir, { open: door[1] === 'open', noun: door[2].split(' ').pop()! });
  }
  return exitsOf(dirs, doors, named, body);
}

/** Assemble a TownExits (sorted lists; door nouns keyed in direction order) */
function exitsOf(
  dirs: Set<TownDir>,
  doors: Map<TownDir, { open: boolean; noun: string }>,
  named: Set<string>,
  raw: string
): TownExits {
  const doorDirs = [...doors.keys()].sort();
  const doorNouns: Partial<Record<TownDir, string>> = {};
  for (const d of doorDirs) doorNouns[d] = doors.get(d)!.noun;
  return {
    dirs: [...dirs].sort(),
    doorDirs,
    openDoorDirs: doorDirs.filter((d) => doors.get(d)!.open),
    doorNouns,
    named: [...named].sort(),
    raw,
  };
}

/**
 * Fallback for exits text the list grammar can't itemize (a truncated or
 * fragmented capture): every direction word is an exit, back/out/exit are
 * the named ones, and a door is the FIRST direction after a "leading", with
 * the state and noun of its own phrase — the text since the previous comma
 * or "and".
 */
function parseTownExitsLoose(body: string): TownExits {
  const dirs = new Set<TownDir>();
  const doors = new Map<TownDir, { open: boolean; noun: string }>();
  for (const m of body.matchAll(
    /\bleading (north(?:east|west)?|south(?:east|west)?|east|west|up|down)\b/g
  )) {
    const head = body.slice(0, m.index);
    const phrase = head.slice(Math.max(head.lastIndexOf(','), head.lastIndexOf(' and ')) + 1);
    const noun = /([a-z]+)\s*$/.exec(phrase)?.[1] ?? 'door';
    doors.set(TOWN_DIR_ALIASES[m[1]], { open: /\bopen\b/.test(phrase), noun });
  }
  for (const m of body.matchAll(DIR_WORD_RE)) {
    const d = TOWN_DIR_ALIASES[m[1]];
    if (d) dirs.add(d);
  }
  const named = new Set<string>();
  for (const m of body.matchAll(NAMED_EXIT_RE)) named.add(m[1]);
  return exitsOf(dirs, doors, named, body);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type TownParserState = 'idle' | 'in-exits';

/**
 * The OOC Entry Hall appends the player's unread-board notice to its
 * description, framed by blank lines: "Sadly, there are no new notes for
 * you to read." or "There are new notes to read on the following boards:"
 * followed by one 5-space-indented board name per line ("     Important
 * Notices"), then the indented lighting sentence. Corpus: 498 MUSH / 25 DF
 * sightings, the notice never appears anywhere else.
 */
const BOARD_NOTICE_RE =
  /^(?:Sadly, there are no new notes for you to read\.|There are new notes to read on the following boards:)$/;

export class TownParser {
  private history: string[] = [];
  private state: TownParserState = 'idle';
  private exitsText = '';
  private exitsWrap = 0;
  /** Between the OOC Entry Hall's "new notes" header and its lighting line */
  private inBoardList = false;
  private onRoom: (block: TownRoomBlock) => void;

  constructor(onRoom: (block: TownRoomBlock) => void) {
    this.onRoom = onRoom;
  }

  /** Feed an ANSI-stripped line (leading whitespace is fine either way). */
  feedLine(rawLine: string): void {
    const line = rawLine.replace(/[\r\n]+$/, '');
    const t = line.replace(PROMPT_PREFIX, '').trim();
    // Blank lines and bare prompts are transparent. The live feed keeps
    // them (OutputFilter hands every line to onMapLine) while the session
    // logger drops them, and treating a blank as the end of a room block
    // dropped the OOC Entry Hall on every live visit (its notice is
    // blank-framed: 498 of 498 MUSH sightings lost) while the replay saw
    // it fine.
    const blank = /^[>\s]*$/.test(line);

    if (this.state === 'in-exits') {
      // A wrapped exits sentence continues on the next line(s) until it
      // closes with a period. The server's wrapper occasionally emits a
      // stray blank line inside one ("...southeast," / "" / " north, and"):
      // skipped, it no longer truncates the list (dm-2022-02-04.txt:41165
      // lost north and southwest). Bail if a clearly-foreign line interrupts.
      if (
        this.exitsWrap < MAX_EXITS_WRAP &&
        (blank || (!EXITS_START_RE.test(line) && !NOISE_RE.test(t)))
      ) {
        this.exitsWrap++;
        if (blank) return;
        this.exitsText += ' ' + t;
        if (/\.\s*$/.test(this.exitsText)) this.finishExits();
        return;
      }
      // Interrupted — emit what we have (sentence may be truncated)
      this.finishExits();
      // fall through to process this line in idle
    }
    if (blank) return;

    if (EXITS_START_RE.test(line)) {
      this.exitsText = t;
      this.exitsWrap = 0;
      if (/\.\s*$/.test(this.exitsText)) {
        this.finishExits();
      } else {
        this.state = 'in-exits';
      }
      return;
    }

    // The OOC Entry Hall's board notice is dynamic (it lists whichever
    // boards hold unread notes) and not room prose: skipped, with the board
    // names under it. Kept, the backward scan named the hall after the last
    // board ("Important Notices", "Combat", "Chat": 10 of 25 DF visits) and
    // the notice text made every visit's description differ. Only lines
    // INSIDE the list are skipped — the unterminated ones, until the
    // terminated lighting line (or the exits line) ends it — never indented
    // lines elsewhere (1,780 MUSH descriptions open with one). The server
    // indents every board name, but the indentation is not required: a
    // line can reach the parser without it (OutputFilter hands a chunk's
    // whitespace-only tail to the screen only, so "     Chat" split after
    // its spaces arrives as "Chat"; the session logger splits lines at
    // chunk boundaries too), and an unindented board name would have named
    // the hall again. Same output on both corpora either way.
    if (BOARD_NOTICE_RE.test(t)) {
      this.inBoardList = t.startsWith('There are new notes');
      return;
    }
    if (this.inBoardList) {
      if (!/[.!?]$/.test(t)) return;
      this.inBoardList = false;
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
    this.inBoardList = false;
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
   * short, capitalized, with no terminal period — except the rare names that
   * DO end in one ("A circular cave.", "Demonic Ridge - Is this the last
   * one?"), recognized by position: directly above the description's long
   * first line, with no ordinary name line within reach above it. Scanned
   * as description, those names were lost (the Pitfiend caves: 13 of 13
   * sightings in one DF session) or replaced by whatever short line preceded
   * the block — every one of the 55 garbage names the parser produced in
   * five years of MUSH logs (speech, "It contains:", who-list rows,
   * "Autosaving character...Ok", peek lines).
   */
  private scanName(): { name: string; descLines: string[] } | null {
    const desc: string[] = [];
    for (
      let i = this.history.length - 1, steps = 0;
      i >= 0 && steps < MAX_NAME_SCAN;
      i--, steps++
    ) {
      const t = this.history[i].replace(PROMPT_PREFIX, '').trim();
      switch (classifyScanLine(t)) {
        case 'name':
          return { name: t, descLines: desc };
        case 'prose':
          desc.unshift(t);
          break;
        case 'desc':
          if (
            desc.length > 0 &&
            isTerminalNameShape(t) &&
            desc[0].length >= 55 &&
            /^[A-Z]/.test(desc[0]) &&
            !this.nameLineAbove(i, MAX_NAME_SCAN - steps - 1)
          ) {
            return { name: t, descLines: desc };
          }
          desc.unshift(t);
          break;
        default:
          return null; // noise, foreign, fragment: not this room's block
      }
    }
    return null;
  }

  /**
   * Would the scan, continuing above history[i] with its remaining budget,
   * still reach an ordinary name line? Then history[i] is a short closing
   * sentence of a multi-paragraph description, not the block's own name:
   * without this check every MUSH sighting of the Pawn Shop (53) was named
   * "Buy Most Everything - Sell Most Anything.", the sign line above its
   * "To see what's for sale, <list>." paragraph.
   */
  private nameLineAbove(i: number, budget: number): boolean {
    for (let j = i - 1; j >= 0 && budget > 0; j--, budget--) {
      const kind = classifyScanLine(this.history[j].replace(PROMPT_PREFIX, '').trim());
      if (kind === 'desc' || kind === 'prose') continue;
      return kind === 'name';
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Name-scan line classes
// ---------------------------------------------------------------------------

type ScanLineKind =
  /** status/echo lines: never part of a room block */
  | 'noise'
  /** speech, who-list rows, client/system messages: never part of a room block */
  | 'foreign'
  /** short lowercase/symbol-led text: a mid-sentence slice, not a name */
  | 'fragment'
  /** short and unterminated, but description prose */
  | 'prose'
  /** an ordinary room-name line */
  | 'name'
  /** wrapped prose (long) or a sentence-terminal line */
  | 'desc';

/**
 * Short unterminated lines that are never a room name (none in five years
 * of logs is): speech ends in a quote ("Moirai asks in common, 'Ro
 * please?'"), who-list rows pad their columns ("Verite the troll   Online"),
 * "Label: value" echoes ("Movement mode: WALKING", peeks "Name: short desc
 * < n s u >"), party-formation rows ("Row 3:Moirai"), "Autosaving
 * character...Ok". A colon counts only before a space (a line ENDING in one
 * is a list intro, classified first), so a colon inside a word no longer
 * rejects a name; the formation rows are matched by their own shape.
 */
const FOREIGN_LINE_RE = /'$|\S {3,}\S|:\s|^Row \d+:|\.\.\.|< (?:\w+ )+>$/;

/** Classify one prompt-stripped, trimmed history line for the name scan */
function classifyScanLine(t: string): ScanLineKind {
  if (NOISE_RE.test(t)) return 'noise';
  if (t.length >= 55 || /[.!?"]$/.test(t)) return 'desc';
  // Short and unterminated from here on. A list introduction belongs to the
  // description ("You are in the OOC post office.  Commands:" — the post
  // office block was lost on every visit)
  if (/:$/.test(t)) return 'prose';
  if (FOREIGN_LINE_RE.test(t)) return 'foreign';
  // Two sentences on one short line are description prose whatever the
  // first letter ("bright.  There is an ashtray on the counter")
  if (/[a-z][.!?] +[A-Z]/.test(t)) return 'prose';
  if (t.length < 3 || !/^[A-Z0-9"']/.test(t)) return 'fragment';
  // Fragmented streams can slice a description/contents sentence so its
  // tail lands on its own short line ("There is an oak chest in the
  // opposite corner.  It"), and some descriptions carry an unterminated
  // sentence of their own (The Smoking Weed: "There is an ashtray on the
  // counter", 13 of its 36 MUSH sightings lost) — sentence-shaped starts and
  // dangling function-word endings are prose, never room names. Capitalized
  // articles are NOT in the trailing list: "Pier A" / "Cell Block A" are
  // legitimate names, while mid-sentence truncation dangles pronouns or
  // lowercase function words.
  if (/^(?:There (?:is|are)|You )\b/.test(t)) return 'prose';
  if (/\b(?:It|He|She|They|and|or|of|to|with|in|on|at|is|are|was|from|by|the|a|an)$/.test(t))
    return 'prose';
  return 'name';
}

/** Could this sentence-terminal line be a room name? One short sentence,
 *  capitalized, not speech or a "You ..." / "It is ..." message. */
function isTerminalNameShape(t: string): boolean {
  return (
    t.length >= 3 &&
    t.length < 55 &&
    /^[A-Z]/.test(t) &&
    /[^.!?][.!?]$/.test(t) &&
    !/[.!?]['")\]]?\s/.test(t) &&
    !/['"]/.test(t) &&
    !/^(?:You|Your|There (?:is|are)|It (?:is|was))\b/.test(t)
  );
}
