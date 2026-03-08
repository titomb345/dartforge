/**
 * Transform "show skills" and "show quick skills" output to inject skill counts.
 *
 * Format 1 — "show skills" (single column, full tier names, period-terminated):
 *   butchering:                Superb.
 *   language#magic:            A High Master.
 *
 * Format 2 — "show quick skills" (two-column, abbreviated tiers, no period):
 *   juggling                       Fair            milling                        Proficient
 *   two-handed hafted              Mythic          daring                         Mythic
 */

import type { SkillRecord } from '../types/skills';

// ---------------------------------------------------------------------------
// Shared constants & helpers
// ---------------------------------------------------------------------------

const FILTERED_SKILLS = new Set(['concentration', 'encumbrance', 'held', 'worn']);

/** ANSI CSI regex for stripping (same as ansiUtils but local to avoid circular deps). */
const ANSI_CSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface SkillLookup {
  [skillName: string]: SkillRecord;
}

/**
 * Normalize a raw skill name for lookup: trim whitespace and lowercase.
 * Returns null if the name is empty or a known false positive.
 */
function normalizeSkillName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (!name || FILTERED_SKILLS.has(name)) return null;
  return name;
}

/** Look up a skill record by raw display name. Returns the record or null. */
function lookupSkill(rawName: string, skills: SkillLookup): SkillRecord | null {
  const name = normalizeSkillName(rawName);
  if (!name) return null;
  return skills[name] ?? null;
}

/**
 * Get the number of digits in the highest skill count, for consistent padding.
 * Returns at least 1.
 */
function maxCountWidth(skills: SkillLookup): number {
  let max = 0;
  for (const key in skills) {
    const c = skills[key].count;
    if (c > max) max = c;
  }
  return max > 0 ? String(max).length : 1;
}

/** Format a count like `(123)` right-padded so total width is consistent. */
function fmtCount(count: number, width: number): string {
  return `(${count})`.padEnd(width + 2); // +2 for the parens
}

/**
 * Build an ANSI-colored count tag, or blank padding when count is -1.
 * `tierPad` is extra leading spaces to align tier names to a common width.
 * Total visible width is always tierPad + 1(space) + width + 2(parens).
 */
function countTag(count: number, width: number, tierPad = 0): string {
  const pad = ' '.repeat(tierPad);
  if (count < 0) return pad + ' '.repeat(width + 3); // space + ( + digits + )
  return `${pad} \x1b[36m${fmtCount(count, width)}\x1b[0m`;
}

// ---------------------------------------------------------------------------
// Format 1: "show skills" — single column with colon + period
// ---------------------------------------------------------------------------

