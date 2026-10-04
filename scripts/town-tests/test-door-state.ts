/**
 * Regression test: the exits parser reads DartMUD's list grammar.
 *
 * An exits sentence is a list — "A", "A and B", "A, B, and C" — of items,
 * each a direction, a named exit ("path", "hole", "out") or a door phrase
 * "<a|an> <open|closed> <description> leading <target>" with its OWN state
 * and noun. The old single-regex parse captured across a two-item list's
 * bare "and": "a closed pair of oak doors leading west and east" flagged
 * BOTH exits as doors (the town walk ran a full unlock/open/close/lock
 * sequence at the Assembly Hall's plain east exit), every door took the
 * first door's open/closed state (the walk closed and locked Felora's shop
 * door it had found open, and walked into the Byre's closed iron gate), and
 * only back/out/exit counted as named exits. The auto-walker leaves doors
 * it found standing open untouched (no close/lock behind), so open/closed
 * must be right per door; stage 7's door commands need each door's noun
 * ("open s gate" — "door" does not find a gate).
 */
import { parseTownExits, type TownExits } from '../../src/lib/townParser';

let fail = false;
interface Want {
  doorDirs: string[];
  openDoorDirs: string[];
  dirs?: string[];
  named?: string[];
  doorNouns?: Record<string, string>;
}
const check = (sentence: string, want: Want) => {
  const got: TownExits = parseTownExits(sentence);
  const eq = (a: readonly string[], b: readonly string[]) => a.join(',') === b.join(',');
  const problems: string[] = [];
  if (!eq(got.doorDirs, want.doorDirs))
    problems.push(`doors=[${got.doorDirs}] want [${want.doorDirs}]`);
  if (!eq(got.openDoorDirs, want.openDoorDirs))
    problems.push(`open=[${got.openDoorDirs}] want [${want.openDoorDirs}]`);
  if (want.dirs && !eq(got.dirs, want.dirs))
    problems.push(`dirs=[${got.dirs}] want [${want.dirs}]`);
  if (want.named && !eq(got.named, want.named))
    problems.push(`named=[${got.named}] want [${want.named}]`);
  if (want.doorNouns && JSON.stringify(got.doorNouns) !== JSON.stringify(want.doorNouns))
    problems.push(`nouns=${JSON.stringify(got.doorNouns)} want ${JSON.stringify(want.doorNouns)}`);
  if (problems.length > 0) {
    console.error(`FAIL: "${sentence}"\n  ${problems.join('\n  ')}`);
    fail = true;
  } else {
    console.log(`ok    doors=[${got.doorDirs}] open=[${got.openDoorDirs}] named=[${got.named}]`);
  }
};

