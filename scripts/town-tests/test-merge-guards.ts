/**
 * Regression test: the guards of the lockstep town merge, one scenario per
 * guard (each scenario fails when its guard is removed).
 *
 * Merges walk both link graphs from a matched pair (test-merge-lockstep).
 * Around that walk sit guards that rarely fire on the corpus but decide
 * what happens when the evidence is thin:
 *  1. re-anchor: a piece the walk cannot reach (the target never walked
 *     the link to it) seeds a second walk only on a match that is UNIQUE
 *     among the unclaimed target rooms, on the pair's relative floor,
 *     consistent with the fusions made so far, with equal exit unions and
 *     no headline conflict; otherwise the piece is copied. A claimed room
 *     is never a candidate (no two-into-one collapse)
 *  2. per walk step: same-name rooms whose descriptions differ in full AND
 *     in their opening are different rooms (a scar paired them)
 *  3. the seed pair: mirror-image exit unions refuse the merge, a union
 *     inside the other (an exit hidden by world state) does not
 *  4. ties: equal components leave the established town (or component) in
 *     place, whichever side the probe stands on
 *  5. bookkeeping: portal memory and entry rooms follow exactly the moved
 *     rooms; fused rooms keep a portal flag and adopt an icon; an emptied
 *     source town is deleted with its leftover portal memory; named exits
 *     are rebuilt on copies and fill gaps on fused rooms
 *  6. a contradiction refuses the merge also where the walk meets rooms it
 *     already paired
 *  7. never inside one link component, even on a direct call
 *  8. pending volatile-prose witnesses do not survive a merge
 */
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownDir, type TownRoomBlock } from '../../src/lib/townParser';

const WORDS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  u: 'up',
  d: 'down',
};
const REV: Record<string, TownDir> = { n: 's', s: 'n', e: 'w', w: 'e', u: 'd', d: 'u' };

function block(name: string, dirs: TownDir[], desc?: string): TownRoomBlock {
  const text =
    desc ??
    `This is the ${name.toLowerCase()}, a place with plenty of distinctive prose for comparison.`;
  return {
    name,
    descFirst: text.slice(0, 80),
    desc: text,
    exits: parseTownExits(`There are exits: ${dirs.map((d) => WORDS[d]).join(', ')}.`),
  };
}

type Spec = [string, number, number, number, TownDir[], string?];

/** Rooms at explicit coordinates, wired with symmetric links. */
function build(
  store: TownMapStore,
  town: Town,
  rooms: Spec[],
  links: [number, TownDir, number][]
): TownRoom[] {
  const out = rooms.map(([name, x, y, z, dirs, desc]) =>
    store.addRoom(town, block(name, dirs, desc), x, y, z, 0)
  );
  for (const [a, d, b] of links) {
    out[a].links[d] = out[b].id;
    out[b].links[REV[d]] = out[a].id;
  }
  return out;
}

let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else console.log(`ok   ${msg}`);
};
const named = (town: Town, name: string) => [...town.rooms.values()].filter((r) => r.name === name);
const show = (v: unknown) => JSON.stringify(v);

/** The fragment every re-anchor scenario walks: Gate-Square-Quay-Pier with
 *  a Fishmonger north of the Quay [Gate, Square, Quay, Pier, Fishmonger] */
const FRAGMENT_QUAY: Spec[] = [
  ['Gate', 0, 0, 0, ['e']],
  ['Square', 1, 0, 0, ['e', 'w']],
  ['Quay', 2, 0, 0, ['e', 'n', 'w']],
  ['Pier', 3, 0, 0, ['w']],
  ['Fishmonger', 2, -1, 0, ['s']],
];
const FRAGMENT_QUAY_LINKS: [number, TownDir, number][] = [
  [0, 'e', 1],
  [1, 'e', 2],
  [2, 'e', 3],
  [2, 'n', 4],
];

// ---------------------------------------------------------------------------
// 1a. Re-anchor needs a UNIQUE match: the port has two word-identical quays
//     and the target never walked Square->Quay. Which one the fragment
//     walked is unknowable, so its quay piece is copied, not fused onto one.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Quay', 4, 0, 0, ['e', 'n', 'w']],
      ['Pier', 5, 0, 0, ['w']],
      ['Fishmonger', 4, -1, 0, ['s']],
      ['Quay', 8, 0, 0, ['e', 'n', 'w']],
      ['Pier', 9, 0, 0, ['w']],
      ['Fishmonger', 8, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
      [5, 'e', 6],
      [5, 'n', 7],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(store, B, FRAGMENT_QUAY, FRAGMENT_QUAY_LINKS);
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 3,
    `unique: Gate + Square fused, the quay piece copied (${show(result)})`
  );
  check(
    [2, 3, 4, 5, 6, 7].every((i) => a[i].visits === 1),
    'unique: neither look-alike quay group absorbed it'
  );
  const quay = named(A, 'Quay').find((r) => r.id !== a[2].id && r.id !== a[5].id);
  check(
    !!quay && a[1].links.e === quay.id && quay.links.w === a[1].id,
    'unique: the copied Quay hangs east of the Square it was walked from'
  );
}

