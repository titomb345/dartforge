import type { Trigger, TriggerMatchMode, TriggerMatch } from '../types/trigger';
import type { ExpandedCommand } from '../types/alias';
import { splitCommands, parseDirective } from './commandUtils';

/** Specificity order: exact > substring > regex */
const MATCH_MODE_PRIORITY: Record<TriggerMatchMode, number> = {
  exact: 0,
  substring: 1,
  regex: 2,
};

/** Per-trigger last-fired timestamps for cooldown enforcement */
const cooldownMap = new Map<string, number>();

/** Global rate limiter: timestamps of recent trigger fires */
let recentFires: number[] = [];
const MAX_FIRES_PER_SECOND = 50;

/** Cache compiled regex patterns to avoid re-compiling on every match */
const regexCache = new Map<string, RegExp | null>();

/** Active multi-line buffers: triggerId → accumulated lines */
const mlBuffers = new Map<string, { stripped: string[]; raw: string[] }>();
const ML_MAX_LINES = 10;

/**
 * Match a single stripped output line against the trigger list.
 * Returns all matching triggers (multiple triggers can fire on the same line).
 * Respects cooldown and global rate limit.
 */
/** Counter to throttle cooldownMap pruning (runs every ~100 calls) */
let pruneCounter = 0;

export function matchTriggers(
  strippedLine: string,
  rawLine: string,
  triggers: Trigger[]
): TriggerMatch[] {
  const now = Date.now();

  // Prune old entries from global rate limiter
  recentFires = recentFires.filter((t) => now - t < 1000);

  // Periodically prune cooldownMap of deleted trigger IDs
  if (++pruneCounter >= 100) {
    pruneCounter = 0;
    const activeIds = new Set(triggers.map((t) => t.id));
    for (const id of cooldownMap.keys()) {
      if (!activeIds.has(id)) cooldownMap.delete(id);
    }
  }

  const matches: TriggerMatch[] = [];

  // Sort by specificity
  const sorted = [...triggers].sort(
    (a, b) => MATCH_MODE_PRIORITY[a.matchMode] - MATCH_MODE_PRIORITY[b.matchMode]
  );

  for (const trigger of sorted) {
    if (!trigger.enabled) continue;
    // Skip multi-line triggers in the single-line loop
    if (trigger.multiLine && trigger.endPattern) continue;

    // Global rate limit check
    if (recentFires.length >= MAX_FIRES_PER_SECOND) break;

    // Per-trigger cooldown check
    const lastFired = cooldownMap.get(trigger.id) ?? 0;
    if (trigger.cooldownMs > 0 && now - lastFired < trigger.cooldownMs) continue;

    const result = matchSingle(strippedLine, rawLine, trigger);
    if (result) {
      matches.push(result);
      cooldownMap.set(trigger.id, now);
      recentFires.push(now);
    }
  }

  // --- Multi-line trigger processing ---

  // Phase 1: Check active buffers — append line and test end pattern
  for (const trigger of sorted) {
    if (!trigger.enabled || !trigger.multiLine || !trigger.endPattern) continue;
    const buf = mlBuffers.get(trigger.id);
    if (!buf) continue;

    if (recentFires.length >= MAX_FIRES_PER_SECOND) break;

    buf.stripped.push(strippedLine);
    buf.raw.push(rawLine);

    const endMatched = testEndPattern(trigger.endPattern, strippedLine);
    if (endMatched || buf.stripped.length >= ML_MAX_LINES) {
      // Buffer complete — join and match full pattern
      const result = fireMultiLineBuffer(trigger, buf, now);
      mlBuffers.delete(trigger.id);
      if (result) {
        matches.push(result);
        cooldownMap.set(trigger.id, now);
        recentFires.push(now);
      }
    }
  }

  // Phase 2: Check multi-line triggers not currently buffering — test start pattern
  for (const trigger of sorted) {
    if (!trigger.enabled || !trigger.multiLine || !trigger.endPattern) continue;
    if (mlBuffers.has(trigger.id)) continue;

    if (recentFires.length >= MAX_FIRES_PER_SECOND) break;

    const startResult = matchSingle(strippedLine, rawLine, trigger);
    if (startResult) {
      // Start buffering
      const buf = { stripped: [strippedLine], raw: [rawLine] };

      // Check if end pattern also matches on the same line (single-line case)
      const endMatched = testEndPattern(trigger.endPattern, strippedLine);
      if (endMatched) {
        // Fire immediately with this single line
        const lastFired = cooldownMap.get(trigger.id) ?? 0;
        if (trigger.cooldownMs > 0 && now - lastFired < trigger.cooldownMs) continue;
        const result = fireMultiLineBuffer(trigger, buf, now);
        if (result) {
          matches.push(result);
          cooldownMap.set(trigger.id, now);
          recentFires.push(now);
        }
      } else {
        mlBuffers.set(trigger.id, buf);
      }
    }
  }

  return matches;
}

