/**
 * Room output parser — detects DartMUD hex wilderness surveys.
 *
 * Hex-only mapper: only parses wilderness hex surveys. Towns/dungeons are
 * ignored ("You gaze at your surroundings." only appears in the wilderness).
 *
 * IMPORTANT: feedLine must receive lines with leading whitespace intact —
 * hex art is column-aligned ASCII and left-trimming destroys it. Use the
 * OutputFilter's onMapLine callback (untrimmed), never the trimmed onLine
 * variant.
 *
 * Corpus facts this parser relies on (validated against 158,914 surveys in
 * 5 years of logs):
 *  - Art blocks are always contiguous — nothing interleaves inside them.
 *  - Only weather one-liners can appear between the gaze line and the art.
 *  - The top border's column encodes the ring count (col = 6R + 2), and a
 *    view with R rings is exactly 8R + 5 lines tall (R = 0, 1, or 2).
 *  - In pitch black there is no gaze line at all; in dim light the art
 *    shrinks to a single hex.
 */

import { isHexArtLine, parseHexArt, type ParsedHexArt } from './hexArtParser';
import { parseDirection, type Direction } from './hexUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoomParserEvent =
  | {
      type: 'survey';
      /** Parsed hex art, or null when no readable art followed the gaze line */
      art: ParsedHexArt | null;
      description: string;
    }
  | {
      type: 'move-failed';
      /** True when the block is physical terrain (worth marking on the map) */
      hard: boolean;
    }
  | {
      type: 'forced-move';
      /** Someone led/dragged the player in this hex direction */
      dir: Direction;
    }
  | {
      /**
       * A non-hex room was entered (towns/caves print an exits line;
       * wilderness hexes never do). Pending hex moves are stale.
       */
      type: 'town-room';
    };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Survey trigger — printed on every wilderness move and manual survey */
const SURVEY_RE = /^(?:> )*You gaze at your surroundings\./;

/** Wilderness description start */
const WILDERNESS_START_RE =
  /^(?:> )*(?:You are (?:in|on|at|standing)|This is (?:a |an |the )|The ground is |A vast |The )/;

/** Health/condition status messages that false-positive on WILDERNESS_START_RE */
const HEALTH_STATUS_RE =
  /^(?:> )*You are (?:in (?:perfect health|good shape|bad shape|terrible shape|(?:very )?(?:poor|rough|awful) shape)|mortally wounded|gravely |seriously |badly |wounded|slightly |barely wounded)/;

/** Lighting sentences that end room descriptions */
const LIGHTING_RE =
  /It is (?:shadowy|dim|bright(?: here)?|painfully bright|blindingly bright|extremely light here|well lit here|dimly lit here|murky here|pitch black|dark here|dark)\./;

/**
 * Movement blocked by PHYSICAL TERRAIN — safe to record as a blocked edge.
 * (Mined from 5 years of logs.)
 */