// ---------------------------------------------------------------------------
// 1b. Re-anchor stays on the pair's relative floor: an inn repeats its guest
//     floor word for word, and the target only knows the upstairs corridor
//     (a floater got it there). The fragment walked the ground-floor one.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Inn');
  const a = build(
    store,
    A,
    [
      ['Common Room', 0, 0, 0, ['e']],
      ['Hallway', 1, 0, 0, ['e', 'w']],
      ['Corridor', 4, 0, 1, ['e', 'n', 'w']],
      ['Guest Room', 5, 0, 1, ['w']],
      ['Linen Closet', 4, -1, 1, ['s']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Common Room', 0, 0, 0, ['e']],
      ['Hallway', 1, 0, 0, ['e', 'w']],
      ['Corridor', 2, 0, 0, ['e', 'n', 'w']],
      ['Guest Room', 3, 0, 0, ['w']],
      ['Linen Closet', 2, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
      [2, 'n', 4],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 3,
    `floor: the ground floor is copied, not fused upstairs (${show(result)})`
  );
  check(
    [2, 3, 4].every((i) => a[i].visits === 1),
    'floor: the upstairs corridor rooms are untouched'
  );
  const corridor = named(A, 'Corridor').find((r) => r.id !== a[2].id);
  check(
    !!corridor && corridor.z === 0 && a[1].links.e === corridor.id,
    `floor: the copied Corridor sits east of the Hallway on the ground floor (z=${corridor?.z})`
  );
}

// ---------------------------------------------------------------------------
// 1c. Re-anchor must agree with the fusions made so far: the town has two
//     word-identical squares, and the target mapped only the OTHER square's
//     quay. Its quay matches the fragment's on structure, but its west
//     neighbor is the other square, while the fragment's quay lies east of
//     the square the walk already fused: a different quay.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Lane', 5, 0, 0, ['e']],
      ['Square', 6, 0, 0, ['e', 'w']],
      ['Quay', 7, 0, 0, ['e', 'n', 'w']],
      ['Pier', 8, 0, 0, ['w']],
      ['Fishmonger', 7, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [3, 'e', 4],
      [4, 'e', 5],
      [4, 'n', 6],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(store, B, FRAGMENT_QUAY, FRAGMENT_QUAY_LINKS);
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 3,
    `consistent: only Gate + Square fused (${show(result)})`
  );
  check(
    [4, 5, 6].every((i) => a[i].visits === 1),
    "consistent: the other square's quay group is untouched"
  );
}

// ---------------------------------------------------------------------------
// 1d. The re-anchor seed needs equal exit unions: the only other Quay the
//     target knows lists a south exit the fragment's never did (and lacks
//     its west one): same name, same neighbors, different quay.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Quay', 4, 0, 0, ['e', 'n', 's']],
      ['Pier', 5, 0, 0, ['w']],
      ['Fishmonger', 4, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(store, B, FRAGMENT_QUAY, FRAGMENT_QUAY_LINKS);
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 3,
    `exits: a quay with other exits does not re-anchor (${show(result)})`
  );
  check(
    [2, 3, 4].every((i) => a[i].visits === 1),
    'exits: its quay group is untouched'
  );
}

