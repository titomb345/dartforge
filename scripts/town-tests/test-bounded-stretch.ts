/**
 * Regression test: BOUNDED stretch-on-collision (Oct 2026 deep dive).
 *
 * A collision used to shift the whole half-plane beyond the cut — every
 * placed room on every floor and in every link component — so one local
 * collision opened a gap line through every street it crossed, and nothing
 * ever closed a gap again (frozen-corpus replay: the Soriktos stables'
 * "Byre" collision, session_2026-07-06T00-03-28-376.log:2933, moved 67
 * rooms on 3 floors and lengthened 14 links; bounded, 6 rooms on one floor
 * and 2 links). Now only the occupant's structure moves: the placed rooms
 * linked to it beyond the cut (cardinal, u/d and diagonal links, either
 * way), plus whatever that structure would land on.
 *
 *  A. Stairs and an UNLINKED stacked floor beyond the cut: the stair moves
 *     with its street and stays aligned; the loft above, reached by its
 *     own stairs on the near side, stays exactly where it is.
 *  B. A street on the SAME floor that crosses the cut without a link to
 *     the occupant stays put; a room standing where the moved structure
 *     lands is carried along (collision closure) — no shared cells.
 *  C. A one-way link INTO the structure (no reverse link) ties its room to
 *     the structure as firmly as an outgoing one.
 *  D. relayoutTown follows the same rule: a floor placed before the
 *     conflict and not linked to the occupant keeps its exact links.
 *  E. ... and a room the re-embedding has not placed yet (stale stored
 *     coordinates) never joins a stretch.
 *  F. The same on an UPPER floor (A-E all collide on the ground floor,
 *     where a stretch keyed to the wrong floor passes): a cardinal arrival
 *     on floor 1 moves the occupant's structure there with its stair down;
 *     unlinked rooms beyond the cut on that floor and on the floor below
 *     stay; a room the structure lands on, on that floor, is carried along.
 *  G. ... a DIAGONAL arrival on floor 1, along either component axis.
 *  H. ... and relayoutTown meeting its conflict on floor 1.
 *  I. A WESTWARD arrival (A-H stretch north or east), shaped like the
 *     corpus's Alcove landing on the Arena Armory: the occupant's n/s
 *     neighbour ON the cut line moves with it (going west, x == target.x is
 *     beyond the cut), and so does the destination of a one-way OUTGOING
 *     link (the Arena, "There are no obvious exits."); a street beyond the
 *     cut with no link to the occupant stays.
 *  J. A collision closure on ANOTHER floor than the arrival's (B, F closure
 *     and G closure all close on the arrival's floor): the occupant's stair
 *     carries its upper room onto an unrelated room up there, and the
 *     closure carries that room on with its own structure beyond the cut;
 *     the rest of that floor stays.
 */
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownDir, TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
};

