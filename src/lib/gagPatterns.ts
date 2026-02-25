/**
 * Gag groups — predefined pattern sets that suppress annoying MUD output.
 * Ported from dartmudlet's scripts_gags.lua.
 */

export type GagGroupId =
  | 'pets'
  | 'creatures'
  | 'citizens'
  | 'trainers'
  | 'sparring'
  | 'channels'
  | 'quests';

export type GagGroupSettings = Record<GagGroupId, boolean>;

export const DEFAULT_GAG_GROUPS: GagGroupSettings = {
  pets: false,
  creatures: false,
  citizens: false,
  trainers: false,
  sparring: false,
  channels: false,
  quests: false,
};

export const GAG_GROUP_IDS: GagGroupId[] = [
  'pets',
  'creatures',
  'citizens',
  'trainers',
  'sparring',
  'channels',
  'quests',
];

export interface GagGroup {
  id: GagGroupId;
  label: string;
  description: string;
  patterns: RegExp[];
}

// ---------------------------------------------------------------------------
// Pet emotes (47 patterns)
// ---------------------------------------------------------------------------

const PET_PATTERNS: RegExp[] = [
  /^(\w+) (brays|digs|pants|rests|sleeps|snorts|spits|squeaks)\./,
  /^(\w+) stares (intently|piercingly)/,
  /^(\w+) (hops|rolls|snuffles|springs|wanders) around/,
  /^(\w+) follows (\w+) around/,
  /^(\w+) (bites|eyes|washes|watches) (\w+)\./,
  /^(\w+) (hoots|snorts|whickers|whistles) softly/,
  /^(\w+) looks for something to (eat|steal)/,
  /^(\w+) chases (her|his) tail/,
  /^(\w+) chatters (loudly|noisily)/,
  /^(\w+) licks (her|his) (paw|tail)/,
  /^(\w+) idly chews some cud/,
  /^(\w+) nibbles on some grass/,
  /^(\w+) paws at the ground with a hoof/,
  /^(\w+) fluffs up (her|his) feathers/,
  /^(\w+) wags (her|his) tail/,
  /^(\w+) squeaks (at|quietly|to)/,
  /^(\w+) (chirrups|nuzzles)/,
  /^(\w+) takes a bath/,
  /^(\w+) snorts and tosses/,
  /^(\w+) sniffs at/,
  /^(\w+) sniffs the air/,
  /^(\w+) twitches (her|his) tail/,
  /^(\w+) washes (her|his) face/,
  /^(\w+) grooms (her|his) (fur|tail)/,
  /^(\w+) looks about cautiously/,
  /^(\w+) looks around for some grass/,
  /^(\w+) curls up (and|in|with)/,
  /^(\w+) rests lazily/,
  /^(\w+) eyes (\w+) as if calculating/,
  /^(\w+) (skulks|trots) about/,
  /^(\w+) (pounces|jumps) on/,
  /^(\w+) rubs up against/,
  /^(\w+) (preens|washes) (her|him)self/,
  /^(\w+) sniffs around (for|where)/,
  /^(\w+) brays obnoxiously/,
  /^(\w+) helps (\w+) dig/,
  /^(\w+) hangs upside down/,
  /^(\w+) looks for bugs to eat/,
  /^(\w+) searches the area for something/,
  /^(\w+) wrestles with (\w+)/,
  /^(\w+) stands beside (\w+)/,
  /^(\w+) exclaims, '(H|h)ee-haw/,
  /^(\w+) pivots, looking for insects/,
  /^(\w+) croaks loudly/,
  /^(\w+) wipes (her|his) eye with (her|his) hind leg/,
];

// ---------------------------------------------------------------------------
// Wild creature emotes (33 patterns)
// ---------------------------------------------------------------------------

