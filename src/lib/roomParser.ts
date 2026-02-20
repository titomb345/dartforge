/**
 * Room output parser — state machine that parses DartMUD room descriptions.
 *
 * Formats handled:
 *
 * 1. Verbose indoor:
 *    <Room Name>
 *    <Description...> It is <lighting>.
 *    There {is one obvious exit|are <N> exits}: <exit list>.
 *    [items on ground]
 *    [NPCs]
 *
 * 2. Brief indoor:
 *    <Room Name>: <short description>
 *    < <space-separated exits> >
 *
 * 3. Wilderness (no name, no exits line):
 *    <Description starting with "You are in" or "This is a">
 *    [landmarks, creatures]
 */

import { type Direction, parseDirection } from './hexUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedRoom {
  name: string;
  brief: string;             // brief description or first line of verbose
  exitDirections: Direction[];
  namedExits: string[];       // non-compass exits (e.g. "path", "door")
  terrain: 'indoor' | 'wilderness' | 'unknown';
  isBrief: boolean;
}

export type RoomParserEvent =
  | { type: 'room'; room: ParsedRoom }
  | { type: 'move-failed' }
  | { type: 'look' };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Lighting sentences that end room descriptions */
const LIGHTING_RE = /It is (?:shadowy|dim|bright|painfully bright|blindingly bright|extremely light here|well lit here|pitch black|dark here|dark)\./;

/** Exit line start (may span multiple lines) */
const EXIT_START_RE = /^(?:> )*There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits): (.+)/;

/** Brief mode: "Room Name: short description" */
const BRIEF_ROOM_RE = /^(?:> )*(.+?): (.+)$/;

/** Brief mode exits: "< n e sw >" */
const BRIEF_EXITS_RE = /^(?:> )*< (.+) >$/;

/** Wilderness room starts */
const WILDERNESS_START_RE = /^(?:> )*(?:You are (?:in|on|at|standing)|This is (?:a |an |the )|The ground is |A |The )/;

