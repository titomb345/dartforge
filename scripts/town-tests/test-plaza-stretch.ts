/**
 * Regression test: a stretch THROUGH the Eris market plaza (Oct 2026 deep
 * dive, bounded stretch).
 *
 * The plaza is a 3x3 of rooms all named "Market" (exit sets from the
 * corpus replay; the three [e,n,s,w] sides are full-fingerprint twins told
 * apart only by mid-description prose). Two shops claim one cell west of
 * its south row: the SW corner's "w" leads into Wuffa's Specialty Barding,
 * while Eris Road's "s" (Eris Road is west of the plaza's west side) leads
 * into Borbor and Mujigha's Good Armor Fix — the replay's first plaza
 * stretch (session_2026-07-04T19-22-03-979.log:25025) splits the plaza
 * between its middle and south rows under either stretch rule: the cut
 * runs through the plaza, and the south row hangs off Wuffa's.
 *
 * The localizer's twin handling is coordinate-sensitive (near-reuse within
 * a radius, closest-pick among twins), and a stretch changes coordinates.
 * This locks down:
 *  - the stretch moves the occupant's structure only: Wuffa's and the
 *    south row of the plaza. A street east of the plaza that crosses the
 *    same cut line without a link to that structure (Wharf Street's lane
 *    down to the Ferry Landing) stays where it is, its links exact — the
 *    old half-plane shift dragged it along and stretched its links;
 *  - links that do not cross the cut stay exact (the whole south row);
 *  - after the stretch, first-time moves ACROSS the cut — cardinal and
 *    diagonal, into displaced rooms whose hint cells are now empty — still
 *    find the right Market twin: no duplicate, every move "expected";
 *  - a hidden hop onto a displaced twin is identified by its description.
 */
import { TownMapStore, type TownRoom } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import type { TownDir, TownRoomBlock } from '../../src/lib/townParser';
import { parseTownExits } from '../../src/lib/townParser';

const map = new TownMapStore();
const loc = new TownLocalizer(map);

const block = (name: string, exitsSentence: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc.split('  ')[0],
  desc,
  exits: parseTownExits(`There are exits: ${exitsSentence}.`),
});

const PLAZA = 'This is a spacious market square in the heart of Eris.';
const mk = (exits: string, prose: string, lighting = 'It is bright.') =>
  block('Market', exits, `${PLAZA}  ${prose}  ${lighting}`);

const NW = mk('north, east, south, west, northwest, and southeast', 'The bank is to the west.');
const N_EDGE = mk('north, east, south, and west', 'Ash Street leads north from here.');
const NE = mk('north, east, south, west, and southwest', 'A pottery opens to the east.');
const W_SIDE = mk('north, east, south, and west', 'Eris Road leaves the market to the west.');
const CENTER = mk(
  'north, northeast, east, southeast, south, southwest, west, and northwest',
  'A well stands in the middle of the square.'
);
const E_SIDE = mk('north, east, south, and west', 'Wharf Street leads east toward the docks.');
const SW = mk('north, east, south, west, and northeast', 'A barding shop opens to the west.');
const S_EDGE = mk('north, east, and west', 'Stalls line the southern edge of the square.');
const SE = mk('north, east, west, northwest, and southeast', 'The church forecourt is east.');

const ERIS_ROAD = block(
  'Eris Road',
  'east, south, and west',
  'This is a cobblestone-paved road leading into the market square of a burgeoning town.'
);
const WUFFA = block(
  "Wuffa's Specialty Barding",
  'east',
  'A small shop apparently dealing in highly specialized barding.'
);
const BORBOR = block(
  "Borbor and Mujigha's Good Armor Fix",
  'north and west',
  'This is a workshop for shaping metal and leather into protective armor.'
);
const WHARF = block('Wharf Street', 'south and west', 'A street running down to the wharves.');
const FERRY_LANE = block('Ferry Lane', 'north and south', 'A lane sloping down to the river.');
const FERRY = block('Ferry Landing', 'north', 'A landing at the river ferry.');

let t = 1000;
let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
};
const at = (r: TownRoom) => `(${r.x},${r.y},${r.z})`;
const step = (cmd: string | null, b: TownRoomBlock, expectKind?: string) => {
  if (cmd) loc.trackCommand(cmd, (t += 1000));
  const res = loc.onRoomBlock(b, '0:0,0', (t += 1000));
  const room = map.room(res.pos)!;
  console.log(
    `${(cmd ?? '-').padEnd(5)} -> [${res.kind.padEnd(11)}] #${room.id} "${room.name}" ${at(room)}`
  );
  if (expectKind && res.kind !== expectKind) {
    console.error(`  FAIL: expected [${expectKind}]`);
    failures++;
  }
  return room;
};

