/** A single tier in the skill level progression */
export interface SkillTier {
  level: number;
  name: string;
  abbr: string;
  min: number;
  max: number;
}

/** Skill category for grouping in the UI */
export type SkillCategory = 'combat' | 'magic' | 'spells' | 'crafting' | 'language' | 'thief' | 'other';

/** Persisted record for one skill (category/subcategory derived at runtime) */
export interface SkillRecord {
  skill: string;
  count: number;
  lastImproveAt: string; // ISO timestamp
}

/** Per-character store file structure (skills-{name}.json) */
export interface CharacterSkillFile {
  /** The character's own skills */
  skills: { [skillName: string]: SkillRecord };
  /** Skills for pets/companions belonging to this character */
  pets: { [petName: string]: { [skillName: string]: SkillRecord } };
}

/** Match result types from the output processor */
export type SkillMatchResult =
  | { type: 'self-improve'; skill: string }
  | { type: 'pet-improve'; pet: string; skill: string }
  | { type: 'mistake' }
  | { type: 'shown-skill'; skill: string; level: string };
