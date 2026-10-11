/**
 * Regression test: the town parser's name scan, on the live line format.
 *
 * The live feed (OutputFilter's onMapLine) keeps blank lines; the DartForge
 * session logger drops them, and the MUSHclient logs keep them. Every rule
 * below was found on five years of line-intact MUSH logs (fixtures are real
 * corpus text unless marked synthetic), and the parser's output must be the
 * same with and without the blank lines:
 *  1. a blank line or bare prompt inside a block is transparent — it ended
 *     the scan, so the OOC Entry Hall (blank-framed board notice) was lost
 *     on every live visit while the replay saw it;
 *  2. the OOC Entry Hall's board notice and the board names under it are
 *     skipped (blank-less session logs named the hall after its last board),
 *     indented or not, and ONLY those lines — an indented description line
 *     elsewhere stays, and the list ends at the lighting or exits line;
 *  3. names ending in . ! ? are found by position (directly above the long
 *     first description line, no ordinary name line reachable above) — they
 *     were lost or replaced by the line before the block: speech, who rows,
 *     "Row 3:Moirai" — while a short closing sentence of a multi-paragraph
 *     description is still description (the nameLineAbove guard), and so is
 *     every terminal line that fails one of the name conditions;
 *  4. foreign short lines (speech, who rows, "Label: value", formation rows,
 *     "...", wrapped peeks) are never names — a colon only counts before a
 *     space or at the end of the line;
 *  5. minor bails: sentence-shaped / dangling short lines and list intros
 *     are prose, a 15-line description fits the scan, a stray blank line
 *     inside a wrapped exits sentence no longer truncates it;
 *  6. "There are no obvious exits." ends a room block with empty exits.
 */
import { TownParser, type TownRoomBlock } from '../../src/lib/townParser';
import { descKey } from '../../src/lib/townMap';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

const parse = (lines: readonly string[]): TownRoomBlock[] => {
  const out: TownRoomBlock[] = [];
  const p = new TownParser((b) => out.push(b));
  for (const l of lines) p.feedLine(l);
  p.flushPending();
  return out;
};
const dropBlanks = (lines: readonly string[]) => lines.filter((l) => !/^[>\s]*$/.test(l));
/** Parse the live form and the session-log form; both must agree */
const parseBoth = (label: string, lines: readonly string[]): TownRoomBlock[] => {
  const live = parse(lines);
  const logged = parse(dropBlanks(lines));
  check(
    JSON.stringify(live) === JSON.stringify(logged),
    `${label}: output differs with blank lines dropped\n  live:   ${JSON.stringify(live)}\n  logged: ${JSON.stringify(logged)}`
  );
  return live;
};
const one = (label: string, lines: readonly string[], name: string): TownRoomBlock | undefined => {
  const got = parseBoth(label, lines);
  check(
    got.length === 1 && got[0].name === name,
    `${label}: want one block "${name}", got ${JSON.stringify(got.map((b) => b.name))}`
  );
  return got[0];
};

const HALL_DESC = [
  'OOC Entry Hall',
  'This room has the ghostly appearance of being between this plane and the next. ',
  "To depart this plane, type 'plane shift'.",
];
const HALL_EXITS = 'There are four exits: north, south, east, and west.';
const HALL_KEY = descKey(
  "This room has the ghostly appearance of being between this plane and the next. To depart this plane, type 'plane shift'."
);

