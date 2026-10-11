/**
 * Regression test: the HEADLINE guard on town merges (mirror floors).
 *
 * Merges align fragments by walking both link graphs in lockstep and fuse
 * rooms by name — and mirror-copied floors defeat names, exits AND most of
 * the prose: the rangers' keep repeats its bedroom wing floor after floor
 * with word-identical vestibules and bedchambers, and only the landing's
 * FIRST sentence says which floor it is ("This is a landing on the third
 * floor of the keep." / "...on the fourth floor..."). A fragment holding a
 * different floor's wing structurally matches the mapped one at its
 * vestibule, and both the old translated-cell merge and a name-only lockstep
 * fused the whole wing onto the wrong floor — landing included. The same
 * exposure exists inside one town once duplicate components can merge (a
 * floor reached through a floater is its own component).
 *
 * A first-sentence contradiction anywhere in the walk refuses the merge:
 * no DF-era room ever changed its first sentence between sightings (0 of
 * 418 corpus rooms with several texts), so it is never a stale sighting.
 * Texts are the real keep texts (3F south wing; the real 4F landing).
 */
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { parseTownExits, type TownDir, type TownRoomBlock } from '../../src/lib/townParser';

const LANDING_3F =
  'This is a landing on the third floor of the keep.  A spiral staircase winds up and down from this floor and archways lead off to the north and south.  A pair of wrought iron cressets flank a door to the west, providing a warm illumination.  It is bright.';
const LANDING_4F =
  'This is a landing on the fourth floor of the keep.  A spiral staircase winds up and down from this floor doors lead off in four directions to the quarters of the Order of Dragons.  A pair of wrought iron cressets are attached to the walls, providing a warm illumination.  It is bright.';
const VESTIBULE =
  'This is a small vestibule leading to the bedrooms on the south side of this floor.  Doors open onto bedrooms on the south, east and west side and an open archway leads towards the landing to the north.  Wrought-iron cressets mounted on the walls on either side of the archway shed a warm illumination.  It is bright.';
const bedchamber = (wall: string) =>
  `This is a bedchamber on an upper floor of the keep where one of the senior rangers may rest and store his or her gear.  Daylight streams in through a window on the ${wall} wall.  The room is furnished with a bed with a large chest pushed up against the foot it.  A thick red wool rug covers the floor, giving a splash of color and warmth to the room.  It is shadowy.`;

const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.slice(0, 80),
  desc,
  exits: parseTownExits(exits),
});
const B = {
  landing3: block(
    'Landing',
    'There are five exits: down, up, north, south, and a closed oak door leading west.',
    LANDING_3F
  ),
  landing4: block(
    'Landing',
    'There are six exits: down, up, a closed oak door leading north, a closed oak door leading east, a closed oak door leading south, and a closed oak door leading west.',
    LANDING_4F
  ),
  vestibule: block(
    'Vestibule',
    'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and a closed oak door leading east.',
    VESTIBULE
  ),
  bedE: block(
    'Bedchamber',
    'There is one obvious exit: a closed oak door leading west.',
    bedchamber('east')
  ),
  bedW: block(
    'Bedchamber',
    'There is one obvious exit: a closed oak door leading east.',
    bedchamber('west')
  ),
  bedS: block(
    'Bedchamber',
    'There is one obvious exit: a closed oak door leading north.',
    bedchamber('south')
  ),
};
const REV: Record<string, TownDir> = { n: 's', s: 'n', e: 'w', w: 'e', u: 'd', d: 'u' };

/** A landing with the south bedroom wing behind it: [L, V, E, W, S] */
function wing(
  store: TownMapStore,
  t: Town,
  landing: TownRoomBlock,
  x: number,
  y: number,
  z: number
) {
  const L = store.addRoom(t, landing, x, y, z, 0);
  const V = store.addRoom(t, B.vestibule, x, y + 1, z, 0);
  const E = store.addRoom(t, B.bedE, x + 1, y + 1, z, 0);
  const W = store.addRoom(t, B.bedW, x - 1, y + 1, z, 0);
  const S = store.addRoom(t, B.bedS, x, y + 2, z, 0);
  const link = (a: TownRoom, d: TownDir, c: TownRoom) => {
    a.links[d] = c.id;
    c.links[REV[d]] = a.id;
  };
  link(L, 's', V);
  link(V, 'e', E);
  link(V, 'w', W);
  link(V, 's', S);
  return [L, V, E, W, S];
}