const CREATURE_PATTERNS: RegExp[] = [
  /^(Donkey|Horse|Rhinoceros|Zebra) (looks|grazes|nibbles|watches)/,
  /^Turtle (appears|looks|rests)/,
  /^Turtle crawls ahead/,
  /^Turtle drags itself a few/,
  /^Crab scuttles about/,
  /^Crab scuttles back and/,
  /^Crab (wiggles|cocks|scavenges|waves)/,
  /^Elephant (flaps|forages|trumpets|tosses)/,
  /^(Cat|Rat) looks at/,
  /^Cat (pokes|scratches|sniffs|washes)/,
  /^Bat (flits|lets)/,
  /^(Eagle|Hawk) (scans|circles|stares)/,
  /^Ox (bellows|chews|grazes|moos|nibbles)/,
  /^Ox asks, 'MOO/,
  /^Ostrich (squawks|pecks|nibbles|cranes|looks|eyes)/,
  /^Camel spits at/,
  /^Wolf watches/,
  /^Horse looks around/,
  /^Crow (exclaims|watches|caws|stares)/,
  /^Turkey (exclaims|looks|pecks)/,
  /^Owl scans/,
  /^(Grouse|Partridge|Pheasant) (preens|wanders)/,
  /^(Nightingale|Quail|Sparrow) pecks/,
  /^Bee glares/,
  /^Rat searches/,
  /^Rabbit (looks|pauses|scratches|twitches)/,
  /^Gerbil nibbles/,
  /^Gecko (cocks|runs)/,
  /^Lobster (cocks|wiggles|waves|scuttles|scavenges)/,
  /^Parrot (nibbles|preens|squawks)/,
  /^Peacock looks/,
  /^Squirrel digs/,
  /^Fox (slinks|watches)/,
];

// ---------------------------------------------------------------------------
// Citizen NPC chatter
// ---------------------------------------------------------------------------

const CITIZEN_VERBS =
  'blinks|bows|chuckles|fixes|flees|frowns|giggles|glares|grins|hums|looks|' +
  'nods|peers|ponders|screams|shakes|sighs|smiles|smirks|stares|stretches|' +
  'swings|twiddles|whistles|yawns|asks|exclaims|says';

function citizenRe(names: string): RegExp {
  return new RegExp(`^(${names}) (${CITIZEN_VERBS})`);
}