// ---------------------------------------------------------------------------
// 1e. Mirror wings never re-anchor onto each other: the rangers' keep (real
//     texts). A login fragment walked the third-floor landing and the SOUTH
//     wing; the target knows the landing and the NORTH wing. The vestibules
//     share name, exits, neighbors and their first 40 characters ("This is
//     a small vestibule leading to the..."), and each wing's east and west
//     bedchambers are word-identical: only "south/north side of this floor"
//     in the headline tells the wings apart (checked on the anchor pair, and
//     again when the walk steps back onto it from the bedchambers).
// ---------------------------------------------------------------------------
{
  const LANDING_3F =
    'This is a landing on the third floor of the keep.  A spiral staircase winds up and down from this floor and archways lead off to the north and south.  A pair of wrought iron cressets flank a door to the west, providing a warm illumination.  It is bright.';
  const vestibule = (side: string, back: string) =>
    `This is a small vestibule leading to the bedrooms on the ${side} side of this floor.  Doors open onto bedrooms on the ${side}, east and west side and an open archway leads towards the landing to the ${back}.  Wrought-iron cressets mounted on the walls on either side of the archway shed a warm illumination.  It is bright.`;
  const bedchamber = (wall: string) =>
    `This is a bedchamber on an upper floor of the keep where one of the senior rangers may rest and store his or her gear.  Daylight streams in through a window on the ${wall} wall.  The room is furnished with a bed with a large chest pushed up against the foot it.  A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  It is shadowy.`;
  const DAY_ROOM =
    'This is a comfortable sitting room on the second floor of the keep where the rangers can come and relax between their duties and training.  Daylight streams in through a window on the west wall.  At the east end of the room is a spiral stone staircase which goes up and down to the other floors of the keep.  It is bright.';
  const ARMORY =
    "This is a small armory off the third floor landing where the rangers' spare bows, quivers and blades hang in neat racks.  It is bright.";
  const keep = (wing: 'north' | 'south'): Spec[] => {
    const dy = wing === 'north' ? -1 : 1;
    return [
      ['Landing', 0, 0, 0, ['d', 'n', 's', 'u', 'w'], LANDING_3F],
      ['Day Room', 0, 0, -1, ['d', 'n', 's', 'u'], DAY_ROOM],
      ['Armory', -1, 0, 0, ['e'], ARMORY],
      [
        'Vestibule',
        0,
        dy,
        0,
        ['e', 'n', 's', 'w'],
        vestibule(wing, wing === 'north' ? 'south' : 'north'),
      ],
      ['Bedchamber', 1, dy, 0, ['w'], bedchamber('east')],
      ['Bedchamber', -1, dy, 0, ['e'], bedchamber('west')],
    ];
  };
  const wingLinks = (toWing: TownDir): [number, TownDir, number][] => [
    [0, 'd', 1],
    [0, 'w', 2],
    [0, toWing, 3],
    [3, 'e', 4],
    [3, 'w', 5],
  ];
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  const a = build(store, A, keep('north'), wingLinks('n'));
  const B = store.createTown('Bedchamber');
  const b = build(store, B, keep('south'), wingLinks('s'));
  // The structural probe pairs the landings (stairs down + the west door)
  const cand = store.findMergeCandidate(B, b[0], 2);
  check(cand?.room === a[0], 'headline: the probe pairs the two sightings of the landing');
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 3 && result.placed === 3,
    `headline: landing, day room and armory fused; the south wing copied (${show(result)})`
  );
  check(
    [3, 4, 5].every((i) => a[i].visits === 1),
    'headline: the north wing did not absorb the south wing'
  );
  const vestS = named(A, 'Vestibule').find((r) => r.id !== a[3].id);
  check(
    !!vestS && a[0].links.s === vestS.id && /south side/.test(vestS.desc),
    'headline: the south vestibule hangs south of the landing'
  );
  check(
    named(A, 'Bedchamber').length === 4,
    `headline: four bedchambers (${named(A, 'Bedchamber').length})`
  );
}

// ---------------------------------------------------------------------------
// 1f. The anchor pair's own headline, when no walk step ever leads back to
//     it: two general stores on Main Street read word for word alike except
//     the corner their first sentence names. The fragment's store hangs off
//     a stretch of Main Street the target never joined to its square; the
//     target knows the other store. Their neighbors share names but not
//     exits (another stretch of the street, another store room), so the
//     walk pairs none of them, and only the stores' headlines tell them
//     apart.
// ---------------------------------------------------------------------------
{
  const storeText = (corner: string) =>
    `This is a small general store on the corner of Main Street and ${corner} Street.  Shelves of rope, lamp oil and dried food line the walls.  It is bright.`;
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = build(
    store,
    A,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Main Street', 6, 0, 0, ['e', 's', 'w']],
      ['General Store', 6, 1, 0, ['n', 's'], storeText('Ash')],
      ['Store Room', 6, 2, 0, ['n']],
    ],
    [
      [0, 'e', 1],
      [2, 's', 3],
      [3, 's', 4],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Gate', 0, 0, 0, ['e']],
      ['Square', 1, 0, 0, ['e', 'w']],
      ['Main Street', 2, 0, 0, ['s', 'w']],
      ['General Store', 2, 1, 0, ['n', 's'], storeText('Elm')],
      ['Store Room', 2, 2, 0, ['e', 'n']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 's', 3],
      [3, 's', 4],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 3,
    `anchor headline: the Elm Street store is copied (${show(result)})`
  );
  check(
    a[3].visits === 1 && named(A, 'General Store').length === 2,
    'anchor headline: the Ash Street store did not absorb it'
  );
}