// --- 1+2. The OOC Entry Hall, live (blank-framed) and logged (blank-less) ---
// dm-2021-06-01.txt:3015-3024 (live form, two boards with unread notes)
const hallNotes = one(
  'OOC hall, new notes (live)',
  [
    ...HALL_DESC,
    '',
    'There are new notes to read on the following boards:',
    '     Important Notices',
    '     Ideas',
    '',
    '  It is blindingly bright here.',
    HALL_EXITS,
  ],
  'OOC Entry Hall'
);
// dm-2021-04-16.txt:8820-8827 (live form, nothing unread)
const hallSadly = one(
  'OOC hall, no new notes (live)',
  [
    ...HALL_DESC,
    '',
    'Sadly, there are no new notes for you to read.',
    '',
    '  It is blindingly bright here.',
    HALL_EXITS,
  ],
  'OOC Entry Hall'
);
// session_2026-07-16T18-04-45-303.log:329-335 (logger form: blanks dropped)
// — the scan used to take the board name: a room "Important Notices"
const hallLogged = one(
  'OOC hall, new notes (session log)',
  [
    ...HALL_DESC,
    'There are new notes to read on the following boards:',
    '     Important Notices',
    '  It is bright.',
    HALL_EXITS,
  ],
  'OOC Entry Hall'
);
// (synthetic: the session logger's chunk split, the "This is" / " a large
// open plain." shape of session_2026-07-03T21-42-27-420.log:13963-13964)
// "Sadly" heads no board list: a lighting line split as "  It is" /
// " blindingly bright here." stays whole in the description, where descKey
// strips it like any lighting sentence
const hallSplit = one(
  'OOC hall, no new notes, lighting line split (session log)',
  [
    ...HALL_DESC,
    'Sadly, there are no new notes for you to read.',
    '  It is',
    ' blindingly bright here.',
    HALL_EXITS,
  ],
  'OOC Entry Hall'
);
for (const [label, b] of [
  ['new notes', hallNotes],
  ['no new notes', hallSadly],
  ['session log', hallLogged],
  ['split lighting line', hallSplit],
] as const) {
  check(
    !!b && descKey(b.desc) === HALL_KEY,
    `OOC hall (${label}): the notice must stay out of the description (got "${b?.desc}")`
  );
}
check(hallNotes?.exits.dirs.join() === 'e,n,s,w', `OOC hall exits [${hallNotes?.exits.dirs}]`);

// (synthetic, the live chunk-split shape) a board name that arrives without
// its indentation is still a board name: OutputFilter hands a chunk's
// whitespace-only tail to the screen only, so "     Chat" split after its
// spaces reaches the parser as "Chat" — the hall was named "Chat" again
one(
  'OOC hall, a board name without its indentation (live)',
  [
    ...HALL_DESC,
    '',
    'There are new notes to read on the following boards:',
    '     Important Notices',
    'Chat',
    '',
    '  It is blindingly bright here.',
    HALL_EXITS,
  ],
  'OOC Entry Hall'
);
// (dm-2021-06-01.txt:3015-3031, shortened: one board, no blank lines, the
// hall's lighting line and the vending machine removed) a board list the
// exits line cuts short ends there: the next room's name is not skipped as
// a board name
const cut = parseBoth('board list cut short by the exits line', [
  ...HALL_DESC,
  'There are new notes to read on the following boards:',
  '     Important Notices',
  HALL_EXITS,
  '> OOC Area',
  'This is a grand hall.  High marble arches stretch high overhead, making you feel',
  'tiny in comparison.  This hall extends further to the north, as if leading you',
  'onward.  A small wooden plaque is mounted on the wall here.  It is blindingly',
  'bright here.',
  'There are four exits: north, west, east, and south.',
]);
check(
  cut.map((b) => b.name).join() === 'OOC Entry Hall,OOC Area',
  `the next block keeps its name (got ${JSON.stringify(cut.map((b) => b.name))})`
);

// The board skip is narrow: an indented description line elsewhere stays
// (dm-2021-04-16.txt:38755-38760 — skipping every indented line rewrote
// 1,780 MUSH descriptions)
const yard = one(
  'indented first description line',
  [
    '> Overgrown yard',
    ' This is the yard of a dark and ominous mansion at the north end of Tobermore. ',
    'There is an iron fence circling the yard.  The yard is overgrown with grass and',
    'shrubs, in a crazy patchwork as each plant tries to choke out all the others. ',
    'You definitely smell blood.  It is blindingly bright here.',
    'There are two exits: south and north.',
  ],
  'Overgrown yard'
);
check(
  !!yard?.descFirst.startsWith('This is the yard of a dark'),
  `the indented first line is description (descFirst "${yard?.descFirst}")`
);