const SHOW_SKILLS_RE = /^([\w'\-# ]+):\s+([A-Za-z ]+)\.$/;

/** Max display length of full tier names — "A Grand Master" at 14 chars. */
const MAX_SHOW_TIER_LEN = 14;

function transformShowSkills(
  stripped: string,
  raw: string,
  skills: SkillLookup,
): string | null {
  const m = SHOW_SKILLS_RE.exec(stripped);
  if (!m) return null;

  const skillName = normalizeSkillName(m[1]);
  if (!skillName) return null;
  // Reject if skill name has more than 1 space (likely not a real skill line)
  if ((skillName.match(/ /g) || []).length > 1) return null;

  const record = skills[skillName];
  if (!record) return null;

  // Append count before the line ending (\r\n or \n), padded to align
  const endMatch = raw.match(/(\r?\n)$/);
  const ending = endMatch ? endMatch[1] : '';
  const line = ending ? raw.slice(0, -ending.length) : raw;
  const w = maxCountWidth(skills);
  const tierPad = MAX_SHOW_TIER_LEN - m[2].trim().length;
  return `${line}${countTag(record.count, w, tierPad)}${ending}`;
}

// ---------------------------------------------------------------------------
// Format 2: "show quick skills" — two-column with tier-name alternation
// ---------------------------------------------------------------------------

/**
 * Hardcoded quick-skills tier display names — these haven't changed in decades.
 * Sorted longest-first to prevent partial regex matches.
 * Includes both the display form (articles stripped) and abbreviations.
 */
const QUICK_TIER_NAMES = [
  'consummate', 'proficient', 'not very good', 'below average', 'above average',
  'grand master', 'high master', 'unskilled', 'legendary', 'excellent',
  'very good', 'no skill', 'virtuoso', 'renowned', 'beginner', 'eminent',
  'average', 'mythic', 'master', 'superb', 'expert', 'adroit', 'adept',
  'novice', 'leggy', 'tyro', 'prof', 'good', 'fair', 'able', 'poor',
  'nvg', 'hm', 'gm', 'vg', 'ba', 'aa',
].sort((a, b) => b.length - a.length);

/** Set of known tier names for fast lookup after regex match. */
const QUICK_TIER_SET = new Set(QUICK_TIER_NAMES);

const QUICK_TIER_RE = new RegExp(
  `\\s{2,}(${QUICK_TIER_NAMES.join('|')})(?=\\s{2,}|\\s*$)`,
  'gi',
);


/**
 * Quick-skills lines use bright white (\x1b[1;37m) and/or bright cyan
 * (\x1b[1;36m). Require at least one — a single-skill line (odd count,
 * last row) will only have one color.
 */
function hasQuickSkillColors(raw: string): boolean {
  return raw.includes('\x1b[1;37m') || raw.includes('\x1b[1;36m');
}

function transformQuickSkills(
  _stripped: string,
  raw: string,
  skills: SkillLookup,
): string | null {
  if (!hasQuickSkillColors(raw)) return null;

  // Re-strip ANSI from raw so character positions are perfectly aligned.
  // The _stripped parameter has .trim() and prompt removal applied by the
  // output filter, which shifts positions relative to raw.
  const aligned = raw.replace(ANSI_CSI_RE, '');

  // First pass: find all tier positions
  const tierMatches: { index: number; endOffset: number }[] = [];
  let match: RegExpExecArray | null;
  QUICK_TIER_RE.lastIndex = 0;
  while ((match = QUICK_TIER_RE.exec(aligned)) !== null) {
    if (!QUICK_TIER_SET.has(match[1].toLowerCase())) continue;
    tierMatches.push({
      index: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  if (tierMatches.length === 0) return null;

  // Second pass: extract skill name before each tier, look up count.
  // Always inject for every tier so columns stay aligned.
  const injections: { offset: number; count: number }[] = [];
  for (let i = 0; i < tierMatches.length; i++) {
    const tm = tierMatches[i];
    const regionStart = i > 0 ? tierMatches[i - 1].endOffset : 0;
    const before = aligned.substring(regionStart, tm.index);
    const record = lookupSkill(before, skills);
    injections.push({
      offset: tm.endOffset,
      count: record ? record.count : -1,
    });
  }
  if (injections.length === 0) return null;

  // Map aligned-text offsets to raw-string offsets
  const insertions = mapStrippedOffsetsToRaw(raw, injections.map((i) => i.offset));

  // Insert from right to left so offsets don't shift.
  // Fixed-width injection keeps column 2 aligned.
  const w = maxCountWidth(skills);
  let result = raw;
  for (let i = injections.length - 1; i >= 0; i--) {
    const rawOffset = insertions[i];
    if (rawOffset < 0) continue;
    result = result.substring(0, rawOffset) + countTag(injections[i].count, w) + result.substring(rawOffset);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Offset mapping
// ---------------------------------------------------------------------------

/**
 * Map an array of character offsets in stripped text to corresponding offsets
 * in the raw (ANSI-coded) text.
 */
function mapStrippedOffsetsToRaw(raw: string, offsets: number[]): number[] {
  const sorted = offsets.map((o, i) => ({ o, i })).sort((a, b) => a.o - b.o);
  const result = new Array<number>(offsets.length).fill(-1);

  let strippedPos = 0;
  let rawPos = 0;
  let nextIdx = 0;

  while (rawPos < raw.length && nextIdx < sorted.length) {
    if (raw[rawPos] === '\x1b' && rawPos + 1 < raw.length && raw[rawPos + 1] === '[') {
      rawPos += 2;
      while (rawPos < raw.length && !/[A-Za-z]/.test(raw[rawPos])) rawPos++;
      if (rawPos < raw.length) rawPos++;
      continue;
    }

    if (strippedPos === sorted[nextIdx].o) {
      result[sorted[nextIdx].i] = rawPos;
      nextIdx++;
      continue;
    }

    strippedPos++;
    rawPos++;
  }

  while (nextIdx < sorted.length && strippedPos === sorted[nextIdx].o) {
    result[sorted[nextIdx].i] = rawPos;
    nextIdx++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Try to transform a skill readout line (either format) by appending counts.
 * Returns the modified raw segment, or null if the line isn't a skill readout.
 */
export function transformSkillReadout(
  stripped: string,
  raw: string,
  skills: SkillLookup,
): string | null {
  return transformShowSkills(stripped, raw, skills)
    ?? transformQuickSkills(stripped, raw, skills);
}
