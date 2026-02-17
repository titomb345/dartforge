import type { SkillTier } from '../types/skills';

export const SKILL_TIERS: SkillTier[] = [
  { level: 1,  name: 'no skill',       abbr: 'noskill',     min: 0,     max: 0 },
  { level: 2,  name: 'unskilled',      abbr: 'unskilled',   min: 1,     max: 3 },
  { level: 3,  name: 'a tyro',         abbr: 'tyro',        min: 4,     max: 9 },
  { level: 4,  name: 'a novice',       abbr: 'novice',      min: 10,    max: 17 },
  { level: 5,  name: 'a beginner',     abbr: 'beginner',    min: 18,    max: 29 },
  { level: 6,  name: 'poor',           abbr: 'poor',        min: 30,    max: 49 },
  { level: 7,  name: 'not very good',  abbr: 'nvg',         min: 50,    max: 69 },
  { level: 8,  name: 'below average',  abbr: 'ba',          min: 70,    max: 89 },
  { level: 9,  name: 'average',        abbr: 'avg',         min: 90,    max: 109 },
  { level: 10, name: 'above average',  abbr: 'aa',          min: 110,   max: 134 },
  { level: 11, name: 'able',           abbr: 'able',        min: 135,   max: 164 },
  { level: 12, name: 'fair',           abbr: 'fair',        min: 165,   max: 199 },
  { level: 13, name: 'proficient',     abbr: 'prof',        min: 200,   max: 239 },
  { level: 14, name: 'good',           abbr: 'good',        min: 240,   max: 284 },
  { level: 15, name: 'adroit',         abbr: 'adroit',      min: 285,   max: 334 },
  { level: 16, name: 'very good',      abbr: 'vg',          min: 335,   max: 389 },
  { level: 17, name: 'excellent',      abbr: 'excellent',   min: 390,   max: 449 },
  { level: 18, name: 'an expert',      abbr: 'expert',      min: 450,   max: 514 },
  { level: 19, name: 'superb',         abbr: 'superb',      min: 515,   max: 584 },
  { level: 20, name: 'a master',       abbr: 'master',      min: 585,   max: 659 },
  { level: 21, name: 'eminent',        abbr: 'eminent',     min: 660,   max: 739 },
  { level: 22, name: 'an adept',       abbr: 'adept',       min: 740,   max: 824 },
  { level: 23, name: 'renowned',       abbr: 'renowned',    min: 825,   max: 919 },
  { level: 24, name: 'a high master',  abbr: 'hm',          min: 920,   max: 1049 },
  { level: 25, name: 'consummate',     abbr: 'consummate',  min: 1050,  max: 1199 },
  { level: 26, name: 'a virtuoso',     abbr: 'virtuoso',    min: 1200,  max: 1399 },
  { level: 27, name: 'a grand master', abbr: 'gm',          min: 1400,  max: 1699 },
  { level: 28, name: 'legendary',      abbr: 'leggy',       min: 1700,  max: 9999 },
  { level: 29, name: 'mythic',         abbr: 'mythic',      min: 10000, max: 99999 },
];

/** Given an improve count, return the matching skill tier */
export function getTierForCount(count: number): SkillTier {
  for (let i = SKILL_TIERS.length - 1; i >= 0; i--) {
    if (count >= SKILL_TIERS[i].min) return SKILL_TIERS[i];
  }
  return SKILL_TIERS[0];
}

/** Given a tier name (as reported by the MUD), return the matching tier */
export function getTierByName(name: string): SkillTier | undefined {
  const lower = name.toLowerCase();
  return SKILL_TIERS.find((t) => t.name === lower);
}

/** Number of improves remaining to reach the next tier, or 0 if maxed */
export function getImprovesToNextTier(count: number): number {
  const tier = getTierForCount(count);
  const idx = SKILL_TIERS.indexOf(tier);
  if (idx >= SKILL_TIERS.length - 1) return 0;
  return SKILL_TIERS[idx + 1].min - count;
}

/** Progress percentage within current tier toward the next tier (0–100) */
export function getTierProgress(count: number): number {
  const tier = getTierForCount(count);
  const idx = SKILL_TIERS.indexOf(tier);
  if (idx >= SKILL_TIERS.length - 1) return 100;
  const nextTier = SKILL_TIERS[idx + 1];
  const range = nextTier.min - tier.min;
  if (range === 0) return 100;
  return Math.min(100, Math.round(((count - tier.min) / range) * 100));
}