const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are exits: ${exits}.`),
});

const at = (r: TownRoom) => `(${r.x},${r.y},${r.z})`;

/** Every room on its own cell, and the grid index agreeing with the rooms */
const checkGrid = (town: Town, label: string) => {
  const cells = new Set([...town.rooms.values()].map(at));
  check(cells.size === town.rooms.size, `${label}: two rooms share a grid cell`);
  check(town.grid.size === town.rooms.size, `${label}: grid has ${town.grid.size} entries`);
  for (const [key, id] of town.grid) {
    const r = town.rooms.get(id)!;
    check(key === `${r.x},${r.y},${r.z}`, `${label}: grid key ${key} -> room at ${at(r)}`);
  }
};

/** A link's destination sits exactly one cell away in its direction */
const VEC: Partial<Record<TownDir, [number, number, number]>> = {
  n: [0, -1, 0],
  s: [0, 1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
  u: [0, 0, 1],
  d: [0, 0, -1],
};
const exact = (town: Town, from: TownRoom, dir: TownDir) => {
  const to = town.rooms.get(from.links[dir]!);
  const v = VEC[dir]!;
  return !!to && to.x - from.x === v[0] && to.y - from.y === v[1] && to.z - from.z === v[2];
};

function walker() {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1000;
  const step = (cmd: string | null, b: TownRoomBlock) => {
    if (cmd) loc.trackCommand(cmd, (t += 1000));
    const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
    const room = map.room(res.pos)!;
    console.log(
      `  ${(cmd ?? 'enter').padEnd(5)} -> [${res.kind.padEnd(9)}] "${room.name}" ${at(room)}`
    );
    return room;
  };
  return { map, step };
}

// ---------------------------------------------------------------------------
// A + B share the street; each scenario walks its own store
// ---------------------------------------------------------------------------
const CENTER = block('Center Square', 'east and south', 'The center of a small town.');
const ROAD = block('Road', 'east and west', 'A cobblestone road running east to west.');
const SOUTH_ROAD = block('South Road', 'north, east, west, and up', 'The south road, a stair up.');
const LANE = block('Lane', 'north, east, and west', 'A narrow lane behind the shops.');
// Arriving north into the Road's cell: the Road lists no south exit, so it
// cannot be this room — a new room, and a collision to stretch away
const ALLEY = block('Alley', 'south', 'A dead-end alley between two walls.');

{
  console.log('A. stairs + an unlinked stacked floor beyond the cut');
  const { map, step } = walker();
  const TOWER = block('Tower Base', 'west and up', 'The foot of a watchtower stair.');
  const TOWER_TOP = block('Tower Top', 'down', 'The top of the watchtower.');
  const LOFT = block('Loft', 'north and down', 'A loft above the south road.');
  const LOFT_N = block('Loft North', 'south and east', 'The north end of the loft.');
  const LOFT_E = block('Loft East', 'west', 'A storeroom in the loft.');

  const center = step(null, CENTER);
  const road = step('e', ROAD);
  const tower = step('e', TOWER);
  const top = step('u', TOWER_TOP);
  step('d', TOWER);
  step('w', ROAD);
  step('w', CENTER);
  const southRoad = step('s', SOUTH_ROAD);
  // The loft floor sits right above the street (z=1, y=0) but its only way
  // down is the South Road's stair — on the NEAR side of the cut below
  const loft = step('u', LOFT);
  const loftN = step('n', LOFT_N);
  const loftE = step('e', LOFT_E);
  step('w', LOFT_N);
  step('s', LOFT);
  step('d', SOUTH_ROAD);
  const lane = step('e', LANE);
  const before = { loftN: at(loftN), loftE: at(loftE), lane: at(lane), loft: at(loft) };
  const alley = step('n', ALLEY);
  const town = map.get(map.pos!.townId)!;

  check(
    alley.x === lane.x && alley.y === lane.y - 1 && alley.z === 0,
    `alley ${at(alley)} is not exactly one cell north of the lane ${at(lane)}`
  );
  check(at(lane) === before.lane, `the from-room moved: ${before.lane} -> ${at(lane)}`);
  // The occupant's street moved north by one, straight and in order
  check(road.y === alley.y - 1 && road.x === alley.x, `road ${at(road)} not right above the alley`);
  check(
    center.y === road.y && tower.y === road.y && center.x + 1 === road.x && road.x + 1 === tower.x,
    `the street lost its shape: ${at(center)} ${at(road)} ${at(tower)}`
  );
  // ... and its stair went with it
  check(
    top.x === tower.x && top.y === tower.y && top.z === tower.z + 1 && exact(town, tower, 'u'),
    `the tower stair is misaligned: base ${at(tower)}, top ${at(top)}`
  );
  // The loft is NOT linked to the moved street: it stays put, its own
  // links stay exact (the half-plane shift dragged it north and stretched
  // the Loft -n-> Loft North link to two cells)
  check(at(loftN) === before.loftN, `loft north moved: ${before.loftN} -> ${at(loftN)}`);
  check(at(loftE) === before.loftE, `loft east moved: ${before.loftE} -> ${at(loftE)}`);
  check(at(loft) === before.loft, `the loft moved: ${before.loft} -> ${at(loft)}`);
  check(exact(town, loft, 'n') && exact(town, loftN, 'e'), 'the loft lost an exact link');
  // The one link crossing the cut inside the moved structure lengthens
  check(
    center.links.s === southRoad.id && southRoad.y - center.y === 2,
    `center -s-> south road should span two cells: ${at(center)} -> ${at(southRoad)}`
  );
  check(map.stretches === 1 && map.nudges === 0, `stretches=${map.stretches} nudges=${map.nudges}`);
  checkGrid(town, 'A');
}

{
  console.log('B. same-floor street across the cut; collision closure');
  const { map, step } = walker();
  const EAST_YARD = block('East Yard', 'north and west', 'A yard behind the lane.');
  const EAST_POST = block('East Post', 'south', 'A guard post at the end of the yard.');
  const WEST_LANE = block('West Lane', 'north and east', 'A lane west of the south road.');
  const WEST_PATH = block('West Path', 'north and south', 'A path along the west wall.');
  const WEST_END = block('West End', 'south and east', 'The west end of the wall walk.');
  const SHRINE = block('Shrine', 'west', 'A tiny roadside shrine.');

  const center = step(null, CENTER);
  const road = step('e', ROAD);
  step('w', CENTER);
  const southRoad = step('s', SOUTH_ROAD);
  // West loop: up past the Center's west side to a shrine standing exactly
  // where the Center will land — unlinked to the Center or the Road
  const westLane = step('w', WEST_LANE);
  const westPath = step('n', WEST_PATH);
  const westEnd = step('n', WEST_END);
  const shrine = step('e', SHRINE);
  step('w', WEST_END);
  step('s', WEST_PATH);
  step('s', WEST_LANE);
  step('e', SOUTH_ROAD);
  const lane = step('e', LANE);
  // East: a guard post at the Road's latitude (beyond the cut), reached only
  // from the yard south of it (the near side)
  const yard = step('e', EAST_YARD);
  const post = step('n', EAST_POST);
  step('s', EAST_YARD);
  step('w', LANE);
  const before = {
    lane: at(lane),
    yard: at(yard),
    post: at(post),
    westLane: at(westLane),
    southRoad: at(southRoad),
  };
  const alley = step('n', ALLEY);
  const town = map.get(map.pos!.townId)!;

  check(at(lane) === before.lane, `the from-room moved: ${before.lane} -> ${at(lane)}`);
  check(alley.x === lane.x && alley.y === lane.y - 1, `alley ${at(alley)} not north of the lane`);
  // Same floor, beyond the cut, no link to the occupant: stays, link exact
  check(at(post) === before.post, `east post moved: ${before.post} -> ${at(post)}`);
  check(at(yard) === before.yard && exact(town, yard, 'n'), 'the yard -n-> post link broke');
  check(at(southRoad) === before.southRoad && at(westLane) === before.westLane, 'near side moved');
  // Collision closure: the Center lands where the Shrine stood, so the
  // Shrine and its own street beyond the cut move too
  check(center.y === road.y && center.x + 1 === road.x, 'center and road no longer side by side');
  check(
    shrine.x === center.x && shrine.y === center.y - 1,
    `shrine ${at(shrine)} should sit right above the center ${at(center)}`
  );
  check(
    exact(town, westEnd, 'e') && exact(town, westPath, 'n'),
    'the shrine street lost an exact link'
  );
  check(
    westLane.links.n === westPath.id && westLane.y - westPath.y === 2,
    `west lane -n-> west path should span two cells: ${at(westLane)} -> ${at(westPath)}`
  );
  checkGrid(town, 'B');
}

{
  console.log('C. a one-way link INTO the structure ties its room to it');
  // One-way passages exist (the Dressing Room's ne into the Eye of the
  // Temple): the destination never lists the way back, so no reverse link
  // is inferred and only the INCOMING link connects the two
  const { map, step } = walker();
  const HALL = block('Temple Hall', 'east, south, and out', 'The hall of a small temple.');
  const WEST_LANE = block('West Lane', 'north and east', 'A lane west of the south road.');
  const WEST_PATH = block('West Path', 'north and south', 'A path along the temple wall.');
  const DRESSING = block(
    'Dressing Room',
    'south and southeast',
    'A dressing room behind the hall.'
  );

  const hall = step(null, HALL);
  const road = step('e', ROAD);
  step('w', HALL);
  step('s', SOUTH_ROAD);
  const westLane = step('w', WEST_LANE);
  const westPath = step('n', WEST_PATH);
  const dressing = step('n', DRESSING);
  step('se', HALL);
  check(dressing.links.se === hall.id && hall.links.nw === undefined, 'expected a one-way link');
  step('s', SOUTH_ROAD);
  const lane = step('e', LANE);
  const alley = step('n', ALLEY);
  const town = map.get(map.pos!.townId)!;

  check(alley.x === lane.x && alley.y === lane.y - 1, `alley ${at(alley)} not north of the lane`);
  check(road.y === alley.y - 1 && hall.y === road.y, 'the hall and road did not move up');
  // The dressing room hangs off the hall by its own diagonal: it moves with
  // it, so the one-way se stays a unit diagonal
  check(
    hall.x - dressing.x === 1 && hall.y - dressing.y === 1,
    `dressing room ${at(dressing)} is no longer nw of the hall ${at(hall)}`
  );
  check(exact(town, westPath, 'n'), 'the west path -n-> dressing room link broke');
  check(
    westLane.links.n === westPath.id && westLane.y - westPath.y === 2,
    `west lane -n-> west path should span two cells: ${at(westLane)} -> ${at(westPath)}`
  );
  checkGrid(town, 'C');
}

// ---------------------------------------------------------------------------
// D, E. relayoutTown: same rule while re-embedding a saved graph
// ---------------------------------------------------------------------------
/** A saved town (v2: loaded verbatim) from [id, name, links, stored x,y,z];
 *  room 0 is the entry, the root relayout grows from */
type Spec = [number, string, Partial<Record<TownDir, number>>, [number, number, number]];
const savedTown = (spec: Spec[]) => {
  const rooms = spec.map(([id, name, links, [x, y, z]]) => ({
    id,
    name,
    descFirst: `${name}.`,
    desc: `${name}.`,
    x,
    y,
    z,
    exits: Object.keys(links) as TownDir[],
    exitsEver: Object.keys(links) as TownDir[],
    doorDirs: [] as TownDir[],
    openDoorDirs: [] as TownDir[],
    namedExits: [] as string[],
    portal: false,
    icon: null,
    links,
    namedLinks: {},
    visits: 1,
    lastSeen: 1000,
    notes: '',
  }));
  const map = TownMapStore.deserialize({
    v: 2,
    nextTownId: 1,
    pos: null,
    towns: [
      { id: 0, name: 'Relayville', anchors: {}, nextRoomId: spec.length, entryRoomId: 0, rooms },
    ],
  });
  return { map, town: map.get(0)! };
};

{
  console.log('D. relayoutTown: an unlinked floor placed before the conflict');
  // BFS from Root in n,e,s,w,u,d order places the upper floor (Upper Hall,
  // Upper North) before South Three's n link hits East Two's cell; Upper
  // North sits on the cut line one floor up, linked only to the near side.
  //        x=0          x=1          x=2
  //  y=0   Root  -e-    East One -e- East Two ( +u Tower Room )
  //         |s                       (Nook: n of South Three, same cell)
  //  y=1   South One -e- South Two -e- South Three
  //         |u (z=1)
  //        Upper Hall -n-> Upper North -e-> Upper East   (z=1, y=1 / y=0)
  // Stored coordinates don't matter (relayout re-embeds); stored floors
  // must pass the load cleanse (lateral links keep z, stairs move one).
  const { map, town } = savedTown([
    [0, 'Root', { e: 1, s: 3 }, [0, 0, 0]],
    [1, 'East One', { w: 0, e: 2 }, [3, 0, 0]],
    [2, 'East Two', { w: 1, u: 10 }, [6, 0, 0]],
    [3, 'South One', { n: 0, e: 4, u: 7 }, [9, 0, 0]],
    [4, 'South Two', { w: 3, e: 5 }, [12, 0, 0]],
    [5, 'South Three', { w: 4, n: 6 }, [15, 0, 0]],
    [6, 'Nook', { s: 5 }, [18, 0, 0]],
    [7, 'Upper Hall', { d: 3, n: 8 }, [21, 0, 1]],
    [8, 'Upper North', { s: 7, e: 9 }, [24, 0, 1]],
    [9, 'Upper East', { w: 8 }, [27, 0, 1]],
    [10, 'Tower Room', { d: 2 }, [30, 0, 1]],
  ]);
  const r = (id: number) => town.rooms.get(id)!;
  map.relayoutTown(town);
  const first = [...town.rooms.values()].map((x) => `${x.id}:${at(x)}`).join(' ');
  console.log(`  ${first}`);

  // The conflict (Nook vs East Two) stretched the north street up a row
  check(at(r(6)) === '(2,0,0)', `the nook should take the vacated cell (2,0,0): ${at(r(6))}`);
  check(
    r(0).y === -1 && r(1).y === -1 && r(2).y === -1,
    `the north street did not move up as one piece: ${at(r(0))} ${at(r(1))} ${at(r(2))}`
  );
  check(exact(town, r(2), 'u'), `the tower stair is misaligned: ${at(r(2))} -> ${at(r(10))}`);
  // The upper floor sits beyond the cut but hangs off the near side's
  // stair: untouched, its links exact
  check(at(r(8)) === '(0,0,1)', `upper north moved: ${at(r(8))}`);
  check(
    exact(town, r(7), 'n') && exact(town, r(8), 'e') && exact(town, r(3), 'u'),
    'the upper floor lost an exact link'
  );
  checkGrid(town, 'D');
  map.relayoutTown(town);
  const second = [...town.rooms.values()].map((x) => `${x.id}:${at(x)}`).join(' ');
  check(first === second, `relayout is not idempotent:\n    ${first}\n    ${second}`);
}

{
  console.log('E. relayoutTown: a room not re-placed yet keeps out of the flood');
  // The conflict comes while the occupant (Corner House) is still queued:
  // its n link to the Attic has not been followed, so the Attic still holds
  // its STORED coordinates — beyond the cut, but meaningless in the new
  // layout. Shifting it would plant a stale grid entry beside the cell the
  // BFS gives it a moment later.
  //        x=0          x=1
  //  y=-1  North Lane -e- Corner House -n-> Attic
  //         |s            (Shed: n of East Lane, same cell)
  //  y=0   Square  -e-    East Lane
  const { map, town } = savedTown([
    [0, 'Square', { n: 1, e: 2 }, [0, 0, 0]],
    [1, 'North Lane', { s: 0, e: 3 }, [0, -1, 0]],
    [2, 'East Lane', { w: 0, n: 4 }, [1, 0, 0]],
    [3, 'Corner House', { w: 1, n: 5 }, [1, -1, 0]],
    [4, 'Shed', { s: 2 }, [3, -1, 0]],
    [5, 'Attic', { s: 3 }, [1, -4, 0]],
  ]);
  const r = (id: number) => town.rooms.get(id)!;
  map.relayoutTown(town);
  console.log(`  ${[...town.rooms.values()].map((x) => `${x.id}:${at(x)}`).join(' ')}`);
  check(at(r(4)) === '(1,-1,0)', `the shed should take the vacated cell (1,-1,0): ${at(r(4))}`);
  check(at(r(3)) === '(1,-2,0)' && at(r(1)) === '(0,-2,0)', 'the north lane did not move up');
  check(exact(town, r(3), 'n'), `the attic is not right above the corner house: ${at(r(5))}`);
  checkGrid(town, 'E');
}

// ---------------------------------------------------------------------------
// F, G. Collisions on an UPPER floor, walked through the real localizer
// ---------------------------------------------------------------------------
// The occupant, the cell to vacate and every landing cell are looked up on
// the arrival's floor. On the ground floor a lookup forced to floor 0 is
// right by accident, so A-E cannot tell, and neither could the corpus
// numbers: with addRoom passing floor 0, the frozen-corpus replay printed
// the same localization and layout numbers (one stretch of 39 fewer) while
// its end state held two rooms in one cell (Massive Ruin Gates: the
// curtained Alcove, w from the Sanctum on floor -1, written over the Arena
// Armory; session_2026-07-13T03-35-32-238.log:8215). The gate's layout
// line now counts shared cells and grid errors.
//
//   floor 0                          floor 1
//         x=0     x=1     x=2              x=0         x=1        x=2
//   y=-1                             y=-1              (Turret  - Roof Walk)
//   y=0   Hall    Store   Porch      y=0   Landing  -  Gallery    Balcony
//   y=1   Yard  - Shed  - Smithy     y=1   Corridor -  Nook    -  Bay
//
// Stairs: Hall -u-> Landing, Balcony -d-> Porch. The Store hangs off the
// Shed and the Balcony off the Bay: neither is linked to the Gallery. The
// closure variants also walk Balcony -n-> Roof Walk -w-> Turret, and the
// Turret stands exactly where the Gallery lands.
const U_HALL = block('Hall', 'south and up', 'A hall with a stair going up.');
const U_YARD = block('Yard', 'north and east', 'A yard south of the hall.');
const U_SHED = block('Shed', 'north, east, and west', 'A shed in the yard.');
const U_STORE = block('Store', 'south', 'A store room behind the shed.');
const U_SMITHY = block('Smithy', 'west', 'A small smithy past the shed.');
const U_LANDING = block('Landing', 'east, south, and down', 'An upper landing.');
const U_GALLERY = block('Gallery', 'west', 'A long gallery over the store.');
const U_CORRIDOR = block('Corridor', 'north, east, and northeast', 'An upper corridor.');
const U_NOOK = block('Nook', 'north, northeast, east, and west', 'A reading nook.');
const U_BAY = block('Bay', 'north and west', 'A window bay.');
const U_BALCONY = block('Balcony', 'north, south, and down', 'A balcony with steps down.');
const U_PORCH = block('Porch', 'up', 'A porch under the balcony.');
const U_ROOF = block('Roof Walk', 'south and west', 'A walk along the roof.');
const U_TURRET = block('Turret', 'east', 'A little turret.');
// The arrivals: neither can be the room in its cell (other names, other
// exits), so each is a new room whose natural cell is taken
const U_ALCOVE = block('Alcove', 'south', 'A small alcove.');
const U_ORIEL = block('Oriel', 'southwest', 'A bright oriel window.');

/** Walk the two floors, then arrive: Nook -n-> (the Gallery's cell),
 *  Corridor -ne-> (the Gallery's cell) or Nook -ne-> (the Balcony's) */
function upperFloors(arrival: 'nook-n' | 'corridor-ne' | 'nook-ne', turret: boolean) {
  const { map, step } = walker();
  const hall = step(null, U_HALL);
  step('s', U_YARD);
  const shed = step('e', U_SHED);
  const store = step('n', U_STORE);
  step('s', U_SHED);
  const smithy = step('e', U_SMITHY);
  step('w', U_SHED);
  step('w', U_YARD);
  step('n', U_HALL);
  const landing = step('u', U_LANDING);
  const gallery = step('e', U_GALLERY);
  step('w', U_LANDING);
  const corridor = step('s', U_CORRIDOR);
  const nook = step('e', U_NOOK);
  const bay = step('e', U_BAY);
  const balcony = step('n', U_BALCONY);
  const porch = step('d', U_PORCH);
  step('u', U_BALCONY);
  let roof: TownRoom | undefined;
  let turretRoom: TownRoom | undefined;
  if (turret) {
    roof = step('n', U_ROOF);
    turretRoom = step('w', U_TURRET);
    step('e', U_ROOF);
    step('s', U_BALCONY);
  }
  step('s', U_BAY);
  step('w', U_NOOK);
  if (arrival === 'corridor-ne') step('w', U_CORRIDOR);
  const placed = [hall, shed, store, smithy, landing, gallery, corridor, nook, bay, balcony, porch];
  if (roof && turretRoom) placed.push(roof, turretRoom);
  const before = new Map(placed.map((r) => [r, { x: r.x, y: r.y, z: r.z }]));
  const arrived = arrival === 'nook-n' ? step('n', U_ALCOVE) : step('ne', U_ORIEL);
  /** Where a room is now relative to where it stood before the arrival */
  const movedBy = (r: TownRoom, dx: number, dy: number) => {
    const b = before.get(r)!;
    return r.x === b.x + dx && r.y === b.y + dy && r.z === b.z;
  };
  const town = map.get(map.pos!.townId)!;
  check(
    map.stretches === 1 && map.nudges === 0,
    `${arrival}${turret ? ' + turret' : ''}: stretches=${map.stretches} nudges=${map.nudges}`
  );
  const rooms = { hall, shed, store, smithy, landing, gallery, corridor, nook, bay, balcony };
  return { town, arrived, movedBy, porch, roof, turretRoom, ...rooms };
}

// F: Nook -n-> lands on the Gallery's cell. G: Corridor -ne-> lands on the
// same cell; the Gallery runs e/w (its Landing), so the diagonal stretches
// its north component and the same structure moves the same way. Each runs
// without the Turret (unlinked rooms beyond the cut) and with it (closure).
for (const arrival of ['nook-n', 'corridor-ne'] as const) {
  for (const turret of [false, true]) {
    const cardinal = arrival === 'nook-n';
    const label = `${cardinal ? 'F' : 'G'}${turret ? ' closure' : ''}`;
    const how = cardinal ? 'cardinal arrival' : 'diagonal arrival into an e/w run';
    console.log(`${label}. upper floor, ${how}`);
    const u = upperFloors(arrival, turret);
    const { town, arrived, movedBy, hall, landing, gallery, store, shed, bay, balcony } = u;
    const from = cardinal ? u.nook : u.corridor;
    check(
      at(arrived) === `(${from.x + (cardinal ? 0 : 1)},${from.y - 1},1)`,
      `${label}: the new room ${at(arrived)} is not exactly ${cardinal ? 'n' : 'ne'} of ${at(from)}`
    );
    check(movedBy(from, 0, 0), `${label}: the from-room moved to ${at(from)}`);
    // The occupant's structure on floor 1 moved north as one piece, and its
    // stair took the hall below along: still aligned
    check(
      movedBy(gallery, 0, -1) && movedBy(landing, 0, -1) && exact(town, landing, 'e'),
      `${label}: the gallery ${at(gallery)} and landing ${at(landing)} did not move north as one`
    );
    check(
      movedBy(hall, 0, -1) && exact(town, hall, 'u'),
      `${label}: the stair broke: hall ${at(hall)}, landing ${at(landing)}`
    );
    // The floor below: the store sits beyond the cut, linked only to the
    // shed on the near side — it stays, its link exact
    check(
      movedBy(store, 0, 0) && exact(town, shed, 'n'),
      `${label}: the store moved to ${at(store)}`
    );
    if (!turret) {
      // The same floor: the balcony sits beyond the cut, linked only to the
      // bay (near side) and its own porch below — both stay
      check(
        movedBy(balcony, 0, 0) && exact(town, bay, 'n'),
        `${label}: the balcony moved to ${at(balcony)}`
      );
      check(
        movedBy(u.porch, 0, 0) && exact(town, balcony, 'd'),
        `${label}: the porch moved to ${at(u.porch)}`
      );
    } else {
      // Collision closure on floor 1: the gallery lands where the turret
      // stood, so the turret and its own street (roof walk, balcony, and
      // the balcony's stair down to the porch) move north with it
      const roof = u.roof!;
      const turretRoom = u.turretRoom!;
      check(
        turretRoom.x === gallery.x && turretRoom.y === gallery.y - 1 && turretRoom.z === 1,
        `${label}: the turret ${at(turretRoom)} is not right above the gallery ${at(gallery)}`
      );
      check(
        movedBy(roof, 0, -1) && movedBy(balcony, 0, -1) && movedBy(u.porch, 0, -1),
        `${label}: the turret's street did not move along: ${at(roof)} ${at(balcony)}`
      );
      check(
        exact(town, turretRoom, 'e') && exact(town, roof, 's') && exact(town, balcony, 'd'),
        `${label}: the turret street lost an exact link`
      );
    }
    checkGrid(town, label);
  }
}