const MOVE_FAIL_HARD_RE =
  /^(?:> )*(?:There is no exit in that direction\.|You must swim|You (?:can't|cannot) go that way\.|The exit \w+ is blocked!|The (?:shimmering red )?field sparks and (?:pushes you back|blocks you)|A shimmering field blocks your way\.)/;

/**
 * Movement failed for a TRANSIENT reason (mount, posture, exhaustion, NPC
 * blockers, closed doors) — drop the pending move but don't mark the map.
 */
const MOVE_FAIL_SOFT_RE =
  /^(?:> )*(?:The .{1,40} is closed\.|You can't see to move!|You'll have to dismount first\.|You cannot ride (?:indoors|a hitched mount)|Invalid direction to lead to\.|You are not allowed back there|The portcullis is lowered!|[^'"]{1,60} (?:moves to block your (?:way|path)|steps out of the back room and blocks your way)|You have no free hands with which to climb\.|You (?:have to stand|'ll have to get) up first|You are too (?:exhausted|tired)|You're too injured to move\.|You're unconscious!)/;

/** Forced movement: a group leader moves the player */
const FORCED_MOVE_RE =
  /^(?:> )*\w+ leads you (north(?:east|west)?|south(?:east|west)?)\b/;

/** Exits line — printed by town/dungeon rooms, never by wilderness hexes */
const EXITS_LINE_RE =
  /^(?:> )*There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits):/;

/** Lines that are clearly NOT part of a wilderness description */
const NON_WILDERNESS_RE =
  /^(?:> )*(?:There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits):|< .+ >$|Held|Worn|Concentration|Encumbrance|Movement|Aura|Needs|\* |> ?$|\()/;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ParserState = 'idle' | 'awaiting-art' | 'in-art' | 'post-art';

/** Max non-art lines tolerated between the gaze line and the art (weather) */
const MAX_PRE_ART_LINES = 4;
/** Max description lines */
const MAX_DESC_LINES = 12;
/** Max post-art lines to wait for a description before emitting without one */
const MAX_POST_ART_WAIT = 3;

/** Border/structural chars valid in a top border */
const TOP_BORDER_RE = /^[-*cx=]{5}/;

/**
 * If `line` looks like the top border of hex art, return the total expected
 * art line count (8R + 5), else null. The border column encodes ring count.
 */
function expectedArtLines(line: string): number | null {
  const match = line.match(/^( *)([-*cx=]{4,})/);
  if (!match) return null;
  const col = match[1].length;
  if (col < 2 || (col - 2) % 6 !== 0) return null;
  const rings = (col - 2) / 6;
  if (rings > 2) return null;
  return 8 * rings + 5;
}

export class RoomParser {
  private state: ParserState = 'idle';
  private artLines: string[] = [];
  private artExpected: number | null = null;
  private descLines: string[] = [];
  private linesSinceStart = 0;
  private postArtWait = 0;
  private onEvent: (event: RoomParserEvent) => void;

  constructor(onEvent: (event: RoomParserEvent) => void) {
    this.onEvent = onEvent;
  }

  /**
   * Feed an ANSI-stripped line WITH leading whitespace preserved.
   */
  feedLine(rawLine: string): void {
    // Strip trailing CR/LF only — leading whitespace is meaningful in hex art
    const line = rawLine.replace(/[\r\n]+$/, '');
    const trimmed = line.trim();

    switch (this.state) {
      case 'idle':
        this.handleIdle(line);
        break;
      case 'awaiting-art':
        this.handleAwaitingArt(line, trimmed);
        break;
      case 'in-art':
        this.handleInArt(line, trimmed);
        break;
      case 'post-art':
        this.handlePostArt(line, trimmed);
        break;
    }
  }

  private startSurvey(): void {
    this.state = 'awaiting-art';
    this.artLines = [];
    this.artExpected = null;
    this.descLines = [];
    this.linesSinceStart = 0;
    this.postArtWait = 0;
  }

  private handleIdle(line: string): void {
    if (SURVEY_RE.test(line)) {
      this.startSurvey();
      return;
    }
    if (MOVE_FAIL_HARD_RE.test(line)) {
      this.onEvent({ type: 'move-failed', hard: true });
      return;
    }
    if (MOVE_FAIL_SOFT_RE.test(line)) {
      this.onEvent({ type: 'move-failed', hard: false });
      return;
    }
    const forced = FORCED_MOVE_RE.exec(line);
    if (forced) {
      const dir = parseDirection(forced[1]);
      if (dir) this.onEvent({ type: 'forced-move', dir });
      return;
    }
    if (EXITS_LINE_RE.test(line)) {
      this.onEvent({ type: 'town-room' });
    }
  }

  private handleAwaitingArt(line: string, trimmed: string): void {
    // A new gaze while waiting → previous survey had no art (blind)
    if (SURVEY_RE.test(line)) {
      this.onEvent({ type: 'survey', art: null, description: '' });
      this.startSurvey();
      return;
    }

    if (TOP_BORDER_RE.test(trimmed) && isHexArtLine(line)) {
      this.state = 'in-art';
      this.artLines = [line];
      this.artExpected = expectedArtLines(line);
      this.linesSinceStart = 0;
      return;
    }

    this.linesSinceStart++;
    // Tolerate blanks and weather one-liners ("You sweat in the heat.")
    if (this.linesSinceStart <= MAX_PRE_ART_LINES && (!trimmed || trimmed.length < 60)) {
      return;
    }

    // No art is coming — blind survey (mini-map mode or vision oddity)
    this.onEvent({ type: 'survey', art: null, description: '' });
    this.reset();
    // Reprocess this line in idle so move-fail / new gaze lines aren't lost
    this.handleIdle(line);
  }

  private handleInArt(line: string, trimmed: string): void {
    if (SURVEY_RE.test(line)) {
      // Next survey started immediately (spammed movement)
      this.emitSurvey();
      this.startSurvey();
      return;
    }

    // Art blocks are contiguous (corpus-validated): collect until the
    // expected line count is reached. Bail early only on lines that clearly
    // can't be art (blank / description start).
    if (this.artExpected !== null && this.artLines.length < this.artExpected) {
      if (!trimmed) {
        this.finishArt('');
        return;
      }
      if (WILDERNESS_START_RE.test(line) && !HEALTH_STATUS_RE.test(line)) {
        this.finishArt(line);
        return;
      }
      this.artLines.push(line);
      if (this.artLines.length >= this.artExpected) {
        this.finishArt('');
      }
      return;
    }

    // Unknown expected count (unrecognized top border) — heuristic collection
    if (isHexArtLine(line)) {
      if (this.artLines.length > 40) {
        this.finishArt('');
        return;
      }
      this.artLines.push(line);
      return;
    }
    this.finishArt(trimmed ? line : '');
  }

  private finishArt(pendingLine: string): void {
    this.state = 'post-art';
    this.postArtWait = 0;
    this.descLines = [];
    if (pendingLine) {
      this.handlePostArt(pendingLine, pendingLine.trim());
    }
  }

  private handlePostArt(line: string, trimmed: string): void {
    if (SURVEY_RE.test(line)) {
      this.emitSurvey();
      this.startSurvey();
      return;
    }

    if (this.descLines.length === 0) {
      // Waiting for the description to start
      if (
        WILDERNESS_START_RE.test(line) &&
        !HEALTH_STATUS_RE.test(line) &&
        !NON_WILDERNESS_RE.test(line)
      ) {
        this.descLines = [trimmed];
        if (LIGHTING_RE.test(trimmed)) this.emitSurvey();
        return;
      }
      this.postArtWait++;
      if (this.postArtWait >= MAX_POST_ART_WAIT || NON_WILDERNESS_RE.test(line)) {
        this.emitSurvey();
        this.handleIdle(line);
      }
      return;
    }

    // Collecting description lines
    if (!trimmed || NON_WILDERNESS_RE.test(line)) {
      this.emitSurvey();
      if (trimmed) this.handleIdle(line);
      return;
    }

    this.descLines.push(trimmed);

    // Test the lighting terminator against the JOINED description — the MUD
    // wraps at 80 cols, so "It is extremely light\nhere." spans two lines and
    // never matches per-line.
    if (LIGHTING_RE.test(this.descLines.join(' ')) || this.descLines.length >= MAX_DESC_LINES) {
      this.emitSurvey();
    }
  }

  /**
   * True while a survey is mid-collection (art or description). The MUD's
   * trailing prompt has no newline, so a survey whose description lacks a
   * recognizable terminator would otherwise sit unemitted until the NEXT
   * output burst. The owner should call flushPending() after a short idle.
   */
  hasPendingSurvey(): boolean {
    return this.state === 'in-art' || this.state === 'post-art';
  }

  /** Force-emit a mid-collection survey (called after the stream goes idle). */
  flushPending(): void {
    if (this.state === 'post-art') {
      this.emitSurvey();
    } else if (this.state === 'in-art') {
      if (this.artLines.length >= 5) this.emitSurvey();
      else this.reset();
    }
  }

  private emitSurvey(): void {
    const art = this.artLines.length >= 5 ? parseHexArt(this.artLines) : null;
    const description = this.descLines.join(' ');
    this.onEvent({ type: 'survey', art, description });
    this.reset();
  }

  private reset(): void {
    this.state = 'idle';
    this.artLines = [];
    this.artExpected = null;
    this.descLines = [];
    this.linesSinceStart = 0;
    this.postArtWait = 0;
  }
}
