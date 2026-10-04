/**
 * TCP-fragment rejoin for DartForge session logs.
 *
 * useSessionLogger logs every received TCP chunk split on newlines, with no
 * carry-over buffer, so a chunk that ends mid-line leaves the line's head as
 * one log line and its tail as the next:
 *
 *   [..] In one corner is a large fireplace b      <- end of chunk N
 *   [..] ut it remains                             <- start of chunk N+1
 *
 * Live, OutputFilter buffers to the newline and the parsers see whole lines.
 * Replayed verbatim, the short unterminated head reads as a room NAME
 * candidate, scanName rejects it (lowercase / dangling word) and the WHOLE
 * room block is dropped — the next block is then attributed to the wrong
 * move. The split portal transit line ("You step into the no" / "rth
 * portal.") hid a transit and glued a whole town walk into the portal hub.
 *
 * The rule: DartMUD wraps room prose at 80 columns at word boundaries, so a
 * pair (A, B) is ONE server line split by the logger exactly when the server
 * would NOT have broken the line there:
 *   - mid-word ("...fireplace b" + "ut it"): A + B's first word <= 79 (a
 *     server wrap always has A + " " + word > 80, i.e. A + word >= 80)
 *   - right after a space ("...door leading " + "west."): A + word <= 80
 *   - right before a space ("...a dragon" + " bone"): A + 1 + word <= 80
 *   - at a sentence gap ("...next to it." + "  There is an oak chest"):
 *     B starts with DartMUD's two-space sentence gap. A few rooms do indent
 *     a line on purpose (the ruins' "  It is blindingly bright here."), but
 *     gluing that onto the sentence before changes nothing: every consumer
 *     collapses whitespace (descKey, the volatile-prose sentences, the oracle
 *     canon)
 * plus guards, each one there because the corpus produced a false join
 * without it:
 *   - the joined line fits 80 visible columns (an interleaved short line
 *     after a long wrapped line passes the first-word test but not this)
 *   - B continues a word or sentence: lowercase / punctuation first, or the
 *     sentence gap (a capitalized B is how name lines and the first desc
 *     line meet — "Market" + "This is a spacious...")
 *   - neither side is a "field: value" line (exits sentences excepted: "Ok"
 *     + "upper left hand: ..." made "Okupper"), hex art, columnar output
 *     (3+ spaces) or a logged command; A is not a complete line, nor the OOC
 *     Entry Hall's notes notice (NO_NOTES_LINE_RE)
 *   - A can START a server line: the orphaned tail of a split that could
 *     not be rejoined never heads a new pair ("ield" + "lower left hand")
 *   - the fragments were logged within 1 s of each other (chunks of one
 *     server write arrive milliseconds apart; a split can straddle a second
 *     boundary — session_2026-06-30T00-43-13-858.log:143-144)
 *   - (roomOnly, the default) the join sits inside room prose: an exits line
 *     follows within ROOM_WINDOW lines, or the join completes a portal
 *     transit line. Outside room text most lines are not server-wrapped
 *     (equipment lists, chat, board notes), so the 80-column geometry
 *     proves nothing there.
 * A logged `>> command` may sit between the two halves (the user typed while
 * the chunk was in flight); the joined line takes the TAIL's position, after
 * the command — live, the line completes (and is parsed) when the tail
 * arrives, so the command was already tracked.
 *
 * Validated by scripts/gt/rejoin-audit.ts (Oct 2026): on the line-intact
 * MUSHclient corpus (339,532 room blocks, where every join is suspect) not a
 * single block is lost or altered — the one block it GAINS sits behind a
 * MUSHclient command echo ("read next" inside a Day Room description), an
 * interloper the DartForge logger always marks with ">> ". On the DartForge
 * corpus 32 of the 45 exits lines without a room block get theirs back; the
 * other 13 are rooms whose NAME ends in a period (a parser limit).
 *
 * Two geometry facts the audit surfaced (both harmless, both on purpose):
 *  - DartMUD's wrapped EXITS lines can end in a space, so a genuine server
 *    wrap there passes the after-space test: all 2,235 after-space joins on
 *    the MUSH logs are such exits lines. The parser concatenates exits
 *    continuation lines anyway — the audit sees no block change.
 *  - The room-prose scope is a proximity test, not a block test: text read
 *    while standing in a room (a board note, census output) sits inside the
 *    window, and the DartForge logs do false-join there
 *    (session_2026-07-13T03-35-32-238.log:10288, a board note: "...turn to
 *    sporethats badso Butcher..."). Those lines are never part of a room
 *    block.
 */