{
  console.log('G east. upper floor, diagonal arrival into a n/s run (stretch east)');
  // The balcony runs n/s (its bay), so the stretch takes the ne's east
  // component: the balcony, its bay and the porch under it move east; the
  // smithy below sits beyond that cut too, linked only to the shed
  const u = upperFloors('nook-ne', false);
  const { town, arrived, movedBy, nook, bay, balcony, smithy, shed, gallery, store } = u;
  check(
    at(arrived) === `(${nook.x + 1},${nook.y - 1},1)`,
    `G east: the oriel ${at(arrived)} is not exactly ne of the nook ${at(nook)}`
  );
  check(movedBy(nook, 0, 0), `G east: the from-room moved to ${at(nook)}`);
  check(
    movedBy(balcony, 1, 0) && movedBy(bay, 1, 0) && exact(town, bay, 'n'),
    `G east: the balcony ${at(balcony)} and bay ${at(bay)} did not move east as one`
  );
  check(
    movedBy(u.porch, 1, 0) && exact(town, balcony, 'd'),
    `G east: the balcony's stair broke: ${at(balcony)} -> ${at(u.porch)}`
  );
  check(
    movedBy(smithy, 0, 0) && exact(town, shed, 'e'),
    `G east: the smithy moved to ${at(smithy)}`
  );
  check(movedBy(gallery, 0, 0) && movedBy(store, 0, 0), 'G east: the west side moved');
  checkGrid(town, 'G east');
}

