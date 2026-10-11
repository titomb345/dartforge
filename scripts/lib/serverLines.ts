/**
 * DartMUD server-line patterns shared by the replay tools and the
 * ground-truth toolkit — ONE copy, so a parser change updates every tool.
 *
 * EXITS_START_RE mirrors src/lib/townParser.ts's EXITS_START_RE, which is
 * not exported: a room block is the lines above an exits line, so the tools
 * use it to count blocks the parser dropped ("lost blocks") and to scope the
 * TCP-fragment rejoin to room prose. If townParser.ts changes its exits
 * grammar, change it here too (or export the parser's and re-export it):
 * scripts/town-tests/test-replay-harness.ts fails while the two differ (the
 * regex text, and the parser's verdict on sample exits lines).
 */

/** Exits line — printed by town/dungeon rooms, never by wilderness hexes
 *  (including "There are no obvious exits.", a room without exits) */
export const EXITS_START_RE =
  /^(?:> )*There (?:is one obvious exit:|are (?:two|three|four|five|six|seven|eight|nine|ten|many) exits:|are no obvious exits\.)/;

/** The exits line of a room without exits (counted separately by the replay) */
export const NO_EXITS_RE = /^(?:> )*There are no obvious exits\.\s*$/;
