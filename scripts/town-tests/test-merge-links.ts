/**
 * Regression test: links of rooms COPIED by a town merge.
 *
 * mergeTowns fuses a fragment town into the real one. Fragment rooms that
 * land on an empty cell are copied under new ids — and their links must be
 * rewritten into the target's id space. The copy used to be a plain spread
 * that SHARED the fragment room's links object, so the rewrite pass (which
 * only fills empty slots) saw every slot "already set" and kept the
 * fragment's old ids: each merge silently wired the copied rooms to
 * whatever unrelated rooms owned those ids in the target town. Live, that
 * scrambled every merged town; the load-time link cleanse then severed most
 * of the bogus links, leaving the copies isolated (corpus replay: 2002 link
 * misses and 178 isolated rooms before the fix, 73 and 5 after).
 *
 * Also covers the exits union on FUSED rooms: an exit seen only from the
 * fragment's side must survive into the fused room, or the load cleanse
 * (linkContradicted) cuts the link the merge just brought over.
 */
import { TownMapStore, type Town, type TownRoom } from '../../src/lib/townMap';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `This is the ${name.toLowerCase()}, a perfectly ordinary place in town.`,
  desc: `This is the ${name.toLowerCase()}, a perfectly ordinary place in town.  It is bright.`,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});

const map = new TownMapStore();
let t = 1000;

// Real town A: Gate -e-> Square -e-> Well. Square was only ever seen with
// its east/west exits (say its north gate was shut each time).
const A = map.createTown('Gate');
const gate = map.addRoom(A, block('Gate', 'east'), 0, 0, 0, (t += 1000));
const square = map.addRoom(A, block('Square', 'west and east'), 1, 0, 0, (t += 1000), 'e');
const well = map.addRoom(A, block('Well', 'west'), 2, 0, 0, (t += 1000), 'e');
map.link(A, gate, 'e', square);
map.link(A, square, 'e', well);

// Fragment B (entered elsewhere): Square -n-> Alley -n-> Shop. Its ids
// (0, 1, 2) collide with A's ids — exactly the situation that exposed the
// stale-id bug.
const B = map.createTown('Square');
const bSquare = map.addRoom(B, block('Square', 'west, east, and north'), 0, 0, 0, (t += 1000));
const alley = map.addRoom(B, block('Alley', 'north and south'), 0, -1, 0, (t += 1000), 'n');
const shop = map.addRoom(B, block('Shop', 'south'), 0, -2, 0, (t += 1000), 'n');
map.link(B, bSquare, 'n', alley);
map.link(B, alley, 'n', shop);

map.mergeTowns(B, bSquare.id, A, square.id);

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

const byName = (town: Town, name: string): TownRoom[] =>
  [...town.rooms.values()].filter((r) => r.name === name);
const nameOf = (town: Town, id: number | undefined) =>
  id === undefined ? '(none)' : (town.rooms.get(id)?.name ?? `(dangling #${id})`);

const verify = (town: Town, label: string) => {
  check(town.rooms.size === 5, `${label}: rooms=${town.rooms.size}, expected 5 (Square fused)`);
  const [sq] = byName(town, 'Square');
  const [al] = byName(town, 'Alley');
  const [sh] = byName(town, 'Shop');
  check(!!sq && !!al && !!sh, `${label}: missing rooms after merge`);
  if (!sq || !al || !sh) return;
  check(nameOf(town, sq.links.n) === 'Alley', `${label}: Square.n → ${nameOf(town, sq.links.n)}`);
  check(nameOf(town, sq.links.w) === 'Gate', `${label}: Square.w → ${nameOf(town, sq.links.w)}`);
  check(nameOf(town, sq.links.e) === 'Well', `${label}: Square.e → ${nameOf(town, sq.links.e)}`);
  check(nameOf(town, al.links.s) === 'Square', `${label}: Alley.s → ${nameOf(town, al.links.s)}`);
  check(nameOf(town, al.links.n) === 'Shop', `${label}: Alley.n → ${nameOf(town, al.links.n)}`);
  check(nameOf(town, sh.links.s) === 'Alley', `${label}: Shop.s → ${nameOf(town, sh.links.s)}`);
  check(sq.exitsEver.includes('n'), `${label}: fused Square lost the north exit seen by the fragment`);
};

check(!map.towns.has(B.id), 'fragment town should be gone after the merge');
verify(A, 'after merge');

// The load-time cleanses must keep every merged link (an exit seen only by
// the fragment would otherwise contradict Square.n and get it severed).
const revived = TownMapStore.deserialize(JSON.parse(JSON.stringify(map.serialize())));
const revivedA = revived.get(A.id);
check(!!revivedA, 'merged town missing after reload');
if (revivedA) verify(revivedA, 'after reload');

// A path across the seam must exist (walking needs the rebuilt links).
const path = map.findPath(A, gate.id, byName(A, 'Shop')[0]?.id ?? -1);
check(
  path?.map((s) => s.cmd).join(',') === 'e,n,n',
  `Gate→Shop path = ${path?.map((s) => s.cmd).join(',') ?? 'none'}, expected e,n,n`
);

if (fail) process.exit(1);
console.log('PASS — merged copies get links rebuilt in the target town; reload keeps them');
