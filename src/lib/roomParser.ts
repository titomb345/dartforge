/**
 * Room output parser — detects DartMUD hex wilderness room descriptions.
 *
 * Hex-only mapper: only parses wilderness hex rooms. Towns/dungeons are ignored.
 *
 * Detection flow:
 * 1. "You gaze at your surroundings." → enter hex-art-skipping mode (survey command)
 * 2. Skip ASCII hex art lines (border patterns: ------, /...\, -...- , \.../)
 * 3. After hex art ends, parse wilderness description lines
 * 4. Also detect wilderness descriptions WITHOUT preceding hex art (normal movement)
 * 5. Extract terrain + landmarks, emit parsed hex room event
 */

import { detectHexTerrain, type HexTerrainType } from './hexTerrainPatterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedHexRoom {
  terrain: HexTerrainType;
  description: string;
  landmarks: string[];
}

export type RoomParserEvent = { type: 'hex-room'; room: ParsedHexRoom } | { type: 'move-failed' };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Survey command trigger */
const SURVEY_RE = /^(?:> )*You gaze at your surroundings\./;

/** ASCII hex art border lines */
const HEX_ART_RE = /^(?:> )*(?:\s*-{3,}|\s*[/\\].*[/\\]\s*$|\s*-[^a-zA-Z]*-\s*$)/;

/** Hex art top/bottom borders: lines that are mostly dashes and spaces */
const HEX_BORDER_RE = /^(?:> )*\s*-[-\s]+$/;

/** Hex art side lines: contain / or \ mixed with terrain chars */
const HEX_SIDE_RE = /^(?:> )*\s*[/\\][ .^~"whsx-]*[/\\]\s*$/;

/** Wilderness room starts — description lines */
const WILDERNESS_START_RE =
  /^(?:> )*(?:You are (?:in|on|at|standing)|This is (?:a |an |the )|The ground is |A vast |The )/;

/** Lighting sentences that end room descriptions */
const LIGHTING_RE =
  /It is (?:shadowy|dim|bright|painfully bright|blindingly bright|extremely light here|well lit here|pitch black|dark here|dark)\./;

/** Failed movement messages */
const MOVE_FAIL_RE =
  /^(?:> )*(?:There is no exit in that direction\.|The .+ is closed\.|You (?:can't|cannot) go that way\.|You can't see to move!)/;

/** Lines that are clearly NOT part of a wilderness description */
const NON_WILDERNESS_RE =
  /^(?:> )*(?:There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits):|< .+ >$|Held|Worn|Concentration|Encumbrance|Movement|Aura|Needs|\* |> $|\(|$)/;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ParserState = 'idle' | 'skipping-hex-art' | 'reading-description';

export class RoomParser {
  private state: ParserState = 'idle';
  private descLines: string[] = [];
  private linesSinceStart = 0;
  private onEvent: (event: RoomParserEvent) => void;

  constructor(onEvent: (event: RoomParserEvent) => void) {
    this.onEvent = onEvent;
  }

  /**
   * Feed a stripped (no ANSI) line to the parser.
   */
  feedLine(rawLine: string): void {
    const line = rawLine.replace(/^(?:> )+/, '').trimEnd();

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
      case 'skipping-hex-art':
        this.handleHexArt(line, rawLine);
        break;
      case 'reading-description':
        this.handleDescription(line, rawLine);
        break;
    }
  }

  private handleIdle(line: string, rawLine: string): void {
    // Survey command: "You gaze at your surroundings."
    if (SURVEY_RE.test(rawLine)) {
      this.state = 'skipping-hex-art';
      this.descLines = [];
      this.linesSinceStart = 0;
      return;
    }

    // Hex art border at start (movement triggered hex display without survey text)
    if (this.isHexArtLine(line)) {
      this.state = 'skipping-hex-art';
      this.descLines = [];
      this.linesSinceStart = 0;
      return;
    }

    // Direct wilderness description (movement without hex art display)
    if (WILDERNESS_START_RE.test(rawLine)) {
      this.descLines = [line];
      this.state = 'reading-description';
      this.linesSinceStart = 1;
      return;
    }
  }

  private handleHexArt(line: string, rawLine: string): void {
    this.linesSinceStart++;

    // Safety: if we've been in hex art too long, something went wrong
    if (this.linesSinceStart > 30) {
      this.reset();
      return;
    }

    // Skip empty lines within hex art
    if (!line) return;

    // Still in hex art?
    if (this.isHexArtLine(line)) return;

    // Transition: first non-hex-art line should be the wilderness description
    if (WILDERNESS_START_RE.test(rawLine) || !NON_WILDERNESS_RE.test(rawLine)) {
      this.descLines = [line];
      this.state = 'reading-description';
      this.linesSinceStart = 1;
      return;
    }

    // Got something unexpected — reset
    this.reset();
  }

  private handleDescription(line: string, _rawLine: string): void {
    this.linesSinceStart++;

    // Limit description length
    if (this.linesSinceStart > 12) {
      this.emitHexRoom();
      return;
    }

    // Empty line ends description
    if (!line) {
      this.emitHexRoom();
      return;
    }

    // Lighting sentence ends description
    if (LIGHTING_RE.test(line)) {
      this.descLines.push(line);
      this.emitHexRoom();
      return;
    }

    // Non-wilderness content (exit lines, status, etc.) ends description
    if (NON_WILDERNESS_RE.test(line)) {
      this.emitHexRoom();
      return;
    }

    this.descLines.push(line);
  }

  private isHexArtLine(line: string): boolean {
    if (HEX_BORDER_RE.test(line)) return true;
    if (HEX_SIDE_RE.test(line)) return true;
    if (HEX_ART_RE.test(line)) return true;
    return false;
  }

  private emitHexRoom(): void {
    if (this.descLines.length === 0) {
      this.reset();
      return;
    }

    const fullDescription = this.descLines.join(' ');
    const terrain = detectHexTerrain(fullDescription);

    // Extract landmarks from lines after the first (main description)
    const landmarks: string[] = [];
    for (let i = 1; i < this.descLines.length; i++) {
      const l = this.descLines[i].trim();
      if (l && !LIGHTING_RE.test(l)) {
        landmarks.push(l);
      }
    }

    this.onEvent({
      type: 'hex-room',
      room: {
        terrain,
        description: fullDescription,
        landmarks,
      },
    });

    this.reset();
  }

  private reset(): void {
    this.state = 'idle';
    this.descLines = [];
    this.linesSinceStart = 0;
  }
}
