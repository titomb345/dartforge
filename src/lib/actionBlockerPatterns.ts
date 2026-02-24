/**
 * Action Blocker Patterns
 *
 * Ported from DartMudlet's scripts_blocking.lua and triggers_blocking.lua.
 * Defines which outgoing commands trigger blocking and which server output
 * lines signal action completion (unblocking).
 */

// ---------------------------------------------------------------------------
// Blocking command categories
// ---------------------------------------------------------------------------

export interface BlockCategory {
  key: string;
  label: string;
  pattern: RegExp;
  exclusions?: RegExp[];
}

export const BLOCKING_COMMANDS: BlockCategory[] = [
  {
    key: 'cast',
    label: 'Casting',
    pattern: /^cast /i,
    exclusions: [/^cast !? ?tell\b/i, /^cast !? ?t /i, /^cast net\b/i],
  },
  {
    key: 'invoke',
    label: 'Invoking',
    pattern: /^invoke /i,
  },
  {
    key: 'study',
    label: 'Studying',
    pattern: /^study /i,
  },
  {
    key: 'learn',
    label: 'Learning',
    pattern: /^learn book /i,
  },
  {
    key: 'hunt',
    label: 'Hunting',
    pattern: /^hunt /i,
  },
  {
    key: 'revise',
    label: 'Revising',
    pattern: /^revise /i,
  },
  {
    key: 'gather',
    label: 'Gathering',
    pattern: /^gather /i,
    exclusions: [/^gather mist\b/i],
  },
  {
    key: 'search',
    label: 'Searching',
    pattern: /^search /i,
  },
  {
    key: 'summon',
    label: 'Summoning',
    pattern: /^summon armor/i,
  },
  {
    key: 'inscribe',
    label: 'Inscribing',
    pattern: /^inscribe /i,
  },
  {
    key: 'write',
    label: 'Writing',
    pattern: /^write /i,
    exclusions: [
      /^write letter\b/i,
      /^write note\b/i,
      /^write color\b/i,
      /^write name\b/i,
      /^write sex\b/i,
      /^write breed\b/i,
      /^write fur\b/i,
      /^write eyes\b/i,
      /^write metal\b/i,
      /^write metal2\b/i,
      /^write size\b/i,
      /^write shape\b/i,
      /^write stone\b/i,
      /^write stone2\b/i,
      /^write inscription\b/i,
      /^write language\b/i,
      /^write facemarkings\b/i,
      /^write legmarkings\b/i,
      /^write intaglio\b/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Unblock trigger patterns — server output that signals action completion.
// Ported from DartMudlet triggers_blocking.lua textToUnBlock table,
// plus triggers_casting.lua and triggers_inscribing.lua.
//
// Each pattern is matched against stripped server output lines (no leading
// "> " prompt). All patterns are universal — any match unblocks regardless
// of block type, except the special inscribe handling in matchesUnblock().
// ---------------------------------------------------------------------------

export const UNBLOCK_PATTERNS: RegExp[] = [
  /.* appears above your .* then/,
  /.* aura manifests!/,
  /.* begins to glow/,
  /.* begin .* glowing\./,
  /(\w+) begins (faintly|softly|brightly|brilliantly) glowing/,
  /(\w+) becomes (faintly|deeply|distinctly) shrouded/,
  /The .* begins (faintly|softly|brightly|brilliantly) glowing/,
  /The .* becomes (faintly|deeply|distinctly) shrouded/,
  /Your .* begins (faintly|softly|brightly|brilliantly) glowing/,
  /Your .* becomes (faintly|deeply|distinctly) shrouded/,
  /An arcane rune appears on the .*/,
  /.* believes/,
  /.* coil around you like a serpent/,
  /.* corpse isn't here/,
  /.* don't have a /,
  /.* is draped with a mantle of/,
  /.* is encircled by turbulent/,
  /.* is surrounded by a shimmering/,
  /.* is surrounded in a tranquil mist/,
  /.* lets off a real rip-roarer/,
  /.* mind is closed to you/,
  /.* seems to go all out of focus/,
  /.* shivers\./,
  /.* spellbooks may be obfuscated/,
  /.* sprays from your/,
  /A cloud of .* forms above your/,
  /A corona of .* surrounds you/,
  /A faint arrow appears briefly/,
  /A faintly glowing rune appears on/,
  /A flicker of light briefly illuminates/,
  /A fulminating skull of .* encircles you/,
  /A gentle breeze stirs briefly, but nothing/,
  /A glowing arrow pointing/,
  /A glowing rune appears on the/,
  /A maelstrom of .* churns around you/,
  /A shadow flits through the/,
  /A small jet of fire leaps from your/,
  /A staccato (flash|flicker) of light briefly illuminates/,
  /A suit of .* Starplate armor materializes around you/,
  /A toothy, disembodied mouth/,
  /A translucent orb of/,
  /Ah, that would be/,
  /Arguments should be /,
  /Coruscating rays of/,
  /How rude!/,
  /Hunting cattle would be too easy/,
  /Incandescent .* erupt from your/,
  /Light bends around you, turning you/,
  /No effect/,
  /No (language|target) specified/,
  /No such (language|target around|thing here)/,
  /Nothing happens/,
  /Oh no, it escaped/,
  /Perhaps you should learn that spell more/,
  /Sparks shoot out of your/,
  /Standing stones do not gather moss/,
  /Subject line too long\. {2}Please limit/,
  /Submitted\. {2}Thank you/,
  /Tendrils of .* lash out wildly around you/,
  /That isn't alive/,
  /That person is not plagued/,
  /The .* disintegrates/,
  /The .* glows .*(red|orange|yellow|green|blue|indigo|violet|octarine|scintillating|moment)\./,
  /The area becomes a bit darker/,
  /The aura remains hidden/,
  /The book is already obfuscated/,
  /The clues lead out of this area/,
  /The enchantment on .* holds/,
  /The incantations contain a formulae/,
  /The jar isn't open/,
  /The pages of the book disintegrate before your eyes/,
  /The pattern contains/,
  /The power of the spell is snatched from your/,
  /The rune on the .* crackles with electricity/,
  /The spell critically fails/,
  /The spell fails/,
  /The spell merges with the wall, and alters/,
  /The spell seems to have no effect/,
  /The talisman .* disintegrates/,
  /The wall flares up violently/,
  /The wall of light disappears/,
  /There's .* right here/,
  /There is no aura/,
  /This book makes no sense/,
  /This spell can only be cast on foci/,
  /This spell does not work on such an object/,
  /Usage: write/,
  /What \?/,
  /What focus do you wish to imbed/,
  /Write what\?/,
  /Who do you wish to give the stored spell/,
  /You absorb the wounds from/,
  /You are briefly surrounded by sparks/,
  /You are draped with a mantle/,
  /You are encased in thick slabs/,
  /You are encircled by turbulent/,
  /You are immersed in .* bubble/,
  /You are missing/,
  /You are momentarily surrounded by a halo/,
  /You are not magically armored/,
  /You are suddenly surrounded in bubbles/,
  /You are surrounded by a shimmering/,
  /You are surrounded in/,
  /You attempt to manipulate/,
  /You (battered|bludgeoned|burned)/,
  /You begin .* glowing/,
  /You begin to waver/,
  /You can't hunt in here/,
  /You can't study a/,
  /You can only (inscribe|learn)/,
  /You cannot find a corpse here/,
  /You cannot find an enchantment/,
  /You cannot store such a complex spell/,
  /You cannot understand .* well enough/,
  /You (charred|chilled)/,
  /You come face to face with the/,
  /You didn't specify a target/,
  /You disintegrated/,
  /You don't find anything/,
  /You don't have a scroll/,
  /You don't have (any|enough)/,
  /You don't know such a spell/,
  /You fail at casting the spell/,
  /You fail to sense/,
  /You failed to cast the spell/,
  /You feel a (little bit|little|lot) better/,
  /You feel a pocket dimension open/,
  /You feel an anticipation in the air/,
  /You feel better/,
  /You feel more fluent/,
  /You feel your power drain/,
  /You fill the room with/,
  /You (find|found) (?!the inscription)/,
  /You finish (editing|studying|work)/,
  /You finish the incantation/,
  /You found no /,
  /You (fried|froze)/,
  /You gaze deeply into/,
  /You grow in size/,
  /You have to be holding the/,
  /You (heal|restore)/,
  /You hear a soothing/,
  /You (imploded|knocked|melted|pummeled)/,
  /You internalize the power of the/,
  /You lay your hands on/,
  /You magically cool down/,
  /You make a few gestures/,
  /You must have mispronounced a lot/,
  /You need 1 ounce of holy water/,
  /You need 1 pinch of gemstone powder/,
  /You need a bound device for that/,
  /You need rose for this spell/,
  /You need some ink/,
  /You need to be holding a blank scroll/,
  /You neglected to name a target/,
  /You notice that .* has/,
  /You pass your/,
  /You raise your .* and a /,
  /You raise your hands and begin to/,
  /You regain some feeling/,
  /You retrieve the soul of /,
  /You return to your normal size/,
  /You (scalded|seared|shocked|singed)/,
  /You see the .* It hasn't noticed you/,
  /You see the .* It stares back at you/,
  /You sense a bond between/,
  /You sense a deep affection/,
  /You sense (its|his|her) aura to be/,
  /You sense that .* has no disease/,
  /You sense the spell becoming active/,
  /You shrink in size/,
  /You spot (it|him|her|them)!/,
  /You stop hunting\./,
  /You torched/,
  /You try to touch [A-Za-z]+, but you/,
  /You zap/,
  /Your .* begins to manifest its aura/,
  /Your .* bursts/,
  /Your (\w+) disappears/,
  /Your .* feels/,
  /Your .* is wreathed/,
  /Your .* return to normal/,
  /Your .* tingles/,
  /Your abilities return to normal/,
  /Your aura is too weak/,
  /Your body adjusts to its new abilities/,
  /Your concentration is (broken|disrupted)/,
  /Your earthen shield crumbles/,
  /Your eyes adjust/,
  /Your hands are momentarily/,
  /Your hands (crackle|glow)/,
  /Your message is borne away/,
  /Your mind is isolated, you cannot send/,
  /Your recuperative powers/,
  /Your scroll writhes and disappears/,
  /Your sense of .* becomes heightened/,
  /Your senses adjust/,
  /Your spellbook shimmers and vanishes/,
  /Your surroundings disappear/,
  /Your vision blurs and feel yourself/,
  /You're not holding a /,
  /You've already searched this area/,
  // From triggers_casting.lua
  /You finish practicing\./,
  // From triggers_inscribing.lua
  /You have written a/,
  /As you finish reading, the last words disappear\./,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a command should activate blocking. Returns the category or null. */
export function isBlocker(command: string): BlockCategory | null {
  const trimmed = command.trim();
  for (const cat of BLOCKING_COMMANDS) {
    if (cat.pattern.test(trimmed)) {
      if (cat.exclusions?.some((ex) => ex.test(trimmed))) continue;
      return cat;
    }
  }
  return null;
}

/**
 * Check if a server output line matches an unblock trigger.
 * Special handling for inscribe blockType: skip lines containing
 * "mist" or "gusak" (unless "missing mist") to avoid false unblocks.
 */
export function matchesUnblock(line: string, blockType: string | null): boolean {
  for (const pattern of UNBLOCK_PATTERNS) {
    if (pattern.test(line)) {
      if (blockType === 'inscribe') {
        const hasMist = /\bmist\b/i.test(line) && !/missing mist/i.test(line);
        const hasGusak = /\bgusak\b/i.test(line);
        if (hasMist || hasGusak) return false;
      }
      return true;
    }
  }
  return false;
}
