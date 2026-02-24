import type { SkillCategory } from '../types/skills';
import { SPELL_DATA } from './spellData';
import { SKILL_DATA } from './skillData';

// Derive category sets from SKILL_DATA — single source of truth
function skillsForCategory(cat: SkillCategory): Set<string> {
  const set = new Set<string>();
  for (const [name, info] of Object.entries(SKILL_DATA)) {
    if (info.category === cat) set.add(name);
  }
  return set;
}

const COMBAT_SKILLS = skillsForCategory('combat');
const MAGIC_SKILLS = skillsForCategory('magic');
const SPELL_SKILLS = new Set(Object.keys(SPELL_DATA));
const CRAFTING_SKILLS = skillsForCategory('crafting');
const MOVEMENT_SKILLS = skillsForCategory('movement');
const THIEF_SKILLS = skillsForCategory('thief');

/** Returns all categories for a skill name. Most skills belong to one; language#magic belongs to both magic and language. */
export function getSkillCategory(skillName: string): SkillCategory[] {
  const lower = skillName.toLowerCase();
  const cats: SkillCategory[] = [];

  if (COMBAT_SKILLS.has(lower)) cats.push('combat');
  if (MAGIC_SKILLS.has(lower)) cats.push('magic');
  if (SPELL_SKILLS.has(lower)) cats.push('spells');
  if (CRAFTING_SKILLS.has(lower)) cats.push('crafting');
  if (MOVEMENT_SKILLS.has(lower)) cats.push('movement');
  if (THIEF_SKILLS.has(lower)) cats.push('thief');

  // Auto-detect language skills (language#common, language#elvish, etc.)
  if (lower.startsWith('language#')) cats.push('language');

  return cats.length > 0 ? cats : ['other'];
}

// --- Sub-categories ---

const COMBAT_WEAPONS = new Set([
  'sword',
  'hafted',
  'brawling',
  'two-handed sword',
  'two-handed hafted',
  'shield use',
]);

const COMBAT_SODA = new Set(['aim blows', 'offensive', 'daring', 'attack speed']);

const COMBAT_DEFENSE = new Set(['parry', 'control', 'split defense']);

/** Returns the sub-category for a skill, or undefined if no sub-grouping applies. */
export function getSkillSubcategory(
  skillName: string,
  category: SkillCategory
): string | undefined {
  const lower = skillName.toLowerCase();

  if (category === 'combat') {
    if (COMBAT_WEAPONS.has(lower)) return 'Weapons';
    if (COMBAT_SODA.has(lower)) return 'SODA';
    if (COMBAT_DEFENSE.has(lower)) return 'Defense';
    return 'General';
  }

  return undefined;
}

/** Display order for sub-categories within each category */
export const SUBCATEGORY_ORDER: Partial<Record<SkillCategory, string[]>> = {
  combat: ['Weapons', 'SODA', 'Defense', 'General'],
};

/** Display labels for each category */
export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  combat: 'Combat',
  magic: 'Magic',
  spells: 'Spells',
  crafting: 'Crafting',
  movement: 'Movement',
  language: 'Language',
  thief: 'Thief',
  pets: 'Pets',
  other: 'Other',
};

/** Display order for categories */
export const CATEGORY_ORDER: SkillCategory[] = [
  'combat',
  'magic',
  'spells',
  'crafting',
  'movement',
  'thief',
  'language',
  'pets',
  'other',
];
