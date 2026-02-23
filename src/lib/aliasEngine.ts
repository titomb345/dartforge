import type { Alias, AliasMatchMode, ExpandedCommand, ExpansionResult } from '../types/alias';
import { DIRECTIONS, OPPOSITE_DIRECTIONS } from './constants';
import type { Direction } from './constants';
import { splitCommands, parseDirective } from './commandUtils';

/** Maximum nesting depth to prevent infinite alias recursion */
const MAX_EXPANSION_DEPTH = 10;

/** Cache compiled regex patterns to avoid re-compiling on every input */
const regexCache = new Map<string, RegExp | null>();

/** Build regex alternation from directions list (already sorted longest-first) */
const DIR_PATTERN = DIRECTIONS.join('|');

/** Speedwalk segment regex: matches patterns like 3n, 2e, 5sw, 2out, etc. */
const SPEEDWALK_SEGMENT_RE = new RegExp(`(\\d+)(${DIR_PATTERN})`, 'gi');

/** Full speedwalk line: entire input must be direction groups, e.g., "3n2e4s" */
const SPEEDWALK_LINE_RE = new RegExp(`^(?:\\d+(?:${DIR_PATTERN}))+$`, 'i');

/**
 * Expand a speedwalk pattern into individual direction commands.
 * e.g., "3n2e" → ["n", "n", "n", "e", "e"]
 */
function expandSpeedwalk(input: string): string[] {
  const commands: string[] = [];
  let match: RegExpExecArray | null;
  SPEEDWALK_SEGMENT_RE.lastIndex = 0;
  while ((match = SPEEDWALK_SEGMENT_RE.exec(input)) !== null) {
    const count = parseInt(match[1], 10);
    const dir = match[2].toLowerCase();
    for (let i = 0; i < count; i++) {
      commands.push(dir);
    }
  }
  return commands;
}

/** Options threaded through expansion for special substitutions. */
interface SubstitutionOptions {
  activeCharacter?: string | null;
}

/**
 * Look up the opposite of a direction string. Returns empty string if not a direction.
 */
function getOppositeDirection(dir: string): string {
  const lower = dir.toLowerCase() as Direction;
  return OPPOSITE_DIRECTIONS[lower] ?? '';
}

/**
 * Substitute argument variables in an alias body.
 *
 * - $1..$9          — positional args (space-delimited)
 * - $*              — all arguments after trigger
 * - $-              — all arguments except the last one
 * - $!              — the last argument only
 * - $opposite1..$9  — opposite direction of positional arg
 * - $me             — active character name
 */
function substituteArgs(body: string, args: string[], options?: SubstitutionOptions): string {
  const allArgs = args.join(' ');
  const allButLast = args.slice(0, -1).join(' ');
  const lastArg = args.length > 0 ? args[args.length - 1] : '';

  let result = body;

  // Replace $* first (greedy — all args)
  result = result.replace(/\$\*/g, allArgs);
  // Replace $- (all but last)
  result = result.replace(/\$-/g, allButLast);
  // Replace $! (last arg)
  result = result.replace(/\$!/g, lastArg);
  // Replace $Me (capitalized character name) — before $me to avoid partial match
  const charName = options?.activeCharacter ?? '';
  result = result.split('$Me').join(charName.charAt(0).toUpperCase() + charName.slice(1));
  // Replace $me (active character name)
  result = result.split('$me').join(charName);
  // Replace $opposite1..$opposite9 (direction reversal)
  for (let i = 1; i <= 9; i++) {
    result = result.split(`$opposite${i}`).join(getOppositeDirection(args[i - 1] ?? ''));
  }
  // Replace $1..$9 positional (AFTER $opposite to avoid partial match)
  for (let i = 1; i <= 9; i++) {
    result = result.split(`$${i}`).join(args[i - 1] ?? '');
  }

  return result;
}

/** Specificity order: exact > prefix > regex */
const MATCH_MODE_PRIORITY: Record<AliasMatchMode, number> = {
  exact: 0,
  prefix: 1,
  regex: 2,
};

/**
 * Try to match a single command segment against the alias list.
 * Aliases are checked in specificity order (exact → prefix → regex)
 * so that e.g. an exact "port" fires before a prefix "port".
 * Returns the matched alias and extracted arguments, or null.
 */
function matchAlias(
  segment: string,
  aliases: Alias[],
): { alias: Alias; args: string[] } | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const restParts = parts.slice(1);

  // Sort by specificity so exact matches always win over prefix over regex
  const sorted = [...aliases].sort(
    (a, b) => MATCH_MODE_PRIORITY[a.matchMode] - MATCH_MODE_PRIORITY[b.matchMode],
  );

  for (const alias of sorted) {
    if (!alias.enabled) continue;

    switch (alias.matchMode) {
      case 'exact': {
        const lower = trimmed.toLowerCase();
        const pat = alias.pattern.toLowerCase();
        if (lower === pat) {
          return { alias, args: [] };
        }
        break;
      }
      case 'prefix': {
        const lower = trimmed.toLowerCase();
        const pat = alias.pattern.toLowerCase();
        if (lower === pat) {
          return { alias, args: [] };
        }
        if (lower.startsWith(pat) && trimmed[pat.length] === ' ') {
          const rest = trimmed.slice(pat.length).trim();
          return { alias, args: rest ? rest.split(/\s+/) : [] };
        }
        break;
      }
      case 'regex': {
        let re = regexCache.get(alias.pattern);
        if (re === undefined) {
          try {
            re = new RegExp(alias.pattern, 'i');
          } catch (e) {
            console.warn(`[Alias] Invalid regex pattern "${alias.pattern}":`, e);
            re = null;
          }
          regexCache.set(alias.pattern, re);
        }
        if (re) {
          const match = re.exec(trimmed);
          if (match) {
            const args =
              match.length > 1
                ? match.slice(1).map((g) => g ?? '')
                : restParts;
            return { alias, args };
          }
        }
        break;
      }
    }
  }

  return null;
}