check(
  'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and an open oak door leading east.',
  {
    doorDirs: ['e', 's', 'w'],
    openDoorDirs: ['e'],
    dirs: ['e', 'n', 's', 'w'],
    doorNouns: { e: 'door', s: 'door', w: 'door' },
  }
);
// Two-exit lists join with a bare "and": a door WEST plus a plain exit EAST
// (the Eris keep's Assembly Hall: east is the Messhall, whose west is plain —
// session_2026-07-07T02-57-52-521.log:158-169). "leading DIR and DIR" never
// occurs inside a 3+ exit list.
check('There are two exits: a closed pair of oak doors leading west and east.', {
  doorDirs: ['w'],
  openDoorDirs: [],
  dirs: ['e', 'w'],
  doorNouns: { w: 'doors' },
});
check('There are two exits: an open pair of iron gates leading north and south.', {
  doorDirs: ['n'],
  openDoorDirs: ['n'],
  doorNouns: { n: 'gates' },
});
// Garrison Plaza (4,615 MUSH sightings): the gate is east only
check('There are two exits: an open wrought iron gate leading east and west.', {
  doorDirs: ['e'],
  openDoorDirs: ['e'],
  doorNouns: { e: 'gate' },
});
// "a closed trapdoor leading up and down" (225 MUSH) — trapdoor up, plain down
check('There are two exits: a closed trapdoor leading up and down.', {
  doorDirs: ['u'],
  openDoorDirs: [],
  dirs: ['d', 'u'],
  doorNouns: { u: 'trapdoor' },
});
// Two doors in a two-exit list keep their OWN states (DartMUD repeats the
// whole phrase when both exits are doors). Felora's Fibers: the shop door
// SW stands open (session_2026-07-13T03-35-32-238.log:10621)...
check('There are two exits: a closed door leading east and an open door leading southwest.', {
  doorDirs: ['e', 'sw'],
  openDoorDirs: ['sw'],
});
// ...the Byre: the east gate is closed (session_2026-07-06T00-03-28-376.log:2932)
check(
  'There are two exits: an open cedar gate leading north and a closed iron gate leading east.',
  { doorDirs: ['e', 'n'], openDoorDirs: ['n'], doorNouns: { e: 'gate', n: 'gate' } }
);
check(
  'There are two exits: an open steel trapdoor leading up and an open iron trapdoor leading down.',
  { doorDirs: ['d', 'u'], openDoorDirs: ['d', 'u'], doorNouns: { d: 'trapdoor', u: 'trapdoor' } }
);
check(
  'There are three exits: west, an open beaded curtain leading northwest, and a closed hatch leading up.',
  { doorDirs: ['nw', 'u'], openDoorDirs: ['nw'], doorNouns: { nw: 'curtain', u: 'hatch' } }
);
// A door onto a NAMED exit is a named exit, not a direction
// (session_2026-06-19T17-53-55-411.log:5476)
check('There are two exits: a closed curtain leading backroom and west.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: ['w'],
  named: ['backroom'],
  doorNouns: {},
});
check('There are two exits: west and an open wooden door leading doorway.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: ['w'],
  named: ['doorway'],
});
// Every non-direction item is a named exit (Syphe's hole:
// session_2026-07-05T15-39-35-835.log:2952; MUSH: path 4,598, hole 994,
// in 643, ocean 347, pool 243, ...), sorted
check('There are three exits: back, south, and hole.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: ['s'],
  named: ['back', 'hole'],
});
check('There are three exits: path, ocean, and an open stone door leading building.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: [],
  named: ['building', 'ocean', 'path'],
});
check('There is one obvious exit: path.', { doorDirs: [], openDoorDirs: [], named: ['path'] });
check(
  'There are many exits: north, northeast, east, southeast, south, southwest, west, and northwest.',
  { doorDirs: [], openDoorDirs: [], dirs: ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'] }
);
check('There is one exit: an open trapdoor leading down.', {
  doorDirs: ['d'],
  openDoorDirs: ['d'],
});
// No state word at all — defaults to closed (full door sequence)
check('There is one exit: a heavy gate leading northeast.', {
  doorDirs: ['ne'],
  openDoorDirs: [],
  doorNouns: { ne: 'gate' },
});
check('There are three exits: north, south, and east.', { doorDirs: [], openDoorDirs: [] });
// A room without exits
check('There are no obvious exits.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: [],
  named: [],
  doorNouns: {},
});

// Text the grammar cannot itemize falls back to the loose parse: a
// logger-garbled door phrase or list joiner keeps its directions (raw
// session-log lines; the replay's rejoin and the live feed see them whole)...
check('There is one obvious exit: a closed oak door leadin g west.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: ['w'],
});
check('There are four exits: west, a closed oak door leading north, south, an d up.', {
  doorDirs: ['n'],
  openDoorDirs: [],
  dirs: ['n', 's', 'u', 'w'],
});
// ...and so does a list whose item count disagrees with its count word: it
// itemizes, but a capture that lost or doubled an item can't be trusted
// item by item, so only the directions and the classic named exits are
// read (synthetic: no such sentence in either corpus)
check('There are three exits: north and path.', {
  doorDirs: [],
  openDoorDirs: [],
  dirs: ['n'],
  named: [],
});
// ...and the fallback no longer repeats the two door bugs: a door is the
// FIRST direction after "leading", with the state and noun of its own phrase
check('There are three exits: a closed pair of oak doors leading west and east.', {
  doorDirs: ['w'],
  openDoorDirs: [],
  dirs: ['e', 'w'],
  doorNouns: { w: 'doors' },
});
check('There are two exits: an open cedar gate leading north and a closed iron gate leading east', {
  doorDirs: ['e', 'n'],
  openDoorDirs: ['n'],
  doorNouns: { e: 'gate', n: 'gate' },
});

if (fail) process.exit(1);
console.log('PASS — exits list grammar: per-door state and noun, named exits, fallback');