// --- 1. Blank lines and bare prompts elsewhere ---
// dm-2022-03-10.txt:58-65: a login Bedchamber with a blank before its exits
one(
  'blank before the exits line',
  [
    'Bedchamber',
    'This is a bedchamber on an upper floor of the keep where one of the senior',
    'rangers may rest and store his or her gear.  Daylight streams in through a',
    'window on the east wall.  The room is furnished with a bed with a large chest',
    'pushed up against the foot it.  A thick red wool rug covers the floor, giving a',
    'splash of color and warmth to the room.  It is bright here.',
    '',
    'There is one obvious exit: a closed oak door leading west.',
  ],
  'Bedchamber'
);
// (synthetic) a bare prompt between the name and the description
one(
  'bare prompt inside a block',
  [
    'Stone Cell',
    '> ',
    'This is a bare stone cell with damp walls and a heavy iron ring in the floor.',
    '>',
    'It is dimly lit.',
    'There is one obvious exit: up.',
  ],
  'Stone Cell'
);

// --- 3. Names ending in . ! ? ---
// dm-2022-12-29.txt:18823-18830: the block's own name ends in a period and
// the line above is speech — the room used to be named after the speech
const cave = one(
  'terminal name below a speech line',
  [
    "> Moirai asks in common, 'Ro please?'",
    'A circular cave.',
    'This is a damp and smelly cave.  It is too circular to have been formed in the',
    'rock naturally, yet not regular enough to be a product of normal mining',
    'techniques.  There is a certain amount of dirt underfoot.  Looking down into the',
    'caves below, you notice that they are very much similar to this one.  An awful',
    'stench rises up from the depths.  It is blindingly bright here.',
    'There are two exits: down and up.',
  ],
  'A circular cave.'
);
check(
  !!cave?.desc.startsWith('This is a damp and smelly cave.'),
  `the terminal name is not description (desc "${cave?.desc.slice(0, 40)}")`
);
// dm-2025-07-15.txt:27327-27332: a question mark, the line above a forced move
one(
  'terminal name ending in ?',
  [
    'Rikter leads you up.',
    'Demonic Ridge - Is this the last one?',
    'You are balanced on a ledge-like feature of a demonic sea monster!  It towers',
    'over the landscape like a siege tower made of knots of nightmarish marine life! ',
    'It is painfully bright.',
    'There is one obvious exit: down.',
  ],
  'Demonic Ridge - Is this the last one?'
);
// The guard: a short one-sentence line above the long first... line of a
// LATER paragraph is description when an ordinary name sits above it
// (dm-2021-05-02.txt:12403-12407; 449 such multi-paragraph descriptions)
const pawn = one(
  'short closing sentence of a paragraph',
  [
    '> Pawn Shop',
    'The somewhat small place is cluttered.  A sign above the door reads - [rowan]',
    'Buy Most Everything - Sell Most Anything. ',
    "To see what's for sale, <list>.  It is blindingly bright here.",
    'There are two exits: north and back.',
  ],
  'Pawn Shop'
);
check(
  !!pawn?.desc.includes('Buy Most Everything - Sell Most Anything.'),
  'the paragraph-closing sentence stays in the description'
);
// dm-2022-01-01.txt:176-184: the weather sentence wrapped onto its own line
// right above the exits line (5,213 MUSH blocks) — a one-sentence line with
// no description below it is no name (and must not crash the check)
const bailey = one(
  'weather line alone above the exits line',
  [
    '> Bailey',
    'This the eastern end of the compound within the walls of the fortress.  The',
    'ground is paved in broad flagstones and extends to the west towards the',
    'gatehouse.  Stairs rise to the door of the keep to the east, to the north is a',
    'low stone building and to the south is a split rail fence which encloses a small',
    'byre.  In the center of the area is a stone well.  It is blindingly bright here.',
    'The air is quite chilly.',
    'There are four exits: west, an open pair of oak doors leading east, ',
    'a closed cedar gate leading south, and a closed oak door leading north.',
  ],
  'Bailey'
);
check(
  JSON.stringify(bailey?.exits.doorNouns) === '{"e":"doors","n":"door","s":"gate"}' &&
    bailey?.exits.openDoorDirs.join() === 'e',
  `Bailey doors ${JSON.stringify(bailey?.exits.doorNouns)} open [${bailey?.exits.openDoorDirs}]`
);
// (synthetic) A terminal line that fails ONE of the name conditions, with no
// name reachable above it, is description — the block has no name. Each
// line would otherwise have named the block:
const CAVE = [
  'This is a damp and smelly cave.  It is too circular to have been formed in the',
  'rock naturally.  It is blindingly bright here.',
  'There are two exits: down and up.',
];
for (const [why, lines] of [
  ['quoted', ["A sign reads 'Closed for repairs'.", ...CAVE]],
  ['a "You" message', ['You feel a cold draft.', ...CAVE]],
  ['a "Your" message', ['Your torch flickers.', ...CAVE]],
  ['"There is" prose', ['There is a draft here.', ...CAVE]],
  ['"It was" prose', ['It was quiet.', ...CAVE]],
  ['two sentences', ['Water drips.  Rats scurry.', ...CAVE]],
  // the line below is short: not the description's first, wrapped line
  [
    'above a short line',
    [
      'Buy Most Everything - Sell Most Anything.',
      "To see what's for sale, <list>.  It is bright.",
      'There are two exits: north and back.',
    ],
  ],
  // the line below continues a sentence: the capture started mid-text
  [
    'above a lowercase line',
    [
      'A circular cave.',
      'rock naturally, yet not regular enough to be a product of normal mining',
      'techniques.  It is blindingly bright here.',
      'There is one obvious exit: south.',
    ],
  ],
] as const) {
  const got = parseBoth(`terminal line, ${why}`, lines);
  check(
    got.length === 0,
    `terminal line, ${why}: "${lines[0]}" is no room name (got ${JSON.stringify(got.map((b) => b.name))})`
  );
}