/**
 * Expand a single command segment through alias matching and substitution.
 * Handles nested expansion with depth protection.
 */
function expandSegment(
  segment: string,
  aliases: Alias[],
  enableSpeedwalk: boolean,
  depth: number,
  subOptions?: SubstitutionOptions,
): ExpandedCommand[] {
  const trimmed = segment.trim();
  if (!trimmed) return [{ type: 'send', text: '' }];

  // Recursion protection
  if (depth >= MAX_EXPANSION_DEPTH) {
    return [
      { type: 'echo', text: '[Alias recursion limit reached]' },
      { type: 'send', text: trimmed },
    ];
  }

  // Check for speedwalk before alias matching
  if (enableSpeedwalk && SPEEDWALK_LINE_RE.test(trimmed)) {
    const dirs = expandSpeedwalk(trimmed);
    return dirs.map((d) => ({ type: 'send' as const, text: d }));
  }

  // Try alias match
  const match = matchAlias(trimmed, aliases);
  if (!match) {
    return [parseDirective(trimmed)];
  }

  // Substitute arguments into alias body (variables expanded at execution time)
  const expanded = substituteArgs(match.alias.body, match.args, subOptions);

  // Split the expanded body on semicolons and recursively expand each part
  const subSegments = splitCommands(expanded);
  const commands: ExpandedCommand[] = [];
  for (const sub of subSegments) {
    const subTrimmed = sub.trim();
    if (!subTrimmed) continue;

    // Check if this is a directive (no alias expansion needed)
    if (/^\/(delay|echo|spam|var|convert)\s/i.test(subTrimmed)) {
      commands.push(parseDirective(subTrimmed));
    } else {
      // Recursively expand (may hit another alias)
      commands.push(...expandSegment(subTrimmed, aliases, enableSpeedwalk, depth + 1, subOptions));
    }
  }

  return commands;
}

/**
 * Find the position of the next unescaped semicolon or newline in the input.
 * Respects /spam and /var which consume the rest of the line.
 * Returns -1 if none found.
 */
function findNextSplit(input: string): number {
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\\' && input[i + 1] === ';') {
      i++; // skip escaped semicolon
    } else if (input[i] === ';') {
      const before = input.slice(0, i).trim();
      // /spam and /var consume the rest of the line (semicolons included)
      if (/^\/spam\s+\d+\s/i.test(before) || /^\/var\s+(-g\s+)?\S+\s/i.test(before)) {
        continue;
      }
      return i;
    } else if (input[i] === '\r') {
      continue;
    } else if (input[i] === '\n') {
      return i;
    }
  }
  return -1;
}

/**
 * Main entry point: expand raw user input through the alias system.
 *
 * Processes the input left-to-right, trying prefix alias matching BEFORE
 * semicolon splitting so that prefix aliases with $* capture the full
 * argument string (including semicolons). Falls back to semicolon splitting
 * when no prefix alias matches.
 *
 * Also handles speedwalk expansion, special directives, and nested alias
 * expansion with recursion protection.
 */
export function expandInput(
  input: string,
  aliases: Alias[],
  options?: { enableSpeedwalk?: boolean; activeCharacter?: string | null },
): ExpansionResult {
  const enableSpeedwalk = options?.enableSpeedwalk ?? true;
  const subOptions: SubstitutionOptions = {
    activeCharacter: options?.activeCharacter,
  };

  const commands: ExpandedCommand[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    const trimmed = remaining.trim();
    if (!trimmed) break;

    // Try matching the full remaining text against a prefix alias BEFORE
    // splitting on semicolons. This ensures prefix aliases with $* capture
    // everything after the trigger (including semicolons in arguments).
    const fullMatch = matchAlias(trimmed, aliases);
    if (fullMatch && fullMatch.alias.matchMode === 'prefix' && fullMatch.args.length > 0) {
      // Prefix alias with arguments — it consumes the rest of the line
      commands.push(...expandSegment(trimmed, aliases, enableSpeedwalk, 0, subOptions));
      break;
    }

    // No prefix alias match on the full remaining text.
    // Extract the next command up to the first unescaped semicolon/newline.
    const splitPos = findNextSplit(remaining);
    if (splitPos === -1) {
      // No semicolons — process the rest as a single segment
      commands.push(...expandSegment(trimmed, aliases, enableSpeedwalk, 0, subOptions));
      break;
    }

    const segment = remaining.slice(0, splitPos).trim();
    remaining = remaining.slice(splitPos + 1);

    if (segment) {
      commands.push(...expandSegment(segment, aliases, enableSpeedwalk, 0, subOptions));
    }
  }

  // If no commands produced, send the raw input
  if (commands.length === 0) {
    commands.push({ type: 'send', text: input });
  }

  return { commands };
}