{
  console.log('H. relayoutTown: a conflict on floor 1');
  // BFS from Root places both floors' near sides, the cellar (floor 0) and
  // the upper alcove (floor 1) before Upper Corner's n link hits Upper
  // Far's cell; both sit beyond that cut, linked only to the near side.
  //   floor 0                      floor 1
  //        x=0     x=1                  x=-1           x=0           x=1          x=2
  //  y=0   Root    Cellar         y=0   Upper Alcove   Upper Root -  Upper East - Upper Far
  //  y=1   South - South East     y=1   Upper West  -  Upper South - Upper Mid -  Upper Corner
  // Root -u-> Upper Root; Upper Corner -n-> Upper Nook (Upper Far's cell)
  const { map, town } = savedTown([
    [0, 'Root', { s: 1, u: 3 }, [0, 0, 0]],
    [1, 'South', { n: 0, e: 2 }, [3, 0, 0]],
    [2, 'South East', { w: 1, n: 9 }, [6, 0, 0]],
    [3, 'Upper Root', { d: 0, e: 4, s: 6 }, [9, 0, 1]],
    [4, 'Upper East', { w: 3, e: 5 }, [12, 0, 1]],
    [5, 'Upper Far', { w: 4 }, [15, 0, 1]],
    [6, 'Upper South', { n: 3, e: 7, w: 11 }, [18, 0, 1]],
    [7, 'Upper Mid', { w: 6, e: 8 }, [21, 0, 1]],
    [8, 'Upper Corner', { w: 7, n: 10 }, [24, 0, 1]],
    [9, 'Cellar', { s: 2 }, [27, 0, 0]],
    [10, 'Upper Nook', { s: 8 }, [30, 0, 1]],
    [11, 'Upper West', { e: 6, n: 12 }, [33, 0, 1]],
    [12, 'Upper Alcove', { s: 11 }, [36, 0, 1]],
  ]);
  const r = (id: number) => town.rooms.get(id)!;
  map.relayoutTown(town);
  const first = [...town.rooms.values()].map((x) => `${x.id}:${at(x)}`).join(' ');
  console.log(`  ${first}`);
  check(at(r(10)) === '(2,0,1)', `H: the nook should take the vacated cell (2,0,1): ${at(r(10))}`);
  check(
    at(r(3)) === '(0,-1,1)' && at(r(4)) === '(1,-1,1)' && at(r(5)) === '(2,-1,1)',
    `H: the upper north street did not move up as one: ${at(r(3))} ${at(r(4))} ${at(r(5))}`
  );
  check(exact(town, r(0), 'u'), `H: the stair is misaligned: ${at(r(0))} -> ${at(r(3))}`);
  check(
    at(r(9)) === '(1,0,0)' && exact(town, r(2), 'n'),
    `H: the cellar (floor 0) moved: ${at(r(9))}`
  );
  check(
    at(r(12)) === '(-1,0,1)' && exact(town, r(11), 'n'),
    `H: the upper alcove (floor 1) moved: ${at(r(12))}`
  );
  checkGrid(town, 'H');
  map.relayoutTown(town);
  const second = [...town.rooms.values()].map((x) => `${x.id}:${at(x)}`).join(' ');
  check(first === second, `H: relayout is not idempotent:\n    ${first}\n    ${second}`);
}

