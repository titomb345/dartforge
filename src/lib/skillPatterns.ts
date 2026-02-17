import type { SkillMatchResult } from '../types/skills';

/** Self-improve: * You think your [SKILL] skill has improved. * */
const SELF_IMPROVE_RE = /^\* You think your (.+?) skill has improved\. \*$/;

/** Pet-improve: * You think that [NAME]'s [SKILL] skill has improved. * */
const PET_IMPROVE_RE = /^\* You think that (.+?)'s (.+?) skill has improved\. \*$/;

/** Mistake: (But you were mistaken.) */
const MISTAKE_RE = /^\(But you were mistaken\.\)$/;

/** Shown skill response: [SKILL]:   [LEVEL]. (from "show skills: <name>") */
const SHOWN_SKILL_RE = /^([\w'\-# ]+):\s+([A-Za-z ]+)\.$/;

/** Skill names that are false positives for the shown-skill pattern */
const FILTERED_SKILLS = new Set(['concentration', 'encumbrance', 'held', 'worn']);

/**
 * Match a single ANSI-stripped line against known skill patterns.
 * Lines may have leading "> " prompts which are stripped before matching.
 */
export function matchSkillLine(line: string): SkillMatchResult | null {
  // Strip leading "> " prompts (MUD sometimes prepends these)
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  let match = cleaned.match(SELF_IMPROVE_RE);
  if (match) {
    return { type: 'self-improve', skill: match[1].toLowerCase() };
  }

  match = cleaned.match(PET_IMPROVE_RE);
  if (match) {
    return { type: 'pet-improve', pet: match[1].toLowerCase(), skill: match[2].toLowerCase() };
  }

  match = cleaned.match(MISTAKE_RE);
  if (match) {
    return { type: 'mistake' };
  }

  match = cleaned.match(SHOWN_SKILL_RE);
  if (match) {
    const skill = match[1].trim().toLowerCase();
    const level = match[2].trim().toLowerCase();

    // Filter false positives
    if (FILTERED_SKILLS.has(skill)) return null;
    // Reject if skill name has more than 1 space (likely not a real skill)
    if ((skill.match(/ /g) || []).length > 1) return null;

    return { type: 'shown-skill', skill, level };
  }

  return null;
}
