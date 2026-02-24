import type { Variable } from '../types/variable';

/**
 * Reserved $ tokens that must NOT be replaced by user variables.
 * These are handled by the alias engine (substituteArgs) and trigger engine.
 */
const RESERVED_PREFIXES = [
  'opposite', // $opposite1..$opposite9
  'line', // $line (trigger)
  'me', // $me
];

/**
 * Expand user-defined $variables in a text string.
 *
 * Replaces `$name` with the variable's value for all enabled variables.
 * Avoids clobbering built-in tokens ($1-$9, $*, $-, $!, $me, $line, $opposite1, etc.)
 * by only matching variable names that start with a letter and contain word characters.
 *
 * Call this AFTER positional/built-in substitution has already run.
 */
export function expandVariables(text: string, variables: Variable[]): string {
  // Build lookup of enabled variables (first match wins — character vars come first in merged list)
  const varMap = new Map<string, string>();
  for (const v of variables) {
    if (!v.enabled) continue;
    const key = v.name.toLowerCase();
    if (!varMap.has(key)) {
      varMap.set(key, v.value);
    }
  }

  if (varMap.size === 0) return text;

  // Build alternation pattern from variable names, longest first to avoid partial matches
  const names = [...varMap.keys()].sort((a, b) => b.length - a.length);

  // Filter out any names that collide with reserved prefixes
  const safeNames = names.filter((n) => {
    return (
      !RESERVED_PREFIXES.some((prefix) => n === prefix) &&
      !/^\d+$/.test(n) && // skip purely numeric names
      n !== '*' &&
      n !== '-' &&
      n !== '!'
    ); // skip special chars
  });

  if (safeNames.length === 0) return text;

  // Escape regex special characters in variable names
  const escaped = safeNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\$(${escaped.join('|')})(?![a-zA-Z0-9_])`, 'gi');

  return text.replace(pattern, (_, name) => {
    return varMap.get(name.toLowerCase()) ?? `$${name}`;
  });
}