/** Room name line — a line that is NOT a description start, status line, or prompt */
const ROOM_NAME_EXCLUSIONS = /^(?:> )*(?:You |There |This |The |A |An |It is |Your |Held|Worn|Concentration|Encumbrance|Movement|Aura|Needs|\* |> $|\(|$)/;

/** Failed movement messages */
const MOVE_FAIL_RE = /^(?:> )*(?:There is no exit in that direction\.|The .+ is closed\.|You (?:can't|cannot) go that way\.|You can't see to move!)/;

/** Look command (re-display without movement) — reserved for future use */
// const LOOK_RE = /^(?:> )*(?:You see nothing special\.|You look around\.)/;

// Direction words that can appear in exit descriptions
const DIRECTION_WORDS = new Set([
  'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest',
  'up', 'down',
]);

// ---------------------------------------------------------------------------
// Exit text parsing
// ---------------------------------------------------------------------------

/**
 * Parse exit directions from the exit line text.
 * Handles both simple compass ("north, east") and door/gate descriptions
 * ("a closed oak door leading west").
 */
function parseExitText(text: string): { directions: Direction[]; named: string[] } {
  const directions: Direction[] = [];
  const named: string[] = [];

  // Remove trailing period
  const cleaned = text.replace(/\.\s*$/, '');

  // Split on commas and "and"
  const parts = cleaned.split(/,\s*|\s+and\s+/).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    // Try direct direction match first
    const words = part.toLowerCase().split(/\s+/);
    let foundDirection = false;

    // Check if the part is just a direction word
    if (words.length === 1) {
      const dir = parseDirection(words[0]);
      if (dir) {
        directions.push(dir);
        foundDirection = true;
      }
    }

    // Check for "leading <direction>" pattern (door/gate descriptions)
    if (!foundDirection) {
      const leadingMatch = part.match(/leading\s+(north(?:east|west)?|south(?:east|west)?|east|west|up|down)/i);
      if (leadingMatch) {
        const dir = parseDirection(leadingMatch[1]);
        if (dir) {
          directions.push(dir);
          foundDirection = true;
        }
      }
    }

    // Check each word for a direction (fallback for odd formats)
    if (!foundDirection) {
      for (const word of words) {
        if (DIRECTION_WORDS.has(word)) {
          const dir = parseDirection(word);
          if (dir) {
            directions.push(dir);
            foundDirection = true;
            break;
          }
        }
      }
    }

    // Non-compass named exit (e.g. "path", "out", "hole")
    if (!foundDirection) {
      named.push(part);
    }
  }

  return { directions, named };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ParserState =
  | 'idle'
  | 'reading-description'
  | 'reading-exits'
  | 'brief-awaiting-exits';

export class RoomParser {
  private state: ParserState = 'idle';
  private roomName = '';
  private briefDesc = '';
  private descLines: string[] = [];
  private exitText = '';
  private isWilderness = false;
  private onEvent: (event: RoomParserEvent) => void;
  private linesSinceRoomName = 0;

  constructor(onEvent: (event: RoomParserEvent) => void) {
    this.onEvent = onEvent;
  }

  /**
   * Feed a stripped (no ANSI) line to the parser.
   * Lines should already have ANSI codes removed but may have "> " prompt prefixes.
   */
  feedLine(rawLine: string): void {
    // Strip leading "> " prompts
    const line = rawLine.replace(/^(?:> )+/, '').trimEnd();

    // Empty lines reset certain states
    if (!line) {
      if (this.state === 'reading-description' || this.state === 'reading-exits') {
        this.reset();
      }
      return;
    }

    // Check for failed movement (any state)
    if (MOVE_FAIL_RE.test(rawLine)) {
      this.reset();
      this.onEvent({ type: 'move-failed' });
      return;
    }

    switch (this.state) {
      case 'idle':
        this.handleIdle(line, rawLine);
        break;
      case 'reading-description':
        this.handleDescription(line, rawLine);
        break;
      case 'reading-exits':
        this.handleExits(line);
        break;
      case 'brief-awaiting-exits':
        this.handleBriefExits(line, rawLine);
        break;
    }
  }

  private handleIdle(line: string, rawLine: string): void {
    // Brief mode: "Room Name: description"
    const briefMatch = BRIEF_ROOM_RE.exec(rawLine);
    if (briefMatch) {
      const name = briefMatch[1].trim();
      const desc = briefMatch[2].trim();
      // Validate it looks like a brief room (not a status line or other output)
      if (name.length > 0 && name.length < 80 && !ROOM_NAME_EXCLUSIONS.test(rawLine)) {
        this.roomName = name;
        this.briefDesc = desc;
        this.state = 'brief-awaiting-exits';
        return;
      }
    }

    // Wilderness room start
    if (WILDERNESS_START_RE.test(rawLine)) {
      this.isWilderness = true;
      this.roomName = '';
      this.briefDesc = line;
      this.descLines = [line];
      this.state = 'reading-description';
      this.linesSinceRoomName = 0;
      return;
    }

    // Potential room name: a line that doesn't match exclusions, reasonably short
    if (!ROOM_NAME_EXCLUSIONS.test(rawLine) && line.length > 0 && line.length < 80) {
      // Heuristic: room names start with a capital letter and don't end with a period
      // (unless they contain proper nouns like "Rabiye's Curiosities")
      if (/^[A-Z]/.test(line) && !line.endsWith('.')) {
        this.roomName = line;
        this.briefDesc = '';
        this.descLines = [];
        this.isWilderness = false;
        this.state = 'reading-description';
        this.linesSinceRoomName = 0;
        return;
      }
    }
  }

  private handleDescription(line: string, rawLine: string): void {
    this.linesSinceRoomName++;

    // If we've been reading too many lines without finding exits or lighting,
    // this probably wasn't a room name
    if (this.linesSinceRoomName > 15) {
      this.reset();
      return;
    }

    // Check for exit line (may be embedded in the description flow)
    const exitMatch = EXIT_START_RE.exec(rawLine);
    if (exitMatch) {
      this.exitText = exitMatch[1];
      // Check if the exit line is complete (ends with a period)
      if (this.exitText.trimEnd().endsWith('.')) {
        this.emitRoom();
      } else {
        this.state = 'reading-exits';
      }
      return;
    }

    // For wilderness: if we hit lighting, emit with no exits
    if (this.isWilderness && LIGHTING_RE.test(line)) {
      this.descLines.push(line);
      this.emitWilderness();
      return;
    }

    // Accumulate description
    this.descLines.push(line);
  }

  private handleExits(line: string): void {
    // Continuation of exit line (wraps to next line)
    this.exitText += ' ' + line;
    if (this.exitText.trimEnd().endsWith('.')) {
      this.emitRoom();
    }
  }

  private handleBriefExits(_line: string, rawLine: string): void {
    const briefExitMatch = BRIEF_EXITS_RE.exec(rawLine);
    if (briefExitMatch) {
      const exitWords = briefExitMatch[1].trim().split(/\s+/);
      const directions: Direction[] = [];
      const named: string[] = [];
      for (const word of exitWords) {
        const dir = parseDirection(word);
        if (dir) directions.push(dir);
        else named.push(word);
      }
      this.onEvent({
        type: 'room',
        room: {
          name: this.roomName,
          brief: this.briefDesc,
          exitDirections: directions,
          namedExits: named,
          terrain: 'indoor',
          isBrief: true,
        },
      });
      this.reset();
    } else {
      // Not a brief exit line — false alarm, reset
      this.reset();
    }
  }

  private emitRoom(): void {
    const { directions, named } = parseExitText(this.exitText);
    this.onEvent({
      type: 'room',
      room: {
        name: this.roomName,
        brief: this.briefDesc || this.descLines[0] || '',
        exitDirections: directions,
        namedExits: named,
        terrain: 'indoor',
        isBrief: false,
      },
    });
    this.reset();
  }

  private emitWilderness(): void {
    this.onEvent({
      type: 'room',
      room: {
        name: this.roomName || 'Wilderness',
        brief: this.descLines[0] || '',
        exitDirections: [], // wilderness doesn't list exits
        namedExits: [],
        terrain: 'wilderness',
        isBrief: false,
      },
    });
    this.reset();
  }

  private reset(): void {
    this.state = 'idle';
    this.roomName = '';
    this.briefDesc = '';
    this.descLines = [];
    this.exitText = '';
    this.isWilderness = false;
    this.linesSinceRoomName = 0;
  }
}