// --- Map the plaza. Of the links that will cross the cut (middle row to
// south row) only the SW corner's diagonal to the center gets walked ---
const road = step(null, ERIS_ROAD);
const wSide = step('e', W_SIDE, 'new-room');
step('n', NW, 'new-room');
step('e', N_EDGE, 'new-room');
step('e', NE, 'new-room');
const eSide = step('s', E_SIDE, 'new-room');
const wharf = step('e', WHARF, 'new-room');
const ferryLane = step('s', FERRY_LANE, 'new-room');
const ferry = step('s', FERRY, 'new-room');
step('n', FERRY_LANE, 'expected');
step('n', WHARF, 'expected');
step('w', E_SIDE, 'expected');
const center = step('w', CENTER, 'new-room');
const sw = step('sw', SW, 'new-room');
const sEdge = step('e', S_EDGE, 'new-room');
const se = step('e', SE, 'new-room');
step('w', S_EDGE, 'expected');
step('w', SW, 'expected');
const wuffa = step('w', WUFFA, 'new-room');
step('e', SW, 'expected');
step('ne', CENTER, 'expected');
step('w', W_SIDE, 'expected');
step('w', ERIS_ROAD, 'expected');

const town = map.get(map.pos!.townId)!;
const before = new Map([...town.rooms.values()].map((r) => [r.id, at(r)]));
const stretchesBefore = map.stretches;

// --- The collision: Eris Road's s targets Wuffa's cell. Wuffa's lists no
// north exit, so the armor workshop is a new room; the map stretches south
// through the plaza (the cut between its middle and south rows) ---
const borbor = step('s', BORBOR, 'new-room');
check(map.stretches === stretchesBefore + 1, 'the collision did not stretch the map');
check(at(road) === before.get(road.id), `the from-room moved: ${at(road)}`);
check(
  borbor.x === road.x && borbor.y === road.y + 1,
  `Borbor's ${at(borbor)} is not exactly south of Eris Road ${at(road)}`
);
const moved = [...town.rooms.values()].filter((r) => before.get(r.id) !== at(r) && r !== borbor);
const movedIds = new Set(moved.map((r) => r.id));
const expectMoved = [wuffa, sw, sEdge, se];
check(
  movedIds.size === expectMoved.length && expectMoved.every((r) => movedIds.has(r.id)),
  `moved ${moved.map((r) => `#${r.id} ${r.name}`).join(', ')}; expected Wuffa's and the south row`
);
for (const r of moved) {
  const [x, y, z] = before.get(r.id)!.slice(1, -1).split(',').map(Number);
  check(r.x === x && r.y === y + 1 && r.z === z, `#${r.id} moved ${before.get(r.id)} -> ${at(r)}`);
}
// The Ferry Lane crosses the same cut line but hangs off Wharf Street (the
// near side): it stays, and its street keeps its exact links
check(at(ferryLane) === before.get(ferryLane.id), `Ferry Lane moved: ${at(ferryLane)}`);
check(at(ferry) === before.get(ferry.id), `Ferry Landing moved: ${at(ferry)}`);
check(
  ferryLane.y === wharf.y + 1 && ferry.y === ferryLane.y + 1,
  'the wharf street lost an exact link'
);
// The south row's own links do not cross the cut: still exact
const exactEast = (a: TownRoom, b: TownRoom) =>
  a.links.e === b.id && b.x === a.x + 1 && b.y === a.y && b.z === a.z;
check(exactEast(wuffa, sw) && exactEast(sw, sEdge) && exactEast(sEdge, se), 'south row split');

// --- After the stretch: first-time moves across the cut. Every target
// cell south of the middle row is empty now (its room moved one row
// down), so each of these must find its displaced room by near-reuse ---
step('n', ERIS_ROAD, 'expected');
step('e', W_SIDE, 'expected');
const swAgain = step('s', SW, 'expected');
check(swAgain.id === sw.id, `W -s-> landed on #${swAgain.id}, not the SW corner #${sw.id}`);
step('e', S_EDGE, 'expected');
const centerAgain = step('n', CENTER, 'expected');
check(centerAgain.id === center.id, `S -n-> landed on #${centerAgain.id}, not the center`);
const seAgain = step('se', SE, 'expected');
check(seAgain.id === se.id, `center -se-> landed on #${seAgain.id}, not the SE corner #${se.id}`);
// SE -n-> E side: three [e,n,s,w] twins within reach (W side, N edge, E
// side); only the description identifies the east side
const eAgain = step('n', E_SIDE, 'expected');
check(eAgain.id === eSide.id, `SE -n-> landed on #${eAgain.id}, not the east side #${eSide.id}`);
step('w', CENTER, 'expected');
// Hidden hop (an alias the queue never saw) from the center onto the
// displaced S edge, at another time of day: the description decides
const hop = step(
  null,
  mk('north, east, and west', 'Stalls line the southern edge of the square.', 'It is dark.')
);
check(hop.id === sEdge.id, `hidden hop resolved to #${hop.id}, not the southern edge #${sEdge.id}`);

const markets = [...town.rooms.values()].filter((r) => r.name === 'Market');
check(markets.length === 9, `${markets.length} Market rooms, expected 9`);
check(town.rooms.size === 15, `${town.rooms.size} rooms, expected 15`);
const linkOf = (r: TownRoom, dir: TownDir) => r.links[dir];
check(
  linkOf(wSide, 's') === sw.id &&
    linkOf(sEdge, 'n') === center.id &&
    linkOf(center, 'se') === se.id,
  'a first-time crossing did not link the displaced room'
);
const cells = new Set([...town.rooms.values()].map(at));
check(cells.size === town.rooms.size, 'two rooms share a grid cell');

if (failures > 0) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  '\nPASS — a stretch through the plaza moves only its south row; displaced twins are still found'
);
