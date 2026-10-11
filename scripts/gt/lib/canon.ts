/**
 * Sentence-level canonicalization shared by the oracle builder, the checker
 * and the replay's oracle trace — they must canonicalize a room text EXACTLY
 * alike, or a mapped room never finds the class its log sightings formed.
 */

const LIGHT_WORDS =
  '(?:(?:blindingly|painfully|very|extremely) )?(?:bright|light|dark|shadowy|murky|dim|dimly lit|well lit|pitch black|too dark to see)(?: here)?';
/** "...provide ample illumination It is bright." — some room texts omit the
 *  period before the lighting sentence; split it off so it is stripped. */
const LIGHT_TAIL_RE = new RegExp(`([a-z'"])\\s+(It is ${LIGHT_WORDS}\\.)$`);

/** Split prose into sentences (whitespace collapsed). Same boundary rule as
 *  the engine's splitSentences, plus a closing quote after the stop. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LIGHT_TAIL_RE, '$1. $2')
    .split(/(?<=[.!?]["']?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * World-state sentences with a CLOSED vocabulary — lighting (RoomParser's
 * list plus the "very/extremely" and "too dark to see" forms found in the
 * corpus) and weather. Unlike the engine's generic "It is [^.]{1,60}."
 * strip, stable prose that happens to start with "It is" ("It is lined
 * with trapdoors.") is KEPT.
 */
export const WORLD_RE =
  /^(?:It is (?:(?:blindingly|painfully|very|extremely) )?(?:bright|light|dark|shadowy|murky|dim|dimly lit|well lit|pitch black|too dark to see)(?: here)?\.|It is (?:raining|snowing|hailing|sleeting)\.|The air is quite (?:warm|humid|chilly|dry|cold|hot|cool|mild)\.)$/;

/** Client/logging noise that can land inside a captured description */
export const NOISE_RE =
  /^(?:Send-to-script cannot execute because scripting is not enabled\.|Trigger function ".*" not found.*|Alias function ".*" not found.*|Script error.*|Error .* in script.*)$/;

export function stableSentences(desc: string, volatile: ReadonlySet<string>): string[] {
  return sentences(desc).filter((s) => !WORLD_RE.test(s) && !NOISE_RE.test(s) && !volatile.has(s));
}

export function canonKey(desc: string, volatile: ReadonlySet<string>): string {
  return stableSentences(desc, volatile).join(' ');
}

/** Fingerprint group: name + exits dir-set + named exits */
export const groupKey = (name: string, dirs: readonly string[], named: readonly string[]) =>
  `${name}|${dirs.join(',')}|${named.join(',')}`;
