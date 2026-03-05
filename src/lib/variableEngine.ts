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

/** Cache compiled regex patterns keyed by the sorted variable name list */
let cachedPatternKey = '';
let cachedPattern: RegExp | null = null;

function getVariablePattern(safeNames: string[]): RegExp {
  const key = safeNames.join('|');
  if (key === cachedPatternKey && cachedPattern) return cachedPattern;

  const escaped = safeNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  cachedPattern = new RegExp(`\\$(${escaped.join('|')})(?![a-zA-Z0-9_])`, 'gi');
  cachedPatternKey = key;
  return cachedPattern;
}

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

  const pattern = getVariablePattern(safeNames);
  // Reset lastIndex since the regex has the 'g' flag and is cached
  pattern.lastIndex = 0;

  return text.replace(pattern, (_, name) => {
    return varMap.get(name.toLowerCase()) ?? `$${name}`;
  });
}
