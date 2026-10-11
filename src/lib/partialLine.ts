/**
 * The one rule for a chunk's unterminated tail — the text after its last
 * newline — shared by the OutputFilter (what the parsers see) and the
 * session logger (what the replay tools see), so the two always cut the
 * stream into the same lines.
 *
 * A tail that is complete on its own ends a burst: the server's "> "
 * prompt, the pager's prompt (PAGER_PROMPT), a "Name:" / "Password:" login
 * prompt, or nothing but color codes. It is shown at once (the OutputFilter
 * writes it to the screen; it never becomes a parser line) — nothing will
 * follow it until the player types. Any other tail is the START of a line
 * that a TCP read cut in two, and waits for the next chunk.
 *
 * Kinds of tail that were taken for the wrong kind:
 *  - indentation only (taken for complete): the parsers got the line
 *    without its leading whitespace. Hex art is column-aligned, so a survey
 *    row lost its alignment and its hexes — 533 of 8,704 DartForge-logged
 *    surveys (6.1%) have a border row that lost its indentation this way,
 *    mostly the art's bottom row (session_2026-06-19T17-53-55-411.log:2620:
 *    5 leading spaces instead of 14, hex 0,2 dropped). An indented board
 *    name in the OOC Entry Hall named the hall after the board ("     Chat"
 *    cut after its spaces arrived as "Chat").
 *  - a line ending in a "<tag>" (taken for complete): "< n s w >" (a
 *    survey's exit list), a peek ("Healer's Hall: a comfortable guest hall
 *    < n s u >"), help text ("See also <help hexes>") — none is a prompt
 *    (no line in either corpus that ends in a <word> tag waits for input).
 *  - the pager's prompt (taken for a cut line): it ends in "---", not ">",
 *    so it stayed off the screen while the server waited for Enter (the
 *    player saw the output stop with no prompt), and then reached the
 *    parsers glued to the first line of the next page — all 1,357 MUSH
 *    sightings, mostly an equipment list's "lower left hand ..." header.
 */

/** DartMUD's pager prompt. It comes with no newline: the server waits for
 *  Enter, and the next page goes on on the same line (1,202 of the 1,357
 *  MUSH sightings; the one wording in five years of logs) */
export const PAGER_PROMPT = '--- Press <enter> for more. ---';

/** True when `plain` (ANSI-stripped) is a complete tail — see the module comment */
export function isCompletePartial(plain: string): boolean {
  const trimmed = plain.trim();
  // Color codes / a stray CR only: complete. Indentation: a line's start.
  if (trimmed === '') return !/[ \t]/.test(plain);
  if (/^(?:Name|Password)\s*:$/i.test(trimmed)) return true;
  if (trimmed === PAGER_PROMPT) return true;
  return trimmed.endsWith('>') && !/<[\w ]+>$/.test(trimmed);
}
