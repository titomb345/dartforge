import { convertDartmudDate } from './dartDate';

/**
 * Matches bulletin board note lines from DartMUD.
 *
 * Examples (stripped text):
 *   "  29 [Sap  1, 605] One more to strike a blow against the demons. (Lixen)"
 *   "   1 [Crn  8, 643] Lixen"
 *   "  42 [Red 12, 1150] Spydee (Castlehoff)"
 *
 * Capture groups:
 *   1: prefix (leading spaces + note number + space)
 *   2: date string inside brackets (e.g., "Sap  1, 605")
 *   3: remainder after "]" (title + optional poster)
 */
const BOARD_NOTE_RE = /^(\s*\d+\s+)\[([A-Za-z]{3}\s+\d{1,2},\s*\d+)\](.*)$/;

/**
 * Find a literal bracket character in a raw string, skipping ANSI escape
 * sequences (CSI: \x1b[...letter) whose syntax also uses '['.
 */
function findLiteralBracket(raw: string, char: string, startFrom = 0): number {
  let i = startFrom;
  while (i < raw.length) {
    // Skip ANSI CSI sequences: \x1b[ <params> <terminator letter>
    if (raw[i] === '\x1b' && i + 1 < raw.length && raw[i + 1] === '[') {
      i += 2;
      while (i < raw.length && !/[A-Za-z]/.test(raw[i])) i++;
      i++; // skip terminator
      continue;
    }
    if (raw[i] === char) return i;
    i++;
  }
  return -1;
}

/**
 * If the stripped line is a bulletin board note, replace the in-game date
 * with the real-world equivalent in the raw (ANSI-coded) line.
 *
 * Returns the transformed raw line, or null if no board note was detected.
 */
export function transformBoardDateLine(stripped: string, raw: string): string | null {
  const m = BOARD_NOTE_RE.exec(stripped);
  if (!m) return null;

  const dateString = m[2];
  const realDate = convertDartmudDate(dateString);
  if (!realDate) return null;

  // Replace the date content between the first literal [ ] pair in the raw line,
  // skipping '[' characters that are part of ANSI escape sequences (\x1b[...).
  const openIdx = findLiteralBracket(raw, '[');
  const closeIdx = findLiteralBracket(raw, ']', openIdx + 1);
  if (openIdx < 0 || closeIdx < 0) return null;

  return raw.substring(0, openIdx + 1) + realDate + raw.substring(closeIdx);
}
