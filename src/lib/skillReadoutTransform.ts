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
import { SKILL_TIERS } from './skillTiers';

// ---------------------------------------------------------------------------
// Format 1: "show skills" — reuse the same regex as skillPatterns.ts
// ---------------------------------------------------------------------------

const SHOW_SKILLS_RE = /^([\w'\-# ]+):\s+([A-Za-z ]+)\.$/;
const FILTERED_SKILLS = new Set(['concentration', 'encumbrance', 'held', 'worn']);

// ---------------------------------------------------------------------------
// Format 2: "show quick skills" — build a tier-name alternation regex
// ---------------------------------------------------------------------------

/** Map from quick-skills display name (lowercase) → canonical tier name */
const QUICK_TIER_MAP = new Map<string, string>();

for (const tier of SKILL_TIERS) {
  // Single-word tier names: capitalize first letter (e.g. "fair" → "Fair")
  // Multi-word with article: drop article, capitalize (e.g. "a master" → "Master")
  // Short abbreviations: uppercase (e.g. "hm" → "HM", "gm" → "GM", "vg" → "VG")
  const words = tier.name.split(' ');
  const stripped = words.filter((w) => w !== 'a' && w !== 'an').join(' ');

  // Map the full display name
  QUICK_TIER_MAP.set(stripped.toLowerCase(), tier.name);

  // Map the abbreviation too (covers "hm", "gm", "vg", "ba", "aa", "nvg", etc.)
  QUICK_TIER_MAP.set(tier.abbr.toLowerCase(), tier.name);
}

// Build alternation pattern — longest first to prevent partial matches
const QUICK_TIER_NAMES = Array.from(new Set(QUICK_TIER_MAP.keys()))
  .sort((a, b) => b.length - a.length);

// Match tier display name preceded by 2+ spaces, followed by 2+ spaces or end-of-line.
// The tier name is case-insensitive.
const QUICK_TIER_RE = new RegExp(
  `\\s{2,}(${QUICK_TIER_NAMES.join('|')})(?=\\s{2,}|\\s*$)`,
  'gi',
);

// Quick-skills lines start with spaces, then a skill name, then 2+ spaces, then a tier.
// This distinguishes them from prose or other output.
const QUICK_LINE_PREFIX_RE = /^\s{2,}\S/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SkillLookup {
  [skillName: string]: SkillRecord;
}

/**
 * If `stripped` is a "show skills" line (format 1), return a modified version
 * of `raw` with the skill count appended. Otherwise return null.
 */
function transformShowSkills(
  stripped: string,
  raw: string,
  skills: SkillLookup,
): string | null {
  const m = SHOW_SKILLS_RE.exec(stripped);
  if (!m) return null;

  const skillName = m[1].trim().toLowerCase();
  if (FILTERED_SKILLS.has(skillName)) return null;
  if ((skillName.match(/ /g) || []).length > 1) return null;

  const record = skills[skillName];
  if (!record) return null;

  // Append count before the line ending (\r\n or \n)
  const endMatch = raw.match(/(\r?\n)$/);
  const ending = endMatch ? endMatch[1] : '';
  const line = ending ? raw.slice(0, -ending.length) : raw;
  return `${line} \x1b[36m(${record.count})\x1b[0m${ending}`;
}

/**
 * If `stripped` is a "show quick skills" line (format 2), return a modified
 * version of `raw` with skill counts injected after each tier name.
 * Otherwise return null.
 */
function transformQuickSkills(
  stripped: string,
  raw: string,
  skills: SkillLookup,
): string | null {
  if (!QUICK_LINE_PREFIX_RE.test(stripped)) return null;

  // Collect all tier matches and figure out which skill each belongs to
  const injections: { offset: number; count: number }[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  QUICK_TIER_RE.lastIndex = 0;
  while ((match = QUICK_TIER_RE.exec(stripped)) !== null) {
    const tierDisplay = match[1].toLowerCase();
    if (!QUICK_TIER_MAP.has(tierDisplay)) continue;

    // Find the skill name: text before this match, after the previous match or line start
    const regionStart = injections.length > 0
      ? injections[injections.length - 1].offset // crude — use the stripped text
      : 0;
    const before = stripped.substring(regionStart, match.index).trim();

    // In quick skills format, the skill name is the trimmed text in the column.
    // Normalize underscores to spaces (quick skills uses e.g. "skyrdin's_zephyr").
    const skillName = before.replace(/_/g, ' ').toLowerCase();
    if (!skillName || FILTERED_SKILLS.has(skillName)) continue;

    const record = skills[skillName];
    if (!record) continue;

    // Record where to inject (position after the tier name in stripped text)
    const insertAt = match.index + match[0].length;
    injections.push({ offset: insertAt, count: record.count });
  }

  if (injections.length === 0) return null;

  // Build the replacement by injecting counts into the raw string.
  // Map stripped-text offsets to raw-string offsets by walking both in parallel,
  // skipping ANSI escape sequences in the raw string.
  const insertions = mapStrippedOffsetsToRaw(raw, injections.map((i) => i.offset));

  // Insert count annotations from right to left so offsets don't shift
  let result = raw;
  for (let i = injections.length - 1; i >= 0; i--) {
    const rawOffset = insertions[i];
    if (rawOffset < 0) continue;
    const tag = ` \x1b[36m(${injections[i].count})\x1b[0m`;
    result = result.substring(0, rawOffset) + tag + result.substring(rawOffset);
  }

  return result;
}

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
    // Skip ANSI escape sequences
    if (raw[rawPos] === '\x1b' && rawPos + 1 < raw.length && raw[rawPos + 1] === '[') {
      rawPos += 2;
      while (rawPos < raw.length && !/[A-Za-z]/.test(raw[rawPos])) rawPos++;
      if (rawPos < raw.length) rawPos++; // skip terminator
      continue;
    }

    if (strippedPos === sorted[nextIdx].o) {
      result[sorted[nextIdx].i] = rawPos;
      nextIdx++;
      // Don't advance rawPos — multiple offsets could map to the same position
      continue;
    }

    strippedPos++;
    rawPos++;
  }

  // Handle offsets at end of string
  while (nextIdx < sorted.length && strippedPos === sorted[nextIdx].o) {
    result[sorted[nextIdx].i] = rawPos;
    nextIdx++;
  }

  return result;
}

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