// --- 4. Foreign short lines never become names ---
// (synthetic, corpus line shapes) no name line at all: the speech above the
// description used to become the room's name — now there is no block
const speechOnly = parseBoth('speech above a nameless block', [
  "Moirai says in common, 'Fair'",
  'This is a damp and smelly cave.  It is too circular to have been formed in the',
  'rock naturally.  It is blindingly bright here.',
  'There are two exits: down and up.',
]);
check(
  speechOnly.length === 0,
  `a speech line is never a room name (got ${JSON.stringify(speechOnly.map((b) => b.name))})`
);
for (const foreign of [
  'Verite the troll                         Online',
  'Movement mode: WALKING',
  'Autosaving character...Ok',
  'Row 3:Moirai',
  'A circular cave.: A cave, damp and smelly. < s >',
  // a peek wrapped after its colon ("Felora's Backroom: " / this line,
  // dm-2022-02-14.txt:31160-31161): only the exits tag gives it away
  'A small storeroom < w >',
]) {
  one(
    `foreign line "${foreign}" above a terminal name`,
    [
      foreign,
      'A circular cave.',
      'This is a damp and smelly cave.  It is too circular to have been formed in the',
      'rock naturally.  It is blindingly bright here.',
      'There are two exits: down and up.',
    ],
    'A circular cave.'
  );
}
// (synthetic) the colon rule is narrow: inside a word it is no "Label: value"
one(
  'colon inside a name',
  [
    'Stall 3:A',
    'This is a narrow market stall squeezed between two larger ones on the row.',
    'It is bright.',
    'There is one obvious exit: west.',
  ],
  'Stall 3:A'
);

