import type { SkillCategory } from '../types/skills';

/** Metadata for a non-spell DartMUD skill */
export interface SkillInfo {
  /** Short abbreviation, or null if none */
  abbr: string | null;
  /** Which category this skill belongs to */
  category: SkillCategory;
}

/**
 * Complete non-spell skill database keyed by skill name (lowercase).
 * Abbreviations are optional — fill them in as needed for aptitude lookups, etc.
 */
export const SKILL_DATA: Record<string, SkillInfo> = {
  // ── Combat ──────────────────────────────────────────────────
  'aim blows': { abbr: 'a', category: 'combat' },
  archery: { abbr: null, category: 'combat' },
  'attack speed': { abbr: 's', category: 'combat' },
  bashing: { abbr: null, category: 'combat' },
  brawling: { abbr: null, category: 'combat' },
  control: { abbr: null, category: 'combat' },
  daring: { abbr: 'd', category: 'combat' },
  dodge: { abbr: null, category: 'combat' },
  fighting: { abbr: null, category: 'combat' },
  hafted: { abbr: null, category: 'combat' },
  'multiple attacks': { abbr: null, category: 'combat' },
  offensive: { abbr: 'b', category: 'combat' },
  parry: { abbr: null, category: 'combat' },
  'shield use': { abbr: 'su', category: 'combat' },
  'split defense': { abbr: 'sd', category: 'combat' },
  sword: { abbr: null, category: 'combat' },
  thrown: { abbr: null, category: 'combat' },
  'two-handed hafted': { abbr: '2hh', category: 'combat' },
  'two-handed sword': { abbr: '2hs', category: 'combat' },

  // ── Magic (foundational) ────────────────────────────────────
  channelling: { abbr: null, category: 'magic' },
  inscription: { abbr: null, category: 'magic' },
  'language#magic': { abbr: null, category: 'magic' },
  'magic theory': { abbr: 'mt', category: 'magic' },
  'spell casting': { abbr: 'sc', category: 'magic' },

  // ── Crafting ────────────────────────────────────────────────
  alchemy: { abbr: null, category: 'crafting' },
  appraisal: { abbr: null, category: 'crafting' },
  brewing: { abbr: null, category: 'crafting' },
  butchering: { abbr: null, category: 'crafting' },
  ceramics: { abbr: null, category: 'crafting' },
  chandlery: { abbr: null, category: 'crafting' },
  construction: { abbr: null, category: 'crafting' },
  cooking: { abbr: null, category: 'crafting' },
  farming: { abbr: null, category: 'crafting' },
  fishing: { abbr: null, category: 'crafting' },
  herbalism: { abbr: null, category: 'crafting' },
  herding: { abbr: null, category: 'crafting' },
  hunting: { abbr: null, category: 'crafting' },
  'leather working': { abbr: 'lw', category: 'crafting' },
  lumbering: { abbr: null, category: 'crafting' },
  metallurgy: { abbr: null, category: 'crafting' },
  milling: { abbr: null, category: 'crafting' },
  mining: { abbr: null, category: 'crafting' },
  sewing: { abbr: null, category: 'crafting' },
  smithing: { abbr: null, category: 'crafting' },
  'stone working': { abbr: 'sw', category: 'crafting' },
  tanning: { abbr: null, category: 'crafting' },
  'wood working': { abbr: 'ww', category: 'crafting' },

  // ── Movement ────────────────────────────────────────────────
  acrobatics: { abbr: null, category: 'movement' },
  climbing: { abbr: null, category: 'movement' },
  hiking: { abbr: null, category: 'movement' },
  navigation: { abbr: 'nav', category: 'movement' },
  riding: { abbr: null, category: 'movement' },
  sailing: { abbr: null, category: 'movement' },
  spelunking: { abbr: null, category: 'movement' },
  swimming: { abbr: null, category: 'movement' },
  travel: { abbr: null, category: 'movement' },

  // ── Thief ───────────────────────────────────────────────────
  ambush: { abbr: null, category: 'thief' },
  hiding: { abbr: null, category: 'thief' },
  'lock picking': { abbr: null, category: 'thief' },
  pilfer: { abbr: null, category: 'thief' },
  sneaking: { abbr: null, category: 'thief' },
};

/** Look up a skill by its abbreviation. Returns the full skill name or null. */
export function getSkillByAbbr(abbr: string): string | null {
  const lower = abbr.toLowerCase();
  for (const [name, info] of Object.entries(SKILL_DATA)) {
    if (info.abbr === lower) return name;
  }
  return null;
}
