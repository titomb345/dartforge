/** Metadata for a DartMUD spell */
export interface SpellInfo {
  /** Cast abbreviation, e.g. "mhs" for minor_heal_self */
  abbr: string;
  /** Cast time in rounds */
  castTime: number;
  /** Aura cost description, e.g. "dim red", "orange" */
  auraCost: string;
}

/**
 * Complete spell database keyed by spell name (underscored, lowercase).
 * Source: DartMUD `spells` command output.
 */
export const SPELL_DATA: Record<string, SpellInfo> = {
  "ambrosius's_encouragement": { abbr: 'ae', castTime: 1, auraCost: 'orange' },
  "blackthorn's_cold_cure": { abbr: 'bcc', castTime: 10, auraCost: 'yellowish-orange' },
  "blackthorn's_mass_recall": { abbr: 'bmr', castTime: 14, auraCost: 'greenish-blue' },
  blue_armor: { abbr: 'ba', castTime: 7, auraCost: 'green' },
  blue_bolt: { abbr: 'bb', castTime: 2, auraCost: 'blue' },
  blur: { abbr: 'bl', castTime: 5, auraCost: 'reddish-orange' },
  blur_other: { abbr: 'bo', castTime: 6, auraCost: 'yellowish-orange' },
  "bor's_doom": { abbr: 'bd', castTime: 1, auraCost: 'red' },
  buzz_animal_invisibility: { abbr: 'bai', castTime: 7, auraCost: 'orange' },
  "chanakae's_unction": { abbr: 'cu', castTime: 6, auraCost: 'orangish-yellow' },
  chill: { abbr: 'ch', castTime: 1, auraCost: 'dim red' },
  "dannika's_calm": { abbr: 'dc', castTime: 1, auraCost: 'orangish-red' },
  "daring's_rage": { abbr: 'dr', castTime: 8, auraCost: 'orangish-yellow' },
  "delior's_pocket_dimension": { abbr: 'dpd', castTime: 5, auraCost: 'yellowish-orange' },
  detect_alignment: { abbr: 'da', castTime: 2, auraCost: 'red' },
  detect_disease: { abbr: 'dd', castTime: 2, auraCost: 'red' },
  detect_magic: { abbr: 'dm', castTime: 5, auraCost: 'reddish-orange' },
  detect_soul: { abbr: 'ds', castTime: 10, auraCost: 'yellowish-orange' },
  detect_spell: { abbr: 'dsp', castTime: 10, auraCost: 'red' },
  dispel_spell: { abbr: 'disp', castTime: 5, auraCost: 'orange' },
  dog_fart: { abbr: 'df', castTime: 2, auraCost: 'dim red' },
  enlarge: { abbr: 'en', castTime: 7, auraCost: 'orange' },
  flare: { abbr: 'fl', castTime: 4, auraCost: 'yellow' },
  "flynn's_flimflam": { abbr: 'fff', castTime: 2, auraCost: 'orange' },
  "gered's_tongues": { abbr: 'gt', castTime: 12, auraCost: 'orange' },
  greater_heal_other: { abbr: 'gho', castTime: 6, auraCost: 'orangish-yellow' },
  greater_heal_self: { abbr: 'ghs', castTime: 3, auraCost: 'orange' },
  green_armor: { abbr: 'ga', castTime: 7, auraCost: 'greenish-yellow' },
  green_bolt: { abbr: 'gb', castTime: 2, auraCost: 'green' },
  green_focus: { abbr: 'gf', castTime: 15, auraCost: 'orangish-yellow' },
  guiding_light: { abbr: 'gl', castTime: 8, auraCost: 'yellowish-orange' },
  heal_other: { abbr: 'ho', castTime: 6, auraCost: 'orange' },
  heal_self: { abbr: 'hs', castTime: 3, auraCost: 'reddish-orange' },
  ignite: { abbr: 'ig', castTime: 2, auraCost: 'dim red' },
  influenza_cure: { abbr: 'ic', castTime: 10, auraCost: 'yellowish-orange' },
  "jonathan's_ears": { abbr: 'je', castTime: 4, auraCost: 'reddish-orange' },
  "jonathan's_fareyes": { abbr: 'jfe', castTime: 4, auraCost: 'reddish-orange' },
  "jonathan's_neareyes": { abbr: 'jne', castTime: 4, auraCost: 'reddish-orange' },
  "jonathan's_nighteyes": { abbr: 'jnv', castTime: 4, auraCost: 'reddish-orange' },
  "jonathan's_nose": { abbr: 'jn', castTime: 4, auraCost: 'reddish-orange' },
  lesser_heal_other: { abbr: 'lho', castTime: 6, auraCost: 'reddish-orange' },
  lesser_heal_self: { abbr: 'lhs', castTime: 3, auraCost: 'red' },
  lesser_portal: { abbr: 'lp', castTime: 12, auraCost: 'yellowish-orange' },
  lesser_summon_animal: { abbr: 'lsa', castTime: 14, auraCost: 'orange' },
  lesser_wound_transfer: { abbr: 'lwt', castTime: 8, auraCost: 'reddish-orange' },
  "lirrin's_candle": { abbr: 'lc', castTime: 2, auraCost: 'dim red' },
  "lirrin's_glow": { abbr: 'lg', castTime: 1, auraCost: 'very dim red' },
  "lirrin's_light": { abbr: 'll', castTime: 4, auraCost: 'yellowish-orange' },
  "lirrin's_torch": { abbr: 'lt', castTime: 4, auraCost: 'reddish-orange' },
  mark: { abbr: 'm', castTime: 10, auraCost: 'reddish-orange' },
  minor_dispel: { abbr: 'md', castTime: 3, auraCost: 'red' },
  minor_heal_other: { abbr: 'mho', castTime: 6, auraCost: 'red' },
  minor_heal_self: { abbr: 'mhs', castTime: 3, auraCost: 'dim red' },
  minor_imbed: { abbr: 'mi', castTime: 28, auraCost: 'yellowish-green' },
  minor_summon_animal: { abbr: 'msa', castTime: 10, auraCost: 'orangish-red' },
  mystic_arrow: { abbr: 'ma', castTime: 2, auraCost: 'dim red' },
  nials_nibble: { abbr: 'nn', castTime: 2, auraCost: 'orangish-red' },
  obfuscate_scroll: { abbr: 'os', castTime: 4, auraCost: 'red' },
  orange_armor: { abbr: 'oa', castTime: 7, auraCost: 'yellowish-orange' },
  orange_bolt: { abbr: 'ob', castTime: 2, auraCost: 'orange' },
  orange_focus: { abbr: 'of', castTime: 15, auraCost: 'reddish-orange' },
  "orella's_deep_storage": { abbr: 'ods', castTime: 14, auraCost: 'greenish-yellow' },
  other_spell_store: { abbr: 'oss', castTime: 20, auraCost: 'yellowish-orange' },
  "pol's_death_curse": { abbr: 'pdc', castTime: 25, auraCost: 'orange' },
  "pol's_gloom": { abbr: 'pg', castTime: 1, auraCost: 'very dim red' },
  "pol's_shadows": { abbr: 'ps', castTime: 4, auraCost: 'orange' },
  "pol's_twilight": { abbr: 'pt', castTime: 2, auraCost: 'red' },
  preserve_corpse: { abbr: 'pc', castTime: 15, auraCost: 'orangish-red' },
  "quest's_vigor": { abbr: 'qv', castTime: 5, auraCost: 'yellowish-orange' },
  recall: { abbr: 'rec', castTime: 3, auraCost: 'greenish-yellow' },
  red_armor: { abbr: 'ra', castTime: 7, auraCost: 'orange' },
  red_bolt: { abbr: 'rb', castTime: 2, auraCost: 'red' },
  red_dragon_fire: { abbr: 'rdf', castTime: 2, auraCost: 'orange' },
  red_focus: { abbr: 'rf', castTime: 15, auraCost: 'red' },
  refresh_other: { abbr: 'ro', castTime: 2, auraCost: 'orange' },
  restore_other_limb: { abbr: 'rol', castTime: 15, auraCost: 'green' },
  restore_self_limb: { abbr: 'rsl', castTime: 15, auraCost: 'yellow' },
  resurrection: { abbr: 'res', castTime: 20, auraCost: 'yellow' },
  reveal_aura: { abbr: 'rva', castTime: 2, auraCost: 'reddish-orange' },
  sanctuary: { abbr: 'sanc', castTime: 5, auraCost: 'greenish-blue' },
  sense_aura: { abbr: 'sa', castTime: 2, auraCost: 'red' },
  shrink: { abbr: 'sh', castTime: 7, auraCost: 'orange' },
  "skyrdin's_zephyr": { abbr: 'sz', castTime: 3, auraCost: 'red' },
  "sulamar's_spark": { abbr: 'spark', castTime: 1, auraCost: 'dim red' },
  tell: { abbr: 't', castTime: 0, auraCost: 'orangish-red' },
  "troy's_helping_hand": { abbr: 'thh', castTime: 4, auraCost: 'orange' },
  warm: { abbr: 'w', castTime: 1, auraCost: 'dim red' },
  yellow_armor: { abbr: 'ya', castTime: 7, auraCost: 'yellow' },
  yellow_bolt: { abbr: 'yb', castTime: 2, auraCost: 'yellow' },
  yellow_focus: { abbr: 'yf', castTime: 15, auraCost: 'orange' },
  flameblade: { abbr: 'fb', castTime: 4, auraCost: 'orange' },
  frostaxe: { abbr: 'fa', castTime: 4, auraCost: 'orange' },
  shillelagh: { abbr: 'shl', castTime: 4, auraCost: 'orange' },
  thunderhammer: { abbr: 'th', castTime: 4, auraCost: 'orange' },
  reincarnation: { abbr: 'reincarnation', castTime: 0, auraCost: 'unknown' },
};

/** Look up spell info by abbreviation */
export function getSpellByAbbr(abbr: string): { name: string; info: SpellInfo } | null {
  for (const [name, info] of Object.entries(SPELL_DATA)) {
    if (info.abbr === abbr) return { name, info };
  }
  return null;
}