import { EXITS_START_RE } from './serverLines';

const ART_RE = /[\\/|]|-----|\*\*|~~|\^\^/;
const COLUMNS_RE = / {3,}/;
/** An exits sentence for the "field: value" guard — deliberately looser than
 *  EXITS_START_RE (any count word): it only exempts the colon, it never
 *  decides where a room block is */
const EXITS_SENTENCE_RE = /^(?:> )*There (?:is one obvious exit|are \w+ exits):/;
const PORTAL_LINE_RE = /^(?:> )*You step (?:into|through) the(?: \w+)? portal\.\s*$/;
const PROMPT_RE = /^(?:> )+/;
const COMMAND_RE = /^>> /;
/**
 * The OOC Entry Hall's "no new notes" notice is a whole server line, and the
 * hall's indented "  It is bright." follows a blank line the logger dropped
 * — the sentence-gap rule would glue them into one line. Unlike the ruins'
 * indented lighting line that glue is NOT harmless: the town parser skips
 * the notice only as a line of its own (townParser.ts BOARD_NOTICE_RE), so
 * the replay kept it as description prose that live never sees, and the
 * hall's description differed between visits with and without unread notes.
 */
const NO_NOTES_LINE_RE = /^(?:> )*Sadly, there are no new notes for you to read\.$/;

/** Lines after the tail that may hold the room's exits line (the fragments
 *  themselves count too: the exits sentence itself can be the split line) */
export const ROOM_WINDOW = 14;
/** Max gap between the two halves' log stamps (1 s resolution: a split can
 *  straddle one second boundary, never two) */
const MAX_GAP_MS = 1000;

/** Visible width of a logged line: prompt prefixes and trailing blanks don't count */
function visible(s: string): number {
  return s.replace(PROMPT_RE, '').replace(/\s+$/, '').length;
}

export type FragmentKind = 'mid-word' | 'after-space' | 'before-space' | 'sentence-gap';

/**
 * Do lines A and B look like ONE server line split at a TCP chunk boundary?
 * Pure text/geometry test — no timing or context (see rejoinFragments).
 */