let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else console.log(`ok   ${msg}`);
};
/** Which floors the town's Landing rooms say they are on */
const landings = (t: Town) =>
  [...t.rooms.values()]
    .filter((r) => r.name === 'Landing')
    .map((r) => /on the (\w+) floor/.exec(r.desc)?.[1] ?? '?');

// 1. Another town's fragment holds the 4F wing: it matches the mapped 3F
//    wing at the vestibule, and the walk reaches the landings.
{
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const f3 = wing(store, eris, B.landing3, 0, 0, 2);
  const frag = store.createTown('Bedchamber');
  const f4 = wing(store, frag, B.landing4, 0, 0, 0);
  const cand = store.findMergeCandidate(frag, f4[1], 2);
  check(cand?.room === f3[1], 'cross-town: the 4F vestibule matches the 3F one (mirror)');
  const before = JSON.stringify(store.serialize());
  const result = store.mergeTowns(frag, f4[1].id, eris, f3[1].id);
  check(result === null, 'cross-town: the third/fourth floor headline refuses the merge');
  check(store.towns.has(frag.id) && frag.rooms.size === 5, 'cross-town: the fragment is intact');
  check(
    JSON.stringify(store.serialize()) === before,
    `cross-town: nothing changed (Eris landings: ${landings(eris).join(', ')})`
  );
}

// 2. The same mirror floor as a second component of ONE town (reached
//    through a floater): the own-town probe finds it, the guard refuses it.
{
  const store = new TownMapStore();
  const keep = store.createTown('Eris');
  const f3 = wing(store, keep, B.landing3, 0, 0, 2);
  const f4 = wing(store, keep, B.landing4, 6, 6, 3);
  const cand = store.findMergeCandidate(keep, f4[1], 2);
  check(
    cand?.town === keep && cand.room === f3[1],
    'intra: the own-town probe finds the twin wing'
  );
  const result = cand ? store.mergeTowns(keep, f4[1].id, keep, f3[1].id) : undefined;
  check(result === null, 'intra: the headline refuses fusing the 4F wing onto the 3F one');
  check(keep.rooms.size === 10, `intra: both wings survive (${keep.rooms.size} rooms)`);

  // Live: standing on the 4F vestibule, a re-print runs the probe — the
  // refused merge must not report a merge or move the player.
  const loc = new TownLocalizer(store);
  loc.active = true;
  store.pos = { townId: keep.id, roomId: f4[1].id };
  loc.trackCommand('look', 1000);
  const res = loc.onRoomBlock(B.vestibule, null, 2000);
  check(!res.merged && store.pos?.roomId === f4[1].id, 'intra: a refused probe is no merge');
}

// 3. The guard must not fire on legitimate merges: a description captured
//    from a later sentence (log fragmentation) or mid-sentence is not a
//    different headline.
{
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const f3 = wing(store, eris, B.landing3, 0, 0, 2);
  const frag = store.createTown('Bedchamber');
  const tail = LANDING_3F.slice(LANDING_3F.indexOf('A spiral'));
  const g3 = wing(
    store,
    frag,
    { ...B.landing3, desc: tail, descFirst: tail.slice(0, 80) },
    0,
    0,
    0
  );
  const mid = bedchamber('east').slice(30);
  g3[2].desc = mid;
  g3[2].descFirst = mid.slice(0, 80);
  const result = store.mergeTowns(frag, g3[1].id, eris, f3[1].id);
  check(
    result?.fused === 5 && eris.rooms.size === 5,
    `tails: a tail-captured landing still merges (${JSON.stringify(result)})`
  );
}

