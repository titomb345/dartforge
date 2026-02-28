/**
 * Room output parser — detects DartMUD hex wilderness room descriptions.
 *
 * Hex-only mapper: only parses wilderness hex rooms. Towns/dungeons are ignored.
 *
 * Detection flow:
 * 1. "You gaze at your surroundings." → enter collecting-hex-art mode
 * 2. Collect ASCII hex art lines into a buffer
 * 3. When hex art ends, parse it via hexArtParser → extract terrain fingerprint
 * 4. Collect wilderness description lines
 * 5. Extract terrain + landmarks + fingerprint, emit parsed hex room event
 *
 * "You gaze at your surroundings." is the only entry point. It only appears
 * in the hex wilderness, so towns/dungeons are never processed.
 */

import { detectHexTerrain, type HexTerrainType } from './hexTerrainPatterns';
import {
  isHexArtLine,
  parseHexArt,
  generateFingerprint,
  type ParsedHexArt,
} from './hexArtParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedHexRoom {
  terrain: HexTerrainType;
  description: string;
  landmarks: string[];
  /** Terrain fingerprint from hex art (null if no hex art was parsed) */
  fingerprint: string | null;
  /** Full parsed hex art data (null if no hex art was parsed) */
  hexArt: ParsedHexArt | null;
}

export type RoomParserEvent = { type: 'hex-room'; room: ParsedHexRoom } | { type: 'move-failed' };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Survey command trigger */
const SURVEY_RE = /^(?:> )*You gaze at your surroundings\./;

/** Wilderness room starts — description lines */
const WILDERNESS_START_RE =
  /^(?:> )*(?:You are (?:in|on|at|standing)|This is (?:a |an |the )|The ground is |A vast |The )/;

/** Health/condition status messages that false-positive on WILDERNESS_START_RE */
const HEALTH_STATUS_RE =
  /^(?:> )*You are (?:in (?:perfect health|good shape|bad shape|terrible shape|(?:very )?(?:poor|rough|awful) shape)|mortally wounded|gravely |seriously |badly |wounded|slightly |barely wounded)/;

/** Lighting sentences that end room descriptions */
const LIGHTING_RE =
  /It is (?:shadowy|dim|bright|painfully bright|blindingly bright|extremely light here|well lit here|pitch black|dark here|dark)\./;

/** Failed movement messages */
const MOVE_FAIL_RE =
  /^(?:> )*(?:There is no exit in that direction\.|The .+ is closed\.|You (?:can't|cannot) go that way\.|You can't see to move!|You must swim )/;

/** Lines that are clearly NOT part of a wilderness description */
const NON_WILDERNESS_RE =
  /^(?:> )*(?:There (?:is one obvious exit|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits):|< .+ >$|Held|Worn|Concentration|Encumbrance|Movement|Aura|Needs|\* |> $|\(|$)/;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ParserState = 'idle' | 'collecting-hex-art' | 'reading-description';

export class RoomParser {
  private state: ParserState = 'idle';
  private descLines: string[] = [];
  private hexArtLines: string[] = [];
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
      case 'collecting-hex-art':
        this.handleCollectingHexArt(line, rawLine);
        break;
      case 'reading-description':
        this.handleDescription(line, rawLine);
        break;
    }
  }

  private handleIdle(_line: string, rawLine: string): void {
    // "You gaze at your surroundings." is the ONLY entry point.
    // It always precedes hex art in the wilderness. Nothing else triggers collection.
    if (SURVEY_RE.test(rawLine)) {
      this.state = 'collecting-hex-art';
      this.descLines = [];
      this.hexArtLines = [];
      this.linesSinceStart = 0;
    }
  }

  private handleCollectingHexArt(line: string, rawLine: string): void {
    this.linesSinceStart++;

    // Safety: if we've been in hex art too long, something went wrong
    if (this.linesSinceStart > 30) {
      this.reset();
      return;
    }

    // Skip empty lines within hex art (padding before/between art)
    if (!line) {
      if (this.hexArtLines.length > 0 && this.hexArtLines.length < 3) return;
      // Empty line after significant hex art — transition to description
      if (this.hexArtLines.length >= 3) {
        this.state = 'reading-description';
        this.linesSinceStart = 0;
        return;
      }
      return;
    }

    // Still in hex art?
    if (isHexArtLine(line)) {
      this.hexArtLines.push(line);
      return;
    }

    // First non-hex-art, non-empty line: hex art is done, transition to description
    if (
      WILDERNESS_START_RE.test(rawLine) &&
      !HEALTH_STATUS_RE.test(rawLine)
    ) {
      this.descLines = [line];
      this.state = 'reading-description';
      this.linesSinceStart = 1;
      return;
    }

    if (!NON_WILDERNESS_RE.test(rawLine) && line.length > 0) {
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

    // Parse hex art and generate fingerprint if we collected art lines
    let fingerprint: string | null = null;
    let hexArt: ParsedHexArt | null = null;
    if (this.hexArtLines.length >= 5) {
      hexArt = parseHexArt(this.hexArtLines);
      if (hexArt) {
        fingerprint = generateFingerprint(hexArt);
      }
    }

    this.onEvent({
      type: 'hex-room',
      room: {
        terrain,
        description: fullDescription,
        landmarks,
        fingerprint,
        hexArt,
      },
    });

    this.reset();
  }

  private reset(): void {
    this.state = 'idle';
    this.descLines = [];
    this.hexArtLines = [];
    this.linesSinceStart = 0;
  }
}