// ---------------------------------------------------------------------------
// 1g. Re-anchor candidates are UNCLAIMED rooms: the port has two word-
//     identical fish quays, and the fragment walked both, the second one
//     through a court south of the gate (an exit the target never walked).
//     The walk fuses the first quay group onto the target's. The second
//     quay's only structural match is that same target quay, already
//     claimed: two fragment rooms never become one target room, so the
//     second group is copied.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Port');
  const a = build(
    store,
    A,
    [['Gate', 0, 0, 0, ['e', 's']], ...FRAGMENT_QUAY.slice(1)],
    FRAGMENT_QUAY_LINKS
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Gate', 0, 0, 0, ['e', 's']],
      ...FRAGMENT_QUAY.slice(1),
      ['Court', 0, 5, 0, ['e', 'n']],
      ['Square', 1, 5, 0, ['e', 'w']],
      ['Quay', 2, 5, 0, ['e', 'n', 'w']],
      ['Pier', 3, 5, 0, ['w']],
      ['Fishmonger', 2, 4, 0, ['s']],
    ],
    [...FRAGMENT_QUAY_LINKS, [0, 's', 5], [5, 'e', 6], [6, 'e', 7], [7, 'e', 8], [7, 'n', 9]]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 5 && result.placed === 5,
    `claimed: the first quay group fused, the second copied (${show(result)})`
  );
  const quays = named(A, 'Quay');
  check(
    quays.length === 2 && a[2].visits === 2,
    `claimed: two quays; the target's absorbed only the first (${quays.length}, visits ${a[2].visits})`
  );
  const court = named(A, 'Court')[0];
  const square2 = named(A, 'Square').find((r) => r.id !== a[1].id);
  const quay2 = quays.find((r) => r.id !== a[2].id);
  check(
    !!court &&
      !!square2 &&
      !!quay2 &&
      a[0].links.s === court.id &&
      court.links.e === square2.id &&
      square2.links.e === quay2.id &&
      quay2.links.w === square2.id,
    'claimed: the second quay hangs off the court south of the gate, as walked'
  );
}

// ---------------------------------------------------------------------------
// 2. Per walk step: a desync scar wired the target square's east exit to
//    the look-alike alley one street over. Both alleys open with the same
//    short sentence (too short for the headline guard) and differ after it,
//    so the pair is not fused; the merge itself goes ahead.
// ---------------------------------------------------------------------------
{
  const TANNERY =
    'A narrow alley.  The stink of the tannery vats hangs between the walls here.  It is dark.';
  const LAUNDRY =
    'A narrow alley.  Wet laundry hangs on lines strung between the upper windows.  It is dark.';
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'w']],
      ['Gate', -1, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['w'], LAUNDRY],
    ],
    [
      [0, 'w', 1],
      [0, 'e', 2],
    ]
  );
  const B = store.createTown('Fragment');
  const b = build(
    store,
    B,
    [
      ['Square', 0, 0, 0, ['e', 'w']],
      ['Gate', -1, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['w'], TANNERY],
    ],
    [
      [0, 'w', 1],
      [0, 'e', 2],
    ]
  );
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(
    result?.fused === 2 && result.placed === 1,
    `desc: Square + Gate fused, the other alley copied (${show(result)})`
  );
  check(
    a[2].visits === 1 && a[2].desc === LAUNDRY,
    'desc: the laundry alley did not absorb the tannery one'
  );
  check(
    named(A, 'Alley').some((r) => r.desc === TANNERY),
    'desc: the tannery alley exists in the target'
  );
}

