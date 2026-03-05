/** Pre-compiled regex for stripping MUD prompt prefixes ("&gt; "). */
const PROMPT_PREFIX_RE = /^(?:> )+/;

/**
 * Strip leading MUD prompt prefixes and trim whitespace.
 * Used by all pattern matchers to normalize incoming lines.
 */
export function cleanLine(line: string): string {
  return line.replace(PROMPT_PREFIX_RE, '').trim();
}

/** Cached regexes for stripScorePrefix — avoids recompiling on every call. */
const prefixRegexCache = new Map<string, RegExp>();

/**
 * Strip a "Label : value" prefix from a cleaned line.
 * Returns the value portion if the prefix matches, otherwise the original text.
 */
export function stripScorePrefix(line: string, prefix: string): string {
  let regex = prefixRegexCache.get(prefix);
  if (!regex) {
    regex = new RegExp(`^${prefix}\\s*:\\s*(.+)$`, 'i');
    prefixRegexCache.set(prefix, regex);
  }
  const match = line.match(regex);
  return match ? match[1].trim() : line;
}
