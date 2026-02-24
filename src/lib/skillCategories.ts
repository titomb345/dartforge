import type { SkillCategory } from '../types/skills';

const COMBAT_SKILLS = new Set([
  'aim blows',
  'archery',
  'attack speed',
  'bashing',
  'brawling',
  'control',
  'daring',
  'dodge',
  'fighting',
  'hafted',
  'multiple attacks',
  'offensive',
  'parry',
  'shield use',
  'split defense',
  'sword',
  'thrown',
  'two-handed hafted',
  'two-handed sword',
]);

const MAGIC_SKILLS = new Set([
  'channelling',
  'inscription',
  'language#magic',
  'magic theory',
  'spell casting',
]);

const SPELL_SKILLS = new Set([
  'blur',
  'buzz_animal_invisibility',
  'chill',
  "dannika's_calm",
  "delior's_pocket_dimension",
  'detect_soul',
  'dog_fart',
  'flameblade',
  "flynn's_flimflam",
  'frostaxe',
  'green_armor',
  'green_focus',
  'heal_other',
  'heal_self',
  'influenza_cure',
  "jonathan's_ears",
  "jonathan's_fareyes",
  "jonathan's_neareyes",
  "jonathan's_nighteyes",
  "jonathan's_nose",
  'lesser_heal_other',
  'lesser_heal_self',
  "lirrin's_candle",
  "lirrin's_glow",
  'mark',
  'minor_heal_other',
  'minor_heal_self',
  'mystic_arrow',
  'orange_fire_bolt',
  'orange_focus',
  "pol's_gloom",
  'preserve_corpse',
  "quest's_vigor",
  'recall',
  'red_armor',
  'red_fire_bolt',
  'red_focus',
  'refresh_other',
  'reincarnation',
  'reveal_aura',
  'sense_aura',
  'shillelagh',
  "skyrdin's_zephyr",
  'thunderhammer',
  "troy's_helping_hand",
  'warm',
  'yellow_armor',
  'yellow_fire_bolt',
]);

const CRAFTING_SKILLS = new Set([
  'alchemy',
  'appraisal',
  'brewing',
  'butchering',
  'ceramics',
  'chandlery',
  'construction',
  'cooking',
  'farming',
  'fishing',
  'herbalism',
  'herding',
  'hunting',
  'leather working',
  'lumbering',
  'metallurgy',
  'milling',
  'mining',
  'sewing',
  'smithing',
  'stone working',
  'tanning',
  'wood working',
]);

const MOVEMENT_SKILLS = new Set([
  'acrobatics',
  'climbing',
  'hiking',
  'navigation',
  'riding',
  'sailing',
  'spelunking',
  'swimming',
  'travel',
]);

const THIEF_SKILLS = new Set([
  'ambush',
  'hiding',
  'lock picking',
  'lockpicking',
  'pilfer',
  'sneaking',
]);

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