// ---------------------------------------------------------------------------
// I. A WESTWARD stretch (A-H all stretch north or east)
// ---------------------------------------------------------------------------
{
  console.log('I. westward arrival: a cut-line neighbour and a one-way exit move along');
  // A frozen-corpus westward stretch (session_2026-07-13T03-35-32-238.log:
  // 8215): the curtained Alcove, w from the Sanctum, lands on the Arena
  // Armory, whose exit north leads into the Arena. The Arena prints "There
  // are no obvious exits." (the arena returns the player elsewhere), so that
  // link is ONE-WAY and only the Armory's OUTGOING link ties the Arena on (C
  // covers an incoming one). And going west the cut test is x <= target.x:
  // a room ON the cut line, like the Armory's n/s neighbours, is beyond it.
  // Neither rule had a test, and breaking either one left the suite green
  // while the live-faithful corpus replay's end state changed (cardinal
  // links exact/long/off-axis 823/83/8): adjacency from incoming links only
  // left the Arena behind, Armory -n-> Arena off-axis (822/83/9); a strict
  // x < target.x cut left every cut-line neighbour behind (812/79/20).
  //        x=-2      x=-1           x=0
  //  y=-1            Arena
  //  y=0             Arena Armory   Sanctum
  //  y=1             Rack Room   -  Dressing Room
  //  y=2   Shrine -  Cloister    -  Chapel
  // The Alcove arrives w of the Sanctum, on the Armory's cell. The Armory is
  // reached from the Rack Room, so the Sanctum's w is still unwalked then.
  // The arena sends the player back to the Dressing Room (no command: the
  // localizer relocalizes onto it). The Cloister street sits beyond the
  // cut, linked only to the near side.
  const { map, step } = walker();
  const SANCTUM = block('Sanctum', 'south and west', 'The inner sanctum of the temple.');
  const DRESSING = block('Dressing Room', 'north, south, and west', 'A dressing room.');
  const CHAPEL = block('Chapel', 'north and west', 'A side chapel.');
  const CLOISTER = block('Cloister', 'east and west', 'A cloister walk along the wall.');
  const SHRINE = block('Shrine', 'east', 'A tiny shrine at the end of the cloister.');
  const RACK = block('Rack Room', 'north and east', 'A room lined with empty weapon racks.');
  const ARMORY = block('Arena Armory', 'north and south', 'A small, square stone chamber.');
  const ARENA: TownRoomBlock = {
    name: 'Arena',
    descFirst: 'A large circular area with high stone walls.',
    desc: 'A large circular area with high stone walls.',
    exits: parseTownExits('There are no obvious exits.'),
  };
  const ALCOVE = block('Alcove', 'east', 'A small, curtained alcove off of the Sanctum.');

  const sanctum = step(null, SANCTUM);
  const dressing = step('s', DRESSING);
  const chapel = step('s', CHAPEL);
  const cloister = step('w', CLOISTER);
  const shrine = step('w', SHRINE);
  step('e', CLOISTER);
  step('e', CHAPEL);
  step('n', DRESSING);
  const rack = step('w', RACK);
  const armory = step('n', ARMORY);
  const arena = step('n', ARENA);
  step(null, DRESSING);
  step('n', SANCTUM);
  const town = map.get(map.pos!.townId)!;
  // The scenario builds what it claims: the Arena hangs off the Armory by
  // a one-way link, the Rack Room sits on the cut line, the Cloister street
  // beyond it, and nothing links the Sanctum to the Armory yet
  check(
    armory.links.n === arena.id && Object.keys(arena.links).length === 0,
    'I: expected a one-way Armory -n-> Arena link'
  );
  check(
    rack.x === armory.x && cloister.x === armory.x && shrine.x < armory.x,
    `I: the layout is not as drawn: ${at(rack)} ${at(armory)} ${at(cloister)} ${at(shrine)}`
  );
  check(sanctum.links.w === undefined, 'I: the Sanctum -w-> link exists before the arrival');
  const placed = [sanctum, dressing, chapel, cloister, shrine, rack, armory, arena];
  const before = new Map(placed.map((r) => [r, { x: r.x, y: r.y, z: r.z }]));
  /** Where a room is now relative to where it stood before the arrival */
  const movedBy = (r: TownRoom, dx: number) => {
    const b = before.get(r)!;
    return r.x === b.x + dx && r.y === b.y && r.z === b.z;
  };
  const alcove = step('w', ALCOVE);

  check(
    at(alcove) === `(${sanctum.x - 1},${sanctum.y},0)` && exact(town, sanctum, 'w'),
    `I: the alcove ${at(alcove)} is not exactly w of the sanctum ${at(sanctum)}`
  );
  check(movedBy(sanctum, 0), `I: the from-room moved to ${at(sanctum)}`);
  check(movedBy(armory, -1), `I: the armory ${at(armory)} did not move one cell west`);
  // (i) The cut-line neighbour moves with the occupant: the n/s link stays
  // exact, and only the link that crosses the cut (back east to the
  // Dressing Room) spans two cells
  check(
    movedBy(rack, -1) && exact(town, armory, 's') && exact(town, rack, 'n'),
    `I: the rack room on the cut line was left behind: ${at(rack)}, armory ${at(armory)}`
  );
  check(
    dressing.links.w === rack.id && dressing.x - rack.x === 2,
    `I: dressing room -w-> rack room should span two cells: ${at(dressing)} -> ${at(rack)}`
  );
  // (ii) The one-way destination moves with the room whose exit leads to it
  check(
    movedBy(arena, -1) && exact(town, armory, 'n'),
    `I: the one-way arena was left behind: ${at(arena)}, armory ${at(armory)}`
  );
  // (iii) Beyond the cut but not linked to the occupant: the Cloister street
  // stays, its links exact (the half-plane shift moved it west and
  // stretched Chapel -w-> Cloister to two cells)
  check(
    movedBy(cloister, 0) && movedBy(shrine, 0),
    `I: the cloister street moved: ${at(cloister)} ${at(shrine)}`
  );
  check(
    exact(town, chapel, 'w') && exact(town, cloister, 'w') && exact(town, shrine, 'e'),
    'I: the cloister street lost an exact link'
  );
  check(movedBy(dressing, 0) && movedBy(chapel, 0), 'I: the near side moved');
  check(
    map.stretches === 1 && map.nudges === 0,
    `I: stretches=${map.stretches} nudges=${map.nudges}`
  );
  checkGrid(town, 'I');
}