// --- 5. Minor bails ---
// The Smoking Weed's description ends in an unterminated sentence of its
// own (13 of its 36 MUSH sightings were lost). dm-2025-08-14.txt:5202-5206:
// after another sentence on the same short line (the two-sentence rule)...
one(
  'unterminated description sentence after another',
  [
    '> The Smoking Weed',
    "You are in a dark, warm tobacconist's shop.  A small counter runs along one",
    'wall, with at least 175 cabinets filled with jars of dark material.  It is well',
    'lit.  There is an ashtray on the counter',
    'There is one obvious exit: west.',
  ],
  'The Smoking Weed'
);
// ...and dm-2026-01-21.txt:6102-6106 alone on its line: a "There is"
// sentence start is prose, never a name
one(
  'unterminated description sentence alone on its line',
  [
    '> The Smoking Weed',
    "You are in a dark, warm tobacconist's shop.  A small counter runs along one",
    'wall, with many cabinets filled with jars of dark material.  It is well lit. ',
    'There is an ashtray on the counter',
    'There is one obvious exit: west.',
  ],
  'The Smoking Weed'
);
// (synthetic, session-log fragment shape) a sliced line holding a sentence
// break ("There is an oak chest in the opposite corner.  It" was once a
// room NAME)
one(
  'sliced line with a sentence break',
  [
    'Assembly Hall',
    'This is a large hall where the rangers gather for their meetings and feasts.',
    '  There is an oak chest in the opposite corner.  It',
    'is bright.',
    'There are two exits: a closed pair of oak doors leading west and east.',
  ],
  'Assembly Hall'
);
// (synthetic: the session logger's "This is" / " a large open plain." split,
// session_2026-07-03T21-42-27-420.log:13963-13964, on a town room) a slice
// dangling on a function word is prose — the name is further up
const lowerMain = one(
  'slice dangling on a function word',
  [
    'Lower Main',
    'This is',
    ' the main corridor of Lower Segliz. Light filters in from the east. To',
    'the west, the corridor opens up a bit.  It is bright.',
    'There are three exits: north, east, and west.',
  ],
  'Lower Main'
);
check(
  !!lowerMain?.desc.startsWith('This is the main corridor of Lower Segliz.'),
  `the slice stays in the description ("${lowerMain?.desc.slice(0, 50)}")`
);
// dm-2022-04-04.txt:1503-1510: a list introduced by a colon
one(
  'list intro ending in a colon',
  [
    '> Post Office',
    'You are in the OOC post office.  Commands:',
    'read mail    Read from the mailbox.',
    "mail <name>  Mail to player 'name'.",
    'from         List all headers.',
    "group        Type 'help group' for details.",
    '  It is blindingly bright here.',
    'There is one obvious exit: east.',
  ],
  'Post Office'
);
// dm-2022-02-04.txt:13387-13404: a list intro alone on its line, above a
// terminal-named block — "It contains:" (a looked-in backpack) is not a
// name line, so the cave below it keeps its own name (taken for one, it
// named 11 MUSH blocks). The first exits line has nothing above it here.
one(
  'list intro alone on its line',
  [
    'There is one obvious exit: south.',
    'a very large iron scimitar, and an open somewhat small leather backpack.',
    '> A well-made somewhat small leather backpack, with a closable flap and shoulder',
    'straps.',
    'It contains:',
    '7 silver dirhams.',
    '> You take 7 silver dirhams from an open somewhat small leather backpack.',
    '> No such thing here!',
    '> No such thing here!',
    '> No such thing here!',
    '> No such thing here!',
    '> A circular cave.',
    'This is a damp and smelly cave, very much similar to the others in this complex.',
    'Like the rest, it is too circular to have been formed in the rock naturally, yet',
    'not regular enough to be a product of normal mining techniques.  There is a',
    'certain amount of dirt underfoot.  It is blindingly bright here.',
    'There are many exits: southeast, northwest, north, northeast, west, east, ',
    'southwest, and south.',
  ],
  'A circular cave.'
);
// dm-2024-02-07.txt:7067-7084: a 15-line description (the old scan stopped at 14)
one(
  '15-line description',
  [
    'Verite leads you west.',
    'Garden',
    'This is a pleasant garden which occupies the rear part of the bailey of the',
    'castle.  Tall curtain walls flank two sides of the area and a much lower garden',
    'wall separates it from the rest of the inner ward, giving an air of tranquility',
    'and privacy. The landscape here is artfully sculpted with a tumble of boulders,',
    'rocks and pebbles to appear natural.  Gnarled dwarf evergreen trees add color',
    'and harmony to the garden and dark green mosses soften the hardness of the',
    'stone.  A clear spring spills forth in the far corner into a pebble lined stream',
    'which curves around lazily before disappearing to the east.  In the west of the',
    'garden is a small timber structure and positioned next to the stream is a stone',
    'lantern.  Beside the structure is a single cherry blossom tree covered with',
    'blossoms of the palest pink.  A flagstone walkway of white limestone leads from',
    'the eastern part of the garden to the gate in the north wall.  The path branches',
    'off crossing a small bridge over the stream to lead to the paper door of the',
    'structure.  Weeds and mosses cover the ground, and vines encroach on every',
    'vertical surface.  It is blindingly bright.  The air is quite warm.',
    'There are three exits: east, an open oak gate leading north, and an open ',
    'paper door leading west.',
  ],
  'Garden'
);
// dm-2022-02-04.txt:41165-41170 (the exits lines; the room text is
// shortened): a stray blank inside a wrapped exits sentence truncated the
// list to [e,ne,nw,s,se,w]
const dell = one(
  'stray blank inside a wrapped exits sentence',
  [
    'Courtyard',
    'Tall trees and thick underbrush forms a natural enclosure all around the place.',
    'It is dark here.',
    'There are many exits: a closed dragon metal gate leading west, a closed ',
    'set of heavy iron double doors leading east, a closed teak door leading ',
    'south, a closed teak door leading northwest, northeast, southeast,',
    '',
    ' north, and ',
    'a closed teak door leading southwest.',
  ],
  'Courtyard'
);
check(
  dell?.exits.dirs.join() === 'e,n,ne,nw,s,se,sw,w' && dell.exits.doorDirs.join() === 'e,nw,s,sw,w',
  `the whole list is read (dirs [${dell?.exits.dirs}] doors [${dell?.exits.doorDirs}])`
);