// ---------------------------------------------------------------------------
// 3. The seed pair: word-identical mirror wings. The target mapped the east
//    wing, a login fragment the west wing; their halls share name, prose and
//    neighbors (bedroom north, study south), so the probe pairs them, but
//    the halls' exits are mirror images ([e,n,s] vs [n,s,w]). A sighting
//    with an exit hidden (one union inside the other) still merges.
// ---------------------------------------------------------------------------
{
  const HALL =
    'This is a long hall lined with portraits of the family ancestors, their painted eyes following every visitor.';
  const wing = (store: TownMapStore, town: Town, back: TownDir) =>
    build(
      store,
      town,
      [
        ['Hall', 0, 0, 0, [back, 'n', 's'], HALL],
        ['Bedroom', 0, -1, 0, ['s']],
        ['Study', 0, 1, 0, ['n']],
      ],
      [
        [0, 'n', 1],
        [0, 's', 2],
      ]
    );
  const store = new TownMapStore();
  const A = store.createTown('Manor');
  const a = wing(store, A, 'w'); // east wing: the gallery lies west
  const B = store.createTown('Bedroom');
  const b = wing(store, B, 'e'); // west wing: the gallery lies east
  const cand = store.findMergeCandidate(B, b[0], 2);
  check(cand?.room === a[0], 'seed: the probe pairs the mirror-image halls');
  const before = show(store.serialize());
  check(store.mergeTowns(B, b[0].id, A, a[0].id) === null, 'seed: mirror-image exits refuse');
  check(show(store.serialize()) === before, 'seed: a refused merge changes nothing');

  // The same wing seen only with its gallery exit hidden (a portcullis down;
  // closed doors still list their direction): [n,s] inside [n,s,w]
  const store2 = new TownMapStore();
  const A2 = store2.createTown('Manor');
  const a2 = wing(store2, A2, 'w');
  const B2 = store2.createTown('Bedroom');
  const b2 = wing(store2, B2, 'w');
  b2[0].exits = ['n', 's'];
  b2[0].exitsEver = ['n', 's'];
  const result = store2.mergeTowns(B2, b2[0].id, A2, a2[0].id);
  check(
    result?.fused === 3 && A2.rooms.size === 3,
    `seed: a sighting with an exit hidden still merges (${show(result)})`
  );
}

// ---------------------------------------------------------------------------
// 4a. Ties across towns: a fragment grew exactly the rooms the established
//     town has there. Whichever side the player stands on, the newer town
//     moves and the established one stays.
// ---------------------------------------------------------------------------
for (const standIn of ['established', 'fragment'] as const) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const spec: Spec[] = [
    ['Square', 0, 0, 0, ['e', 'n']],
    ['Market', 1, 0, 0, ['w']],
    ['Temple', 0, -1, 0, ['s']],
  ];
  const links: [number, TownDir, number][] = [
    [0, 'e', 1],
    [0, 'n', 2],
  ];
  const E = map.createTown('Eris');
  const e = build(map, E, spec, links);
  const F = map.createTown('Square');
  const f = build(map, F, spec, links);
  loc.active = true;
  map.pos =
    standIn === 'established'
      ? { townId: E.id, roomId: e[0].id }
      : { townId: F.id, roomId: f[0].id };
  loc.trackCommand('look', 1000);
  const res = loc.onRoomBlock(block('Square', ['e', 'n']), null, 2000);
  check(
    res.merged?.from === F.id && res.merged.into === E.id,
    `tie (standing in the ${standIn} town): the fragment moves (${show(res.merged)})`
  );
  check(
    map.towns.has(E.id) && !map.towns.has(F.id) && E.rooms.size === 3,
    `tie (standing in the ${standIn} town): the established town stays, unduplicated`
  );
  check(
    map.pos?.townId === E.id && map.pos.roomId === e[0].id,
    `tie (standing in the ${standIn} town): standing on the established Square`
  );
}

// ---------------------------------------------------------------------------
// 4b. Ties inside one town: a floater one floor off grew a copy of the same
//     three rooms. The older component (lower room ids) keeps its rooms and
//     coordinates; the copy is retired into it.
// ---------------------------------------------------------------------------
for (const standOn of ['older', 'copy'] as const) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  const T = map.createTown('Segliz');
  const t = build(
    map,
    T,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
      ['Square', 5, 5, 1, ['e', 'n']],
      ['Market', 6, 5, 1, ['w']],
      ['Temple', 5, 4, 1, ['s']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
      [3, 'e', 4],
      [3, 'n', 5],
    ]
  );
  loc.active = true;
  map.pos = { townId: T.id, roomId: (standOn === 'older' ? t[0] : t[3]).id };
  loc.trackCommand('look', 1000);
  const res = loc.onRoomBlock(block('Square', ['e', 'n']), null, 2000);
  check(
    res.merged?.from === T.id && res.merged.into === T.id && res.merged.fused === 3,
    `same-town tie (on the ${standOn} Square): merged within the town (${show(res.merged)})`
  );
  check(
    [...T.rooms.keys()].sort().join(',') === [t[0].id, t[1].id, t[2].id].join(',') &&
      t[0].z === 0 &&
      t[0].x === 0 &&
      t[1].x === 1,
    `same-town tie (on the ${standOn} Square): the older rooms stay where they were`
  );
  check(
    map.pos?.roomId === t[0].id,
    `same-town tie (on the ${standOn} Square): standing on the older Square`
  );
}