/** Test an end pattern (regex) against a stripped line */
function testEndPattern(endPattern: string, strippedLine: string): boolean {
  const cacheKey = `end:${endPattern}`;
  let re = regexCache.get(cacheKey);
  if (re === undefined) {
    try {
      re = new RegExp(endPattern, 'i');
    } catch {
      re = null;
    }
    regexCache.set(cacheKey, re);
  }
  return re ? re.test(strippedLine) : false;
}

/** Join a multi-line buffer and run the trigger's pattern against it for captures */
function fireMultiLineBuffer(
  trigger: Trigger,
  buf: { stripped: string[]; raw: string[] },
  _now: number
): TriggerMatch | null {
  const joinedStripped = buf.stripped.join(' ');
  const joinedRaw = buf.raw.join(' ');

  // Run trigger's pattern as regex against joined text for captures
  const cacheKey = `ml:${trigger.pattern}`;
  let re = regexCache.get(cacheKey);
  if (re === undefined) {
    try {
      re = new RegExp(trigger.pattern, 'i');
    } catch {
      re = null;
    }
    regexCache.set(cacheKey, re);
  }

  if (re) {
    const match = re.exec(joinedStripped);
    if (match) {
      const captures = match.slice(0).map((g) => g ?? '');
      return { trigger, line: joinedStripped, rawLine: joinedRaw, captures };
    }
  }

  // Pattern didn't match joined text — still fire with basic captures
  return { trigger, line: joinedStripped, rawLine: joinedRaw, captures: [joinedStripped] };
}

function matchSingle(stripped: string, raw: string, trigger: Trigger): TriggerMatch | null {
  switch (trigger.matchMode) {
    case 'exact':
      if (stripped === trigger.pattern) {
        return { trigger, line: stripped, rawLine: raw, captures: [stripped] };
      }
      return null;

    case 'substring': {
      const idx = stripped.toLowerCase().indexOf(trigger.pattern.toLowerCase());
      if (idx >= 0) {
        const matched = stripped.substring(idx, idx + trigger.pattern.length);
        return { trigger, line: stripped, rawLine: raw, captures: [matched] };
      }
      return null;
    }

    case 'regex': {
      let re = regexCache.get(trigger.pattern);
      if (re === undefined) {
        try {
          re = new RegExp(trigger.pattern, 'i');
        } catch (e) {
          console.warn(`[Trigger] Invalid regex pattern "${trigger.pattern}":`, e);
          re = null;
        }
        regexCache.set(trigger.pattern, re);
      }
      if (re) {
        const match = re.exec(stripped);
        if (match) {
          const captures = match.slice(0).map((g) => g ?? '');
          return { trigger, line: stripped, rawLine: raw, captures };
        }
      }
      return null;
    }
  }
}

/**
 * Expand a trigger match into commands, using the same body syntax as aliases.
 * Substitutes $0 (matched text), $1–$9 (regex captures), $line (full line), $me.
 */
export function expandTriggerBody(
  body: string,
  match: TriggerMatch,
  activeCharacter?: string | null,
  separator?: string
): ExpandedCommand[] {
  let result = body;

  // $line = full stripped line
  result = result.split('$line').join(match.line);
  // $Me = capitalized character name — before $me to avoid partial match
  const charName = activeCharacter ?? '';
  result = result.split('$Me').join(charName.charAt(0).toUpperCase() + charName.slice(1));
  // $me = active character
  result = result.split('$me').join(charName);
  // $0 = full regex match or matched substring
  result = result.split('$0').join(match.captures[0] ?? '');
  // $1–$9 = capture groups
  for (let i = 9; i >= 1; i--) {
    result = result.split(`$${i}`).join(match.captures[i] ?? '');
  }

  // Split on configured separator and parse directives (variables expanded at execution time)
  const segments = splitCommands(result, separator);
  const commands: ExpandedCommand[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    commands.push(parseDirective(trimmed));
  }

  return commands;
}

/** Reset all cooldown state, caches, and multi-line buffers (call on disconnect) */
export function resetTriggerCooldowns(): void {
  cooldownMap.clear();
  recentFires = [];
  regexCache.clear();
  mlBuffers.clear();
}