const CITIZEN_PATTERNS: RegExp[] = [
  // Static patterns (specific NPCs with unique actions)
  /^([\w']+) incants some mystic phrases but/,
  /^Selah (barks|yips)/,
  /^Luc (coughs|pokes|rocks|smiles|stares)/,
  /^Lumum (says|nods)/,
  /^Manaine straightens/,
  /^Charlotte (smiles|wipes)/,
  /^Charlotte exclaims in common, 'I love/,
  /^Dougal (coughs|wipes)/,
  /^Dougal asks in common, 'Are you looking for anything/,
  /^([\w']+) asks in common, 'Got anything to eat/,
  /^([\w']+) asks in common, 'Need something carried/,
  /^Rice (counts|messes|sniffs|yawns)/,
  /^Sylis (cries|sniffs|weeps)/,
  /^(Lulpox|Torcas) (stares|nudges|grins|chuckles|whispers|points)/,

  // Dynamic name groups (emotes + speaks combined)
  citizenRe('Agnesina|Agneta|Agostino|Ai|Aiko|Alardus|Aldgislo|Alberea|Alegreza|Alesia|Alfgard|Alfsuind|Almaricus|Aluysio|Andrea|Andream|Anechino|Arizzo|Arnulphus|Ascelina|Auburgis|Ava|Avelina|Aya'),
  citizenRe('Banager|Barbo|Barbus|Bartolomeo|Baudemundus|Benevenuta|Benghi|Bertucio|Blancha|Boio|Bolezino|Borbrator|Brother|Bucello'),
  citizenRe('Catarina|Caterucia|Claricia|Colette|Colleta'),
  citizenRe('Dai|Daigoro|Danieli|Dyonisius'),
  citizenRe('Edelina|Engris|Erlewino|Ermengardis|Ernulfi|Erradi|Eswar|Eustachius|Evrardus'),
  citizenRe('Federico|Felle|Fiora|Flaminio|Florentia|Flos|Fokka|Folcbaldo|Francescino|Francesco|Fresbertus'),
  citizenRe('Gelmarus|Gerita|Gerolimo|Giacomo|Girardus|Girout|Godile|Goduuara|Gregorio|Guiburgis|Guillelmus|Gundrada'),
  citizenRe('Hakji|Hathaburch|Hayato|Hecelina|Heio|Helena|Heleuuit|Helloysis|Heloysis|Helyoudis|Hersendis|Hildemunde|Hodeardis'),
  citizenRe('Ienobu|Itkkitk|Ivo'),
  citizenRe('Jacobus'),
  citizenRe('Kasumi|Kentaro|Kirika'),
  citizenRe('Lambertus|Lancelinus|Lebewinus|Leduualdus|Leonardo|Leonius|Liuduuih|Lorenzo|Luca|Lucha|Lucia|Luciana'),
  citizenRe('Manteti|Maria|Martino|Matio|Meddin|Meginhild|Meginsuind|Michaleto|Micola|Mirabae|Moonoolool|Multormuh'),
  citizenRe('Nami|Nasih|Nicoleto|Nodelend'),
  citizenRe('Odwinus|Oliverio|Ooll|Othilhildis'),
  citizenRe('Paolo|Pasqualina|Pencina|Pero|Petronilla|Piruza'),
  citizenRe('Raingerus|Rambaldo|Renodus|Richa|Righi|Rigi|Rikuuard|Romano|Rogerus|Ryuji'),
  citizenRe('Scabor|Scalortormut|Sedilia|Segecin|Seimei|Shinobu|Shun|Simon|Staji'),
  citizenRe('Tadhild|Tarvixio|Tetmarus|Tetsu|Thadeo|Thalia|Thiadmar|Thiadulf|Thiatgif|Thomas|Thomisina|Tirna|Tor|Tsukasa|Tuscus'),
  citizenRe('Uguccio|Un|Uuiduco'),
  citizenRe('Vitaliano|Vualdbrehitus|Vuendelgrimi|Vulfiardis'),
  citizenRe('Wakil|Wendelburgis|Weldelburgis|Wersuent|Wicswint|Wigmanni'),
  citizenRe('Zulian'),
];

// ---------------------------------------------------------------------------
// Trainer emotes/dialogue (7 patterns)
// ---------------------------------------------------------------------------

const TRAINER_PATTERNS: RegExp[] = [
  /^Ambrosius (dozes|examines|winks|yawns)/,
  /^Nazir (scowls|yawns|grunts|slouches)/,
  /^Nazir exclaims/,
  /^Ambrosius (exclaims|says) in (magic|common), '(Always|Trust|Open|Focus|Let|See)/,
  /^Ambrosius says in (magic|common), 'I am a master/,
  /^Ambrosius says in (magic|common), 'A closed mind/,
  /^Ambrosius says in (magic|common), 'The (Ebon|mages|true)/,
];

// ---------------------------------------------------------------------------
// Sparring partner emotes/dialogue (41 patterns)
// ---------------------------------------------------------------------------

const SPARRING_PATTERNS: RegExp[] = [
  /^(\w+) stamps a hoof/,
  /^(\w+) lashes out/,
  /^(\w+) neighs loudly/,
  /^(\w+) rears back/,
  /^(\w+) tosses (her|his) head/,
  /^(\w+) attempts to trample/,
  /^a (figure|warrior) .* (grins|yodels)/,
  /^a (figure|warrior) .* hums a battle chant/,
  /^a (figure|warrior) .* (snarls|spits) at you/,
  /^a (figure|warrior) .* sweats a little/,
  /^(Aegnor|Aloysius) (listens|peers|hums|leans)/,
  /^Hassan (asks|exclaims|ignores|says|smiles|smirks)/,
  /^Armando (paces|pats)/,
  /^Khash (grins|kicks|laughs|punches|spits)/,
  /^Ozzo (asks|exclaims)/,
  /^Pell (spins|reverses)/,
  /^Gudz says in common, 'Leave now/,
  /^Gudz exclaims in common, 'This will be/,
  /^Gudz asks in common, 'What is it with/,
  /^Gudz says in common, 'Run while you/,
  /^Gudz exclaims in common, 'Wake up/,
  /^Luthien powerfully attacks/,
  /^Luthien angrily swings/,
  /^Luthien exclaims in elvish, 'This is my home/,
  /^Luthien exclaims in elvish, 'You don't like it/,
  /^Morrigan (executes|kicks|punches|pushes)/,
  /^Morrigan lets out a warcry/,
  /^Pelidor exclaims in common, 'I shall have/,
  /^Pelidor says in common, 'I have a craving/,
  /^Pelidor says in common, 'I shall cut/,
  /^Pharos (grunts|stares)/,
  /^Pharos says in common, 'Heh/,
  /^(\w+) picks (her|his) nose/,
  /^([\w']+) (spits|kicks) at/,
  /^([\w']+) (growls|snarls|sneers|taunts)/,
  /^([\w']+) grins arrogantly/,
  /^([\w']+) says in southern, 'I'm going to enjoy killing/,
  /^([\w']+) asks in southern, 'Koon you feel lucky/,
  /^([\w']+) asks in southern, 'Why are you so obsessed/,
  /^Sparrow (swoops|tries)/,
  /^Bee (dives|tries|hums|stabs)/,
  /^Bat tries/,
  /^Rat jumps/,
  /^Crab snaps/,
];

// ---------------------------------------------------------------------------
// Failed channelling messages (2 patterns)
// ---------------------------------------------------------------------------

const CHANNEL_PATTERNS: RegExp[] = [
  /^None of the power/,
  /^A gossamer strand/,
];

// ---------------------------------------------------------------------------
// Quest narrative text (7 patterns)
// ---------------------------------------------------------------------------

const QUEST_PATTERNS: RegExp[] = [
  /^In the Commander's temple/,
  /^Seek out the Holy Island/,
  /^It waits for you in the southern/,
  /^Serve the Red Sword/,
  /^The Master of Battle has/,
  /^With the Symbol of the Commander/,
  /^Find your destiny across the/,
];

// ---------------------------------------------------------------------------
// Exported group definitions
// ---------------------------------------------------------------------------

export const GAG_GROUPS: GagGroup[] = [
  {
    id: 'pets',
    label: 'Pets',
    description: 'Pet emotes and actions',
    patterns: PET_PATTERNS,
  },
  {
    id: 'creatures',
    label: 'Creatures',
    description: 'Wild creature emotes',
    patterns: CREATURE_PATTERNS,
  },
  {
    id: 'citizens',
    label: 'Citizens',
    description: 'Town NPC chatter',
    patterns: CITIZEN_PATTERNS,
  },
  {
    id: 'trainers',
    label: 'Trainers',
    description: 'Ambrosius & Nazir',
    patterns: TRAINER_PATTERNS,
  },
  {
    id: 'sparring',
    label: 'Sparring',
    description: 'Sparring partner emotes',
    patterns: SPARRING_PATTERNS,
  },
  {
    id: 'channels',
    label: 'Channels',
    description: 'Failed channelling text',
    patterns: CHANNEL_PATTERNS,
  },
  {
    id: 'quests',
    label: 'Quests',
    description: 'Quest narrative text',
    patterns: QUEST_PATTERNS,
  },
];

// ---------------------------------------------------------------------------
// Runtime check
// ---------------------------------------------------------------------------

const PROMPT_PREFIX_RE = /^(?:> )+/;

/** Test a stripped line against all enabled gag groups. */
export function shouldGagLine(stripped: string, enabled: GagGroupSettings): boolean {
  const cleaned = stripped.replace(PROMPT_PREFIX_RE, '');
  if (!cleaned) return false;

  for (const group of GAG_GROUPS) {
    if (!enabled[group.id]) continue;
    for (const pattern of group.patterns) {
      if (pattern.test(cleaned)) return true;
    }
  }
  return false;
}
