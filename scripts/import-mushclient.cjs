#!/usr/bin/env node
/**
 * Import skill data from a MUSHclient .mcl world file into DartForge
 * skill store files (skills-{name}.json).
 *
 * Usage: node scripts/import-mushclient.js <path-to-mcl-file> [character-name]
 *
 * If character-name is not provided, it reads the "player" attribute from the MCL.
 * Outputs to the Tauri app data directory for DartForge.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Allowlist: only these variable names are imported as self skills ---
const KNOWN_SKILLS = new Set([
  // Combat
  'acrobatics', 'aim_blows', 'archery', 'attack_speed', 'bashing', 'brawling',
  'control', 'daring', 'dodge', 'fighting', 'hafted',
  'multiple_attacks', 'offensive', 'parry', 'shield_use', 'split_defense',
  'sword', 'thrown', 'two_handed_hafted', 'two_handed_sword',
  // Crafting
  'alchemy', 'brewing', 'butchering', 'ceramics', 'chandlery',
  'construction', 'cooking', 'farming', 'fishing', 'herbalism',
  'leather_working', 'lumbering', 'metallurgy', 'milling', 'mining',
  'sewing', 'smithing', 'stone_working', 'tanning', 'wood_working',
  // Magic / spells
  'blur', 'buzz_animal_invisibility', 'channelling', 'chill',
  'dannikas_calm', 'deliors_pocket_dimension', 'detect_soul', 'dog_fart',
  'flameblade', 'flynns_flimflam', 'frostaxe',
  'grand_summon_animal', 'green_armor', 'green_focus',
  'heal_other', 'heal_self', 'influenza_cure', 'inscription',
  'jonathans_ears', 'jonathans_fareyes', 'jonathans_neareyes',
  'jonathans_nighteyes', 'jonathans_nose',
  'lesser_heal_other', 'lesser_heal_self',
  'lirrins_candle', 'lirrins_glow', 'lungs_of_the_fish',
  'magic_theory', 'major_summon_animal', 'mark',
  'minor_heal_other', 'minor_heal_self', 'mystic_arrow',
  'orange_fire_bolt', 'orange_focus',
  'pols_gloom', 'preserve_corpse', 'quests_vigor',
  'recall', 'red_armor', 'red_fire_bolt', 'red_focus',
  'refresh_other', 'reincarnation', 'reveal_aura',
  'sense_aura',
  'shillelagh', 'skyrdins_zephyr', 'spell_casting',
  'thunderhammer', 'troys_helping_hand', 'warm',
  'yellow_armor', 'yellow_fire_bolt',
  // Movement / stealth
  'climbing', 'herding', 'hiding', 'hiking', 'hunting',
  'lock_picking', 'lockpicking', 'navigation', 'pilfer',
  'riding', 'sailing', 'sneaking', 'spelunking', 'swimming', 'travel',
  // Other skills
  'animal_training', 'appraisal', 'enlightenment', 'juggling',
  'music_drum', 'music_lute', 'teaching',
  // Languages
  'language_braman', 'language_catfolk', 'language_common',
  'language_crabfolk', 'language_dark_tongue', 'language_dwarvish',
  'language_eastern', 'language_elvish', 'language_fuzzy',
  'language_gnomish', 'language_goblin', 'language_kreen',
  'language_magic', 'language_mohnkeetongue', 'language_northern',
  'language_ogre', 'language_orcish', 'language_rowan',
  'language_sasquatch', 'language_southern', 'language_spyder',
  'language_troll', 'language_undercommon', 'language_western',
]);

// Pet variable pattern: starts with a capitalized name followed by underscore
// e.g., "Shadehearts_parry", "Chucks_fighting"
const PET_VAR_RE = /^([A-Z][a-z]+(?:s|hearts?|faxs?)?)_(.+)$/;

function parseMcl(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract player name
  const playerMatch = content.match(/player="([^"]+)"/);
  const playerName = playerMatch ? playerMatch[1].toLowerCase() : null;

  // Extract all variables
  const varRegex = /<variable name="([^"]+)">([^<]*)<\/variable>/g;
  const variables = [];
  let m;
  while ((m = varRegex.exec(content)) !== null) {
    variables.push({ name: m[1], value: m[2] });
  }

  return { playerName, variables };
}

function categorizeVariables(variables) {
  const selfSkills = {};
  const petSkills = {}; // { petName: { skillName: count } }
  const skipped = [];

  for (const { name, value } of variables) {
    // Must be a positive integer
    const count = parseInt(value, 10);
    if (isNaN(count) || count < 1 || value.includes('.') || value !== String(count)) {
      skipped.push({ name, value, reason: 'non-numeric' });
      continue;
    }

    // Check if it's a pet skill (Capitalized name prefix)
    const petMatch = name.match(PET_VAR_RE);
    if (petMatch) {
      const petName = petMatch[1].toLowerCase();
      const skillName = petMatch[2].replace(/_/g, ' ');
      if (!petSkills[petName]) petSkills[petName] = {};
      petSkills[petName][skillName] = count;
      continue;
    }

    // Check if it's a known self skill
    if (KNOWN_SKILLS.has(name)) {
      const skillName = name.replace(/_/g, ' ');
      selfSkills[skillName] = count;
    } else {
      skipped.push({ name, value, reason: 'not a skill' });
    }
  }

  return { selfSkills, petSkills, skipped };
}

function buildSkillFile(selfSkills, petSkills) {
  const now = new Date().toISOString();

  const skills = {};
  for (const [name, count] of Object.entries(selfSkills)) {
    skills[name] = { skill: name, count, lastImproveAt: now };
  }

  const pets = {};
  for (const [petName, petSkillMap] of Object.entries(petSkills)) {
    pets[petName] = {};
    for (const [name, count] of Object.entries(petSkillMap)) {
      pets[petName][name] = { skill: name, count, lastImproveAt: now };
    }
  }

  return { skills, pets };
}

// --- Main ---
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/import-mushclient.js <path-to-mcl-file> [character-name]');
  process.exit(1);
}

const mclPath = args[0];
const overrideName = args[1];

if (!fs.existsSync(mclPath)) {
  console.error(`File not found: ${mclPath}`);
  process.exit(1);
}

const { playerName, variables } = parseMcl(mclPath);
const charName = (overrideName || playerName || 'unknown').toLowerCase();

console.log(`Player: ${charName}`);
console.log(`Total variables found: ${variables.length}`);
console.log();

const { selfSkills, petSkills, skipped } = categorizeVariables(variables);

console.log(`Self skills: ${Object.keys(selfSkills).length}`);
console.log(`Pets: ${Object.keys(petSkills).length}`);
for (const [pet, skills] of Object.entries(petSkills)) {
  console.log(`  ${pet}: ${Object.keys(skills).length} skills`);
}
console.log(`Skipped: ${skipped.length} variables`);
console.log();

// Print self skills sorted by name
console.log('=== Self Skills ===');
const sortedSelf = Object.entries(selfSkills).sort((a, b) => a[0].localeCompare(b[0]));
for (const [name, count] of sortedSelf) {
  console.log(`  ${name}: ${count}`);
}
console.log();

// Print pet skills
for (const [pet, skills] of Object.entries(petSkills)) {
  console.log(`=== ${pet} ===`);
  const sorted = Object.entries(skills).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count}`);
  }
  console.log();
}

// Build the skill file
const skillFile = buildSkillFile(selfSkills, petSkills);

// Determine output path — Tauri app data directory
const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'com.dartforge');
const outputFileName = `skills-${charName}.json`;
const outputPath = path.join(appDataDir, outputFileName);

// Also write the settings.json activeCharacter
const settingsPath = path.join(appDataDir, 'settings.json');

console.log(`Output file: ${outputPath}`);
console.log();

// Check if output dir exists
if (!fs.existsSync(appDataDir)) {
  console.log(`App data directory doesn't exist yet: ${appDataDir}`);
  console.log('Run DartForge at least once first, or create the directory manually.');
  console.log();
  console.log('Writing to current directory instead...');
  const localPath = path.join(process.cwd(), outputFileName);
  fs.writeFileSync(localPath, JSON.stringify(skillFile, null, 2));
  console.log(`Written to: ${localPath}`);
} else {
  fs.writeFileSync(outputPath, JSON.stringify(skillFile, null, 2));
  console.log(`Written: ${outputPath}`);

  // Update activeCharacter in settings
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      // corrupt settings, start fresh
    }
  }
  settings.activeCharacter = charName;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`Updated activeCharacter in: ${settingsPath}`);
}

console.log();
console.log('Done! Restart DartForge to see imported skills.');