export function fragmentKind(a: string, b: string): FragmentKind | null {
  if (!a || !b || COMMAND_RE.test(a) || COMMAND_RE.test(b)) return null;
  if (NO_NOTES_LINE_RE.test(a)) return null;
  if (ART_RE.test(a) || ART_RE.test(b) || COLUMNS_RE.test(a) || COLUMNS_RE.test(b)) return null;
  if (visible(a + b) > 80) return null;
  // "field: value" lines (equipment, score) — exits sentences excepted. B
  // too: DartMUD's bare "Ok" acknowledgement followed by an equipment list
  // passes every other test ("Ok" + "upper left hand: ..." → "Okupper").
  if (a.includes(':') && !EXITS_SENTENCE_RE.test(a)) return null;
  if (b.includes(':') && !EXITS_SENTENCE_RE.test(a + b)) return null;
  const w = (b.replace(/^\s+/, '').split(/\s+/)[0] ?? '').length;
  // Split at the two-space sentence gap: A is a complete sentence, B starts
  // with the gap (see the module comment for deliberately indented lines)
  if (/[.!?]["')]?$/.test(a) && /^ {2}[A-Z]/.test(b)) return 'sentence-gap';
  if (/[.!?"')\]*]\s*$/.test(a)) return null; // A is a complete line
  if (/[A-Za-z] $/.test(a) && /^[a-z]/.test(b)) return a.length + w <= 80 ? 'after-space' : null;
  if (/[A-Za-z]$/.test(a) && /^ [a-z]/.test(b))
    return a.length + 1 + w <= 80 ? 'before-space' : null;
  if (/[A-Za-z]$/.test(a) && /^[a-z,.;']/.test(b)) return a.length + w <= 79 ? 'mid-word' : null;
  return null;
}

/**
 * Can `line` START a server line? A line that continues its predecessor's
 * sentence without the predecessor having wrapped (the word would have fit,
 * or the predecessor is a long unwrapped line) is the orphaned TAIL of an
 * earlier split that could not be rejoined — used as a head it false-joins
 * whatever follows ("ield" + "lower left hand: ..." after an unwrapped
 * equipment line; "  There is an oak chest...  It" + "is bright.").
 */
function startsServerLine(prev: string | null, line: string): boolean {
  // An indented line is a sentence-gap tail or deliberately indented text
  // (a lighting line, a board list) — never the head of a provable split
  if (/^\s/.test(line)) return false;
  if (prev === null || /[.!?"')\]*:]\s*$/.test(prev) || !/^[a-z,.;']/.test(line)) return true;
  const w = (line.split(/\s+/)[0] ?? '').length;
  return visible(prev) <= 80 && prev.replace(/\s+$/, '').length + 1 + w > 80;
}

export interface RejoinLine {
  /** Line text without the log stamp (command echoes keep their '>> ') */
  text: string;
  /** Log timestamp in ms (DartForge session logs), or null (MUSHclient logs) */
  t: number | null;
}

export interface RejoinJoin {
  /** Index of the first fragment */
  from: number;
  /** Index the joined line sits at (its last fragment) */
  at: number;
  text: string;
  kinds: FragmentKind[];
}

export interface RejoinResult {
  /** Same length as the input: a joined line sits at its LAST fragment's
   *  index, consumed fragments are null, everything else is unchanged. */
  lines: (string | null)[];
  joins: RejoinJoin[];
}

/**
 * Rejoin logger-split lines (joins chain: a line split twice comes back
 * whole). `roomOnly` (default true) limits joins to room prose — see the
 * module comment.
 */
export function rejoinFragments(
  input: readonly RejoinLine[],
  opts: { roomOnly?: boolean } = {}
): RejoinResult {
  const roomOnly = opts.roomOnly ?? true;
  const lines: (string | null)[] = input.map((l) => l.text);
  const joins: RejoinJoin[] = [];
  const isCmd = (i: number) => COMMAND_RE.test(input[i].text);
  const exitsAt: boolean[] = input.map((l) => EXITS_START_RE.test(l.text));
  const exitsNear = (from: number, to: number) => {
    for (let k = from; k <= Math.min(input.length - 1, to + ROOM_WINDOW); k++) {
      if (exitsAt[k]) return true;
    }
    return false;
  };

  /** Previous server line before index i (skipping one logged command) */
  const prevText = (i: number): string | null => {
    let p = i - 1;
    if (p >= 0 && isCmd(p)) p--;
    return p >= 0 ? lines[p] : null;
  };

  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i] === null || isCmd(i)) continue;
    if (!startsServerLine(prevText(i), lines[i]!)) continue;
    let joined = lines[i]!;
    let last = i;
    const kinds: FragmentKind[] = [];
    for (;;) {
      // The next server line, tolerating ONE logged command in between
      let j = last + 1;
      if (j < lines.length && isCmd(j)) j++;
      if (j >= lines.length || lines[j] === null || isCmd(j)) break;
      const ta = input[last].t;
      const tb = input[j].t;
      if (ta !== null && tb !== null && Math.abs(tb - ta) > MAX_GAP_MS) break;
      const kind = fragmentKind(joined, lines[j]!);
      if (!kind) break;
      const candidate = joined + lines[j]!;
      if (roomOnly && !PORTAL_LINE_RE.test(candidate) && !exitsNear(i, j)) break;
      joined = candidate;
      kinds.push(kind);
      lines[last] = null;
      lines[j] = null;
      last = j;
    }
    if (last !== i) {
      lines[last] = joined;
      joins.push({ from: i, at: last, text: joined, kinds });
      i = last; // the chain already tried to extend the joined line
    }
  }
  return { lines, joins };
}
