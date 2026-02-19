import type { SkillCategory } from '../types/skills';

const COMBAT_SKILLS = new Set([
  'aim blows', 'archery', 'attack speed', 'bashing', 'brawling',
  'control', 'daring', 'dodge', 'fighting', 'hafted',
  'multiple attacks', 'offensive', 'parry', 'shield use', 'split defense',
  'sword', 'thrown', 'two handed hafted', 'two handed sword',
]);

const MAGIC_SKILLS = new Set([
  'channelling', 'inscription', 'language magic', 'magic theory', 'spell casting',
]);

const SPELL_SKILLS = new Set([
  'blur', 'buzz animal invisibility', 'chill',
  'dannikas calm', 'deliors pocket dimension', 'detect soul', 'dog fart',
  'flameblade', 'flynns flimflam', 'frostaxe',
  'grand summon animal', 'green armor', 'green focus',
  'heal other', 'heal self', 'influenza cure',
  'jonathans ears', 'jonathans fareyes', 'jonathans neareyes',
  'jonathans nighteyes', 'jonathans nose',
  'lesser heal other', 'lesser heal self',
  'lirrins candle', 'lirrins glow', 'lungs of the fish',
  'major summon animal', 'mark',
  'minor heal other', 'minor heal self', 'mystic arrow',
  'orange fire bolt', 'orange focus',
  'pols gloom', 'preserve corpse', 'quests vigor',
  'recall', 'red armor', 'red fire bolt', 'red focus',
  'refresh other', 'reincarnation', 'reveal aura',
  'sense aura',
  'shillelagh', 'skyrdins zephyr',
  'thunderhammer', 'troys helping hand', 'warm',
  'yellow armor', 'yellow fire bolt',
]);

const CRAFTING_SKILLS = new Set([
  'alchemy', 'appraisal', 'brewing', 'butchering', 'ceramics', 'chandlery',
  'construction', 'cooking', 'farming', 'fishing', 'herbalism',
  'herding', 'hunting',
  'leather working', 'lumbering', 'metallurgy', 'milling', 'mining',
  'sewing', 'smithing', 'stone working', 'tanning', 'wood working',
]);

const MOVEMENT_SKILLS = new Set([
  'acrobatics', 'climbing', 'hiking', 'navigation', 'riding', 'sailing',
  'spelunking', 'swimming', 'travel',
]);

const THIEF_SKILLS = new Set([
  'ambush', 'hiding', 'lock picking', 'lockpicking', 'pilfer', 'sneaking',
]);

/** Returns the category for a skill name. Unknown skills default to 'other'. */
export function getSkillCategory(skillName: string): SkillCategory {
  const lower = skillName.toLowerCase();

  if (COMBAT_SKILLS.has(lower)) return 'combat';
  if (MAGIC_SKILLS.has(lower)) return 'magic';
  if (SPELL_SKILLS.has(lower)) return 'spells';
  if (CRAFTING_SKILLS.has(lower)) return 'crafting';
  if (MOVEMENT_SKILLS.has(lower)) return 'movement';
  if (THIEF_SKILLS.has(lower)) return 'thief';

  // Auto-detect language skills (except "language magic" which is magic)
  if (lower.startsWith('language ') && lower !== 'language magic') return 'language';

  return 'other';
}

// --- Sub-categories ---

const COMBAT_WEAPONS = new Set([
  'sword', 'hafted', 'brawling', 'two handed sword', 'two handed hafted', 'shield use',
]);

const COMBAT_SODA = new Set([
  'aim blows', 'offensive', 'daring', 'attack speed',
]);

const COMBAT_DEFENSE = new Set([
  'parry', 'control', 'split defense',
]);

/** Returns the sub-category for a skill, or undefined if no sub-grouping applies. */
export function getSkillSubcategory(skillName: string, category: SkillCategory): string | undefined {
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
  'combat', 'magic', 'spells', 'crafting', 'movement', 'thief', 'language', 'pets', 'other',
];