// ---------------------------------------------------------------------------
// 5a. Bookkeeping across towns, with a surviving source: an Eris floater
//     component inside Soriktos fuses into Eris; Soriktos keeps its own
//     rooms. Portal memory and the entry room follow exactly the moved rooms.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
    ]
  );
  const S = store.createTown('Soriktos');
  const s = build(
    store,
    S,
    [
      ['Souk', 0, 0, 0, ['e']],
      ['Alley', 1, 0, 0, ['w']],
      ['Square', 5, 5, 0, ['e', 'n']],
      ['Market', 6, 5, 0, ['w']],
      ['Temple', 5, 4, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [2, 'e', 3],
      [2, 'n', 4],
    ]
  );
  const at = (town: Town, room: TownRoom) => ({ townId: town.id, roomId: room.id });
  store.setPortalDest(at(S, s[1]), 'north', at(S, s[0])); // unmoved -> unmoved
  store.setPortalDest(at(S, s[3]), 'south', at(S, s[0])); // moved -> unmoved
  store.setPortalDest(at(S, s[0]), 'east', at(S, s[4])); // unmoved -> moved
  S.entryRoomId = s[2].id; // the floater's Square was the first room seen
  A.entryRoomId = a[1].id;
  // Fused rooms keep what only the fragment knew: a portal, an icon
  s[2].portal = true;
  store.setRoomIcon(S.id, s[2].id, 'bank');
  store.setRoomIcon(A.id, a[2].id, 'none'); // the user removed the temple icon
  const result = store.mergeTowns(S, s[2].id, A, a[0].id);
  check(result?.fused === 3 && result.placed === 0, `bookkeeping: 3 fused (${show(result)})`);
  check(store.towns.has(S.id) && S.rooms.size === 2, 'bookkeeping: Soriktos survives');
  check(
    show(store.getPortalDest(at(S, s[1]), 'north')) === show(at(S, s[0])),
    "bookkeeping: an unmoved room's portal memory is untouched"
  );
  check(
    show(store.getPortalDest(at(A, a[1]), 'south')) === show(at(S, s[0])) &&
      store.getPortalDest(at(S, s[3]), 'south') === undefined,
    "bookkeeping: a moved room's portal memory is re-keyed into Eris"
  );
  check(
    show(store.getPortalDest(at(S, s[0]), 'east')) === show(at(A, a[2])),
    'bookkeeping: portal memory leading into a moved room follows it'
  );
  check(store.portalDests.size === 3, `bookkeeping: no entry lost (${store.portalDests.size})`);
  check(
    S.entryRoomId !== null && S.rooms.has(S.entryRoomId),
    `bookkeeping: Soriktos' entry room re-pointed at a room it still has (${S.entryRoomId})`
  );
  check(A.entryRoomId === a[1].id, "bookkeeping: Eris' own entry room is kept");
  check(a[0].portal && a[0].icon === 'bank', 'bookkeeping: the fused Square kept portal + icon');
  check(a[2].icon === 'none', "bookkeeping: a removed icon stays removed (the user's choice)");
}

// ---------------------------------------------------------------------------
// 5b. Bookkeeping inside one town: the copy component's gate was the
//     town's entry room and carries portal memory; both follow the fusion.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const T = store.createTown('Segliz');
  const t = build(
    store,
    T,
    [
      ['Main Street', 0, 0, 0, ['e', 'n', 'w']],
      ['Harbor Way', 0, -1, 0, ['s']],
      ['Promenade', -1, 0, 0, ['e']],
      ['Weathered Gate', 1, 0, 0, ['w']],
      ['Main Street', 4, -1, 1, ['e', 'n', 'w']],
      ['Harbor Way', 4, -2, 1, ['s']],
      ['Weathered Gate', 5, -1, 1, ['w']],
    ],
    [
      [0, 'n', 1],
      [0, 'w', 2],
      [0, 'e', 3],
      [4, 'n', 5],
      [4, 'e', 6],
    ]
  );
  T.entryRoomId = t[6].id;
  const at = (room: TownRoom) => ({ townId: T.id, roomId: room.id });
  store.setPortalDest(at(t[6]), null, at(t[5]));
  const result = store.mergeTowns(T, t[4].id, T, t[0].id);
  check(result?.fused === 3, `same-town bookkeeping: 3 fused (${show(result)})`);
  check(
    T.entryRoomId === t[3].id,
    `same-town bookkeeping: the entry room is the real gate now (${T.entryRoomId})`
  );
  check(
    show(store.getPortalDest(at(t[3]), null)) === show(at(t[1])) && store.portalDests.size === 1,
    'same-town bookkeeping: portal memory moved onto the real gate and road'
  );
}