// ---------------------------------------------------------------------------
// J. A collision closure on ANOTHER floor than the arrival's
// ---------------------------------------------------------------------------
{
  console.log('J. cross-floor closure: a stair carries its room onto an unrelated one upstairs');
  // The bounded rule can land a moved room on a room that stays, on any
  // floor the structure reaches by its stairs (the half-plane shift moved
  // every floor at once, so it never could): the closure must look up each
  // landing cell on the moving room's OWN floor. Keyed to the arrival's
  // floor, or closing only on that floor, the Loft is written over the
  // Attic: two rooms in one cell. The frozen corpus never depends on it:
  // its 13 cross-floor landings (in 7 of the live-faithful replay's 39
  // stretches) all fall on rooms the stretch moves anyway, by their links,
  // so both of those breakages replay it byte-identically in all five
  // modes. Only this scenario pins the rule.
  //   floor 0                       floor 1
  //        x=0    x=1                     x=0     x=1        x=2
  //  y=-1                          y=-1   Attic - Garret
  //  y=0   Hall - East Room        y=0    Loft    Landing    Dormer
  //  y=1   Gate - Yard             y=1            Stairtop - Gallery
  // Stairs: Hall -u-> Loft, and the outside stairs Yard -u-> Stairtop. The
  // Alcove arrives n of the Gate (unwalked until then) on the Hall's cell.
  // Nothing links the Loft to the Attic, whose street climbs from the near
  // side; the Dormer, beyond the cut on floor 1 too, hangs off the Gallery.
  const { map, step } = walker();
  const HALL = block('Hall', 'east and up', 'A great hall.');
  const LOFT = block('Loft', 'down', 'A loft over the hall.');
  const EAST_ROOM = block('East Room', 'south and west', 'A room east of the hall.');
  const YARD = block('Yard', 'north, west, and up', 'A yard with outside stairs.');
  const GATE = block('Gate', 'north and east', 'A gate into the yard.');
  const STAIRTOP = block('Stairtop', 'north, east, and down', 'The top of the outside stairs.');
  const GALLERY = block('Gallery', 'north and west', 'A gallery above the yard.');
  const DORMER = block('Dormer', 'south', 'A dormer room under the eaves.');
  const LANDING = block('Landing', 'north and south', 'An upper landing.');
  const GARRET = block('Garret', 'south and west', 'A garret under the roof.');
  const ATTIC = block('Attic', 'east', 'A dusty attic.');
  const ALCOVE = block('Alcove', 'south', 'A small alcove.');

  const hall = step(null, HALL);
  const loft = step('u', LOFT);
  step('d', HALL);
  const eastRoom = step('e', EAST_ROOM);
  const yard = step('s', YARD);
  const gate = step('w', GATE);
  step('e', YARD);
  const stairtop = step('u', STAIRTOP);
  const gallery = step('e', GALLERY);
  const dormer = step('n', DORMER);
  step('s', GALLERY);
  step('w', STAIRTOP);
  const landing = step('n', LANDING);
  const garret = step('n', GARRET);
  const attic = step('w', ATTIC);
  step('e', GARRET);
  step('s', LANDING);
  step('s', STAIRTOP);
  step('d', YARD);
  step('w', GATE);
  const town = map.get(map.pos!.townId)!;
  // The scenario builds what it claims: the Attic stands on the cell the
  // Loft moves to, with no link between them, and the Dormer sits beyond
  // the cut on the same floor
  check(
    loft.z === 1 && attic.x === loft.x && attic.y === loft.y - 1 && attic.z === 1,
    `J: the attic ${at(attic)} does not stand where the loft ${at(loft)} will land`
  );
  check(
    Object.keys(loft.links).join() === 'd' && Object.keys(attic.links).join() === 'e',
    'J: the loft and the attic should each have only their own link'
  );
  check(
    dormer.y === hall.y && dormer.z === 1 && exact(town, gallery, 'n'),
    `J: the dormer ${at(dormer)} is not beyond the cut on floor 1`
  );
  check(gate.links.n === undefined, 'J: the Gate -n-> link exists before the arrival');
  const floor0 = [hall, eastRoom, gate, yard];
  const floor1 = [loft, attic, garret, landing, stairtop, gallery, dormer];
  const before = new Map([...floor0, ...floor1].map((r) => [r, { x: r.x, y: r.y, z: r.z }]));
  /** Where a room is now relative to where it stood before the arrival */
  const movedBy = (r: TownRoom, dy: number) => {
    const b = before.get(r)!;
    return r.x === b.x && r.y === b.y + dy && r.z === b.z;
  };
  const alcove = step('n', ALCOVE);

  check(
    at(alcove) === `(${gate.x},${gate.y - 1},0)` && exact(town, gate, 'n'),
    `J: the alcove ${at(alcove)} is not exactly n of the gate ${at(gate)}`
  );
  check(movedBy(gate, 0), `J: the from-room moved to ${at(gate)}`);
  // The occupant's structure moves north: the Hall, its East Room and, up
  // the stair, the Loft, which stays aligned
  check(
    movedBy(hall, -1) && movedBy(eastRoom, -1) && exact(town, hall, 'e'),
    `J: the hall ${at(hall)} and east room ${at(eastRoom)} did not move north as one`
  );
  check(
    movedBy(loft, -1) && exact(town, hall, 'u'),
    `J: the stair broke: hall ${at(hall)}, loft ${at(loft)}`
  );
  // Collision closure on floor 1: the Loft lands where the Attic stood, so
  // the Attic moves on north, and with it its street beyond the cut (the
  // Garret and the Landing; the Stairtop is before the cut and stays)
  check(
    attic.x === loft.x && attic.y === loft.y - 1 && attic.z === 1,
    `J: the attic ${at(attic)} was not carried on north of the loft ${at(loft)}`
  );
  check(
    movedBy(attic, -1) && movedBy(garret, -1) && movedBy(landing, -1),
    `J: the attic street did not move along: ${at(attic)} ${at(garret)} ${at(landing)}`
  );
  check(
    exact(town, attic, 'e') && exact(town, garret, 'w') && exact(town, garret, 's'),
    'J: the attic street lost an exact link'
  );
  // Only the links that cross the cut span two cells, one on each floor
  check(
    eastRoom.links.s === yard.id && yard.y - eastRoom.y === 2,
    `J: east room -s-> yard should span two cells: ${at(eastRoom)} -> ${at(yard)}`
  );
  check(
    landing.links.s === stairtop.id && stairtop.y - landing.y === 2,
    `J: landing -s-> stairtop should span two cells: ${at(landing)} -> ${at(stairtop)}`
  );
  // The rest of floor 1 stays: the Dormer is beyond the cut, but linked only
  // to the near side and not landed on (the half-plane shift moved it north
  // and stretched Gallery -n-> Dormer to two cells)
  check(
    movedBy(dormer, 0) && movedBy(gallery, 0) && movedBy(stairtop, 0),
    `J: the dormer side moved: ${at(dormer)} ${at(gallery)} ${at(stairtop)}`
  );
  check(
    exact(town, gallery, 'n') && exact(town, stairtop, 'e') && exact(town, yard, 'u'),
    'J: the dormer side lost an exact link'
  );
  check(movedBy(yard, 0), 'J: the near side moved');
  check(
    map.stretches === 1 && map.nudges === 0,
    `J: stretches=${map.stretches} nudges=${map.nudges}`
  );
  checkGrid(town, 'J');
}

if (failures > 0) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  '\nPASS — a stretch moves only the occupant structure, on any floor; unlinked floors and ' +
    'streets stay'
);