// 3b. ...nor is a capture that opens inside world-state prose, which the
//     other sighting cannot contain: a fragmented night sighting of the
//     bedchamber that starts mid-word in its starlight sentence, and a
//     market capture that starts at the first sentence's last word
//     ("Eris.") against one that starts at a different crowd sentence.
//     Neither opening is the room's first sentence (one starts lowercase,
//     the other is too short to be one), so the matched pair merges.
{
  const night = bedchamber('east').replace(
    'Daylight streams in through a window on the east wall.',
    'Starlight streams in through a window on the east wall and a pair of wrought-iron lanterns suspended from the ceiling shed a warm illumination.'
  );
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const f3 = wing(store, eris, B.landing3, 0, 0, 2);
  const frag = store.createTown('Bedchamber');
  const g3 = wing(store, frag, B.landing3, 0, 0, 0);
  g3[2].desc = night.slice(night.indexOf('arlight'));
  g3[2].descFirst = g3[2].desc.slice(0, 80);
  const result = store.mergeTowns(frag, g3[2].id, eris, f3[2].id);
  check(
    result?.fused === 5,
    `tails: a night sighting captured mid-word still merges (${JSON.stringify(result)})`
  );
}
{
  const market = (crowd: string) =>
    `This is a spacious market square in the heart of Eris.  ${crowd}  This appears to be the center of the market, and contains a well which provides the burgeoning town with clean water.  It is bright.`;
  const day = market('A few housewives are about shopping for groceries for the day.');
  const night = market(
    'The market is mostly empty except for a few adventurers and revelers heading home from the inn.'
  );
  const EXITS =
    'There are eight exits: north, northeast, east, southeast, south, southwest, west and northwest.';
  const pair = (store: TownMapStore, t: Town, desc: string) => {
    const m = store.addRoom(t, block('Market', EXITS, desc), 0, 0, 0, 0);
    const lane = store.addRoom(
      t,
      block(
        'Ash Lane',
        'There is one obvious exit: east.',
        'A narrow lane leads off the market here.'
      ),
      -1,
      0,
      0,
      0
    );
    m.links.w = lane.id;
    lane.links.e = m.id;
    return m;
  };
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const target = pair(store, eris, day.slice(day.indexOf('A few')));
  const frag = store.createTown('Market');
  const seen = pair(store, frag, night.slice(night.indexOf('Eris.')));
  const result = store.mergeTowns(frag, seen.id, eris, target.id);
  check(
    result?.fused === 2,
    `tails: a capture opening on "Eris." still merges (${JSON.stringify(result)})`
  );
}
// 3c. ...nor is a capture that opens on an ambient sentence, which comes
//     and goes with world state like the lighting line: a Forecourt
//     captured from its portal-fire line against a sighting with the portal
//     dark has no headline of its own (synthetic — no corpus description
//     starts with one, 0 of 366,754 blocks — but the same rule as lighting).
{
  const COURT =
    'This is a cobblestone paved courtyard in front of the Luminarian church.  To the south side is an arch-like portal.  It is bright.';
  const pair = (store: TownMapStore, t: Town, desc: string) => {
    const court = store.addRoom(
      t,
      block('Forecourt', 'There are two exits: north and west.', desc),
      0,
      0,
      0,
      0
    );
    const lane = store.addRoom(
      t,
      block(
        'Temple Lane',
        'There is one obvious exit: east.',
        'A narrow lane leads up to the temple forecourt here.'
      ),
      -1,
      0,
      0,
      0
    );
    court.links.w = lane.id;
    lane.links.e = court.id;
    return court;
  };
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const target = pair(store, eris, COURT);
  const frag = store.createTown('Forecourt');
  const seen = pair(store, frag, 'A sheet of silvery-white fire fills the portal.  It is bright.');
  const result = store.mergeTowns(frag, seen.id, eris, target.id);
  check(
    result?.fused === 2,
    `tails: a capture opening on the portal fire still merges (${JSON.stringify(result)})`
  );
}

// 4. The matched pair itself is held to the same rule: two landings of
//    different floors are never the seed of a merge — even when no walked
//    link would ever lead back to them (the target landing has none yet).
{
  const store = new TownMapStore();
  const eris = store.createTown('Eris');
  const landing3 = store.addRoom(eris, B.landing3, 0, 0, 2, 0);
  const frag = store.createTown('Landing');
  const f4 = wing(store, frag, B.landing4, 0, 0, 0);
  check(
    store.mergeTowns(frag, f4[0].id, eris, landing3.id) === null,
    'seed: third vs fourth floor'
  );
  check(store.towns.has(frag.id) && eris.rooms.size === 1, 'seed: both towns untouched');
}

if (failed > 0) {
  console.error(`${failed} headline-guard assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: mirror floors never merge; tail captures do');