// ---------------------------------------------------------------------------
// 5c. An emptied source town is deleted the way every town is, so portal
//     memory still keyed to it (its room vanished before this merge, as an
//     older save can have) goes with it instead of lingering forever.
// ---------------------------------------------------------------------------
{
  const store = new TownMapStore();
  const A = store.createTown('Eris');
  const a = build(
    store,
    A,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
    ]
  );
  const F = store.createTown('Square');
  const f = build(
    store,
    F,
    [
      ['Square', 0, 0, 0, ['e', 'n']],
      ['Market', 1, 0, 0, ['w']],
      ['Temple', 0, -1, 0, ['s']],
    ],
    [
      [0, 'e', 1],
      [0, 'n', 2],
    ]
  );
  store.setPortalDest({ townId: F.id, roomId: 99 }, 'west', { townId: A.id, roomId: a[1].id });
  store.setPortalDest({ townId: A.id, roomId: a[2].id }, 'up', { townId: F.id, roomId: 98 });
  const result = store.mergeTowns(F, f[0].id, A, a[0].id);
  check(result?.fused === 3 && !store.towns.has(F.id), 'emptied: the fragment town is deleted');
  check(
    [...store.portalDests].every(([k, d]) => !k.startsWith(`${F.id}:`) && d.townId !== F.id),
    `emptied: no portal memory names the deleted town (${show([...store.portalDests])})`
  );
}

// ---------------------------------------------------------------------------
// 5d. Named exits come along: the fragment found the fortune teller's tent
//     behind the market ("enter tent" from the Market, "out" back to it; its
//     back flap opens west onto the alley). The tent is copied with its "out"
//     rebuilt onto the target's Market, and the fused Market gains the
//     "enter tent" it lacked while keeping the named exit only it knew.
// ---------------------------------------------------------------------------
{
  const spec: Spec[] = [
    ['Square', 0, 0, 0, ['e', 'n']],
    ['Market', 1, 0, 0, ['w']],
    ['Alley', 0, -1, 0, ['e', 's']],
  ];
  const links: [number, TownDir, number][] = [
    [0, 'e', 1],
    [0, 'n', 2],
  ];
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = build(store, A, spec, links);
  const booth = store.addRoom(A, block('Booth', []), 2, 0, 0, 0);
  a[1].namedLinks['enter booth'] = booth.id;
  const B = store.createTown('Fragment');
  const b = build(store, B, [...spec, ['Tent', 1, -1, 0, ['w']]], [...links, [2, 'e', 3]]);
  b[1].namedLinks['enter tent'] = b[3].id;
  b[3].namedLinks['out'] = b[1].id;
  const result = store.mergeTowns(B, b[0].id, A, a[0].id);
  check(result?.fused === 3 && result.placed === 1, `named: the tent copied (${show(result)})`);
  const tent = named(A, 'Tent')[0];
  check(
    !!tent && tent.namedLinks['out'] === a[1].id,
    `named: the copied tent's "out" leads to the target's Market (${show(tent?.namedLinks)})`
  );
  check(
    !!tent && a[1].namedLinks['enter tent'] === tent.id,
    `named: the fused Market gained "enter tent" (${show(a[1].namedLinks)})`
  );
  check(
    a[1].namedLinks['enter booth'] === booth.id,
    'named: and kept the "enter booth" only the target knew'
  );
}

// ---------------------------------------------------------------------------
// 6. A contradiction counts wherever the walk meets it, also on rooms it
//    already paired. Both maps agree on the square, temple, market and the
//    shrine east of the temple, but not on where the market's north exit
//    leads: (a) the fragment closes the loop at the shrine, the target
//    reached a well there; (b) the other way round. One side is a desync
//    scar and nothing says which, so the merge is refused and nothing
//    changes.
// ---------------------------------------------------------------------------
for (const variant of ['fragment loop', 'target loop'] as const) {
  const shrineSpec: Spec[] = [
    ['Square', 0, 0, 0, ['e', 'n']],
    ['Temple', 0, -1, 0, ['e', 's']],
    ['Market', 1, 0, 0, ['n', 'w']],
    ['Shrine', 1, -1, 0, ['s', 'w']],
  ];
  const shrineLinks: [number, TownDir, number][] = [
    [0, 'n', 1],
    [0, 'e', 2],
    [1, 'e', 3],
  ];
  const loop = (store: TownMapStore, town: Town) =>
    build(store, town, shrineSpec, [...shrineLinks, [2, 'n', 3]]);
  const well = (store: TownMapStore, town: Town) =>
    build(store, town, [...shrineSpec, ['Well', 5, 5, 0, ['s']]], [...shrineLinks, [2, 'n', 4]]);
  const store = new TownMapStore();
  const A = store.createTown('Town');
  const a = variant === 'fragment loop' ? well(store, A) : loop(store, A);
  const B = store.createTown('Fragment');
  const b = variant === 'fragment loop' ? loop(store, B) : well(store, B);
  const before = show(store.serialize());
  check(
    store.mergeTowns(B, b[0].id, A, a[0].id) === null,
    `contradiction on a paired room (${variant}): the merge is refused`
  );
  check(
    show(store.serialize()) === before,
    `contradiction on a paired room (${variant}): nothing changed`
  );
}