// --- 6. A room without exits ---
// session_2026-07-01T15-45-27-282.log:3462-3466: the spirit plane's Arena
// (the room vanished, and the "n" into it stayed queued)
const ARENA = [
  'Arena',
  'A large circular area with high stone walls.  The ground is covered in well',
  'raked sand and overhead is what appears to be a leaden sky from which a',
  'directionless light seems to shine.  It is shadowy.',
  'There are no obvious exits.',
];
const arena = one('no obvious exits', ARENA, 'Arena');
check(
  !!arena &&
    arena.exits.dirs.length === 0 &&
    arena.exits.named.length === 0 &&
    arena.exits.doorDirs.length === 0,
  `a room without exits has empty exits (${JSON.stringify(arena?.exits)})`
);
// ... and it ends its block: the next room's scan doesn't run into it
// (ibid. :3490-3494)
const after = parseBoth('block after a no-exits room', [
  ...ARENA,
  'You are transported back to the mortal plane.',
  'Dressing Room',
  'This is a small, square chamber where a challenger may collect his possessions',
  'after a challenge.  There is a large sign on the wall.  It is shadowy.',
  'There is one obvious exit: northeast.',
]);
check(
  after.map((b) => b.name).join() === 'Arena,Dressing Room',
  `two blocks (got ${JSON.stringify(after.map((b) => b.name))})`
);

if (fail) process.exit(1);
console.log(
  'PASS: name scan — blank lines, OOC board notice, terminal names, foreign lines, minor bails, rooms without exits'
);