// ---------------------------------------------------------------------------
// 7. Never inside one link component: look-alikes you can walk between are
//    twins (a corridor of word-identical segments), not duplicates. The
//    probe never offers them; a direct call is refused as well, where
//    "merging" the segments would retire one into its own neighbor.
// ---------------------------------------------------------------------------
{
  const SEGMENT = 'A long, dim corridor runs east and west between bare stone walls.';
  const store = new TownMapStore();
  const T = store.createTown('Keep');
  const c = build(
    store,
    T,
    [
      ['Corridor', 0, 0, 0, ['e'], SEGMENT],
      ['Corridor', 1, 0, 0, ['e', 'w'], SEGMENT],
      ['Corridor', 2, 0, 0, ['e', 'w'], SEGMENT],
      ['Guard Room', 3, 0, 0, ['w']],
    ],
    [
      [0, 'e', 1],
      [1, 'e', 2],
      [2, 'e', 3],
    ]
  );
  check(store.findMergeCandidate(T, c[1], 2) === null, 'one component: the probe offers nothing');
  const before = show(store.serialize());
  check(
    store.mergeTowns(T, c[1].id, T, c[0].id) === null &&
      store.mergeTowns(T, c[2].id, T, c[1].id) === null,
    'one component: a direct merge of two segments is refused'
  );
  check(show(store.serialize()) === before, 'one component: nothing changed');
}

// ---------------------------------------------------------------------------
// 8. Volatile-prose witnesses are dropped by a merge: they hold bare room
//    ids, and a merge renumbers rooms, so a sighting before the merge plus
//    one after it could pass for the "two different rooms" the learning
//    demands while being ONE room (the market seen at dusk and at night).
// ---------------------------------------------------------------------------
{
  const market = (crowd: string) =>
    `This is a spacious market square in the heart of the town.  ${crowd}  A stone fountain splashes in the middle of the square.  It is bright.`;
  const DUSK = 'The crowds are thinning as the sun sets and some of the vendors have closed up.';
  const NIGHT = 'There is little activity in the market at this hour except near the taproom.';
  const spec: Spec[] = [
    ['Market', 0, 0, 0, ['e', 'n'], market(DUSK)],
    ['Inn', 1, 0, 0, ['w']],
    ['Temple', 0, -1, 0, ['s']],
  ];
  const links: [number, TownDir, number][] = [
    [0, 'e', 1],
    [0, 'n', 2],
  ];
  const store = new TownMapStore();
  const A = store.createTown('Town');
  store.addRoom(A, block('Gate', []), 9, 9, 0, 0); // ids differ between the towns
  const a = build(store, A, spec, links);
  const F = store.createTown('Market');
  const f = build(store, F, spec, links);
  check(f[0].id !== a[0].id, `volatile: the two sightings carry different ids (${f[0].id})`);
  store.touchRoom(f[0], block('Market', ['e', 'n'], market(NIGHT)), 1000, true);
  const result = store.mergeTowns(F, f[0].id, A, a[0].id);
  check(result?.fused === 3, `volatile: the fragment fused (${show(result)})`);
  store.touchRoom(a[0], block('Market', ['e', 'n'], market(NIGHT)), 2000, true);
  check(
    !store.volatileSentences.has(NIGHT),
    'volatile: one market seen before and after the merge teaches nothing'
  );
  // A second physical room with the same swap still teaches it
  const stall = store.addRoom(A, block('Market Stalls', ['w'], market(DUSK)), 9, 8, 0, 0);
  store.touchRoom(stall, block('Market Stalls', ['w'], market(NIGHT)), 3000, true);
  check(
    store.volatileSentences.has(NIGHT) && store.volatileSentences.has(DUSK),
    'volatile: a second room with the same swap is learned as usual'
  );
}

if (failed > 0) {
  console.error(`${failed} merge-guard assertion(s) failed`);
  process.exit(1);
}
console.log(
  'PASS: every merge guard holds (re-anchor, step veto, seed exits, ties, bookkeeping, contradictions, one component, volatile witnesses)'
);
