/**
 * Regression test: door state after a crossing (Oct 2026 deep dive, walking
 * lens).
 *
 * A door crossing — the /door built-in behind Bill's `door <dir>` alias, a
 * walk's door step — fires unlock / open / MOVE / close / lock blind, so the
 * arrival room prints its exits BEFORE the close runs, listing the door just
 * crossed as open, and the map kept it so. 104 of the 112 corpus door opens
 * that found an "open" door closed were that door: a walk leaving by it
 * sent a bare move into it ("The gate is closed." — walk stopped at step
 * one).
 *
 *  A. session_2026-07-04T20-38-50-676.log:1298-1362: `door e` from the
 *     Stable into the Stall ("an open gate leading west"), then `door w`
 *     back ("an open gate leading east"): both gates end up closed on both
 *     sides.
 *  B. A close with nothing queued shuts the current room's door, in any
 *     noun form ("close w gate").
 *  C. A close without a direction names the room's one door of that noun
 *     (session_2026-07-06T00-03-28-376.log:3266-3279: up from the Cellar
 *     into the Kitchen, "close trapdoor"); typed behind a move it shuts
 *     nothing in the room the move leaves.
 *  D. A close typed behind a move runs in the room the move lands in — the
 *     door it names there shuts, not the one crossed; behind two moves, where
 *     the second lands; "close constructor" names no door; a noun the room
 *     has twice names no door; opens are never recorded.
 */
import type { Alias } from '../../src/types/alias';
import type { TownRoom } from '../../src/lib/townMap';
import { makeExpander } from '../lib/replayInput';
import { SessionFixture } from '../lib/sessionFixture';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// Bill's alias (frozen aliases.json): `door e` runs the /door built-in
const doorAlias: Alias = {
  id: 'door',
  pattern: '^door (ne|se|nw|sw|n|s|e|w|d|u|in|out)$',
  matchMode: 'regex',
  body: '/door $1',
  bodyMode: 'text',
  enabled: true,
  group: 'Movement',
  createdAt: '2026-02-19T06:04:58.921Z',
  updatedAt: '2026-02-19T06:04:58.921Z',
};
const expand = makeExpander([doorAlias]);
const fx = new SessionFixture('door-close-');
function replay(text: string) {
  const r = new TownReplay({ expand: (raw) => expand(raw) });
  r.replayLog(fx.write(text));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  const here = (): TownRoom | undefined => r.townMap.room(r.townMap.pos);
  return { r, named, here };
}
const open = (r: TownRoom | undefined) => JSON.stringify(r?.openDoorDirs);

const stable = (east: 'open' | 'closed') => `|> Stable
|This area is used to house mounts and beasts of burden.  Wooden partitions
|separate the area into stalls and wooden gates prevent the animals from
|wandering.  Built into one wall is a cabinet designed to hold tack and harness.
|A pair of wrought-iron lanterns are suspended from the rafters and shed a warm
|illumination over the stables.  A sturdy ladder leads up to a loft and a hoist
|hangs from the rafters above.  It is bright.
|There are four exits: north, ${east === 'open' ? 'an open' : 'a closed'} gate leading east, a closed gate leading
|west, and south.
|a wooden wagon.`;
const stall = (west: 'open' | 'closed') => `|> Stall
|Low oak partitions separate this stall from the rest of the stable and gate to
|the west keeps the livestock from wandering off.  A wrought-iron lantern
|attached to the stone and timber outer wall provides some warm illumination.
|The floor is strewn with hay and couple of bales of hay are sitting in one
|corner.  It is bright.
|There is one obvious exit: ${west === 'open' ? 'an open' : 'a closed'} gate leading west.
|a wooden wagon, a wooden wagon, and a tortoiseshell wagon.`;

// --- A: through the gate and back -----------------------------------------------
{
  const there = replay(
    [
      stable('closed'),
      '>> door e',
      '|The gate has no lock!',
      "|> You don't have one of those.",
      '|> You open the gate.',
      stall('open'),
      '|> You close the gate.',
      '|> The gate has no lock!',
    ].join('\n')
  );
  check(there.here()?.name === 'Stall', 'A: in the Stall');
  check(
    open(there.named('Stall')[0]) === '[]',
    `A: the gate just crossed is shut, though the Stall printed it open (${open(there.named('Stall')[0])})`
  );
  check(open(there.named('Stable')[0]) === '[]', "A: ... and so is the Stable's side of it");

  const back = replay(
    [
      stable('closed'),
      '>> door e',
      '|> You open the gate.',
      stall('open'),
      '|> You close the gate.',
      '>> door w',
      '|> You open the gate.',
      stable('open'),
      '|> You close the gate.',
    ].join('\n')
  );
  check(back.here()?.name === 'Stable', 'A: back in the Stable');
  check(
    open(back.named('Stable')[0]) === '[]' && open(back.named('Stall')[0]) === '[]',
    `A: both gates recorded closed after the way back (${open(back.named('Stable')[0])} ${open(back.named('Stall')[0])})`
  );
}

// --- B: a close with nothing queued ------------------------------------------------
{
  const h = replay(
    [stable('open'), '>> e', stall('open'), '>> close w gate', '|> You close the gate.'].join('\n')
  );
  check(
    open(h.named('Stall')[0]) === '[]' && open(h.named('Stable')[0]) === '[]',
    `B: "close w gate" shuts the Stall's gate, both sides (${open(h.named('Stall')[0])} ${open(h.named('Stable')[0])})`
  );
}

// --- C: "close trapdoor" -----------------------------------------------------------
{
  const CELLAR = `|Cellar
|This is a musty old cellar stacked high with casks and bottleracks.  The near
|wall has a tapestry and some other old junk that has been stored and forgotten
|down here and a few crates have been pulled out from the wall and placed around
|a small table.  A spiral stone staircase in the corner leads up to the kitchen.
|It is bright.
|There is one obvious exit: an open oak trapdoor leading up.`;
  const KITCHEN = `|Kitchen
|This is a utilitarian kitchen with whitewashed walls, a slate floor and a few
|wrought-iron lanterns hanging from the ceiling.  On the far wall is a large
|fireplace and in the corner is a brick oven for baking bread and pies.  Along
|the east wall is a long counter with a cabinet above it.  A window beside the
|door to the south allows starlight to stream into the kitchen.  The lanterns are
|lit, providing a warm illumination.  The fireplace and oven are unlit.  It is
|bright.
|There are three exits: north, a closed oak door leading south, and an open oak
|trapdoor leading down.`;
  const h = replay(
    [CELLAR, '>> u', KITCHEN, '>> close trapdoor', '|You close the oak trapdoor.'].join('\n')
  );
  check(
    open(h.named('Kitchen')[0]) === '[]' && open(h.named('Cellar')[0]) === '[]',
    `C: the Kitchen's one trapdoor is shut, both sides (${open(h.named('Kitchen')[0])} ${open(h.named('Cellar')[0])})`
  );
  // Typed behind a move it runs where the move lands, which may have no
  // trapdoor at all: it shuts nothing in the Kitchen
  const DINING = `|Dining Hall
|A long oak table runs the length of this hall beneath a pair of iron
|chandeliers.  It is bright.
|There is one obvious exit: south.`;
  const q = replay([CELLAR, '>> u', KITCHEN, '>> n', '>> close trapdoor', DINING].join('\n'));
  check(
    open(q.named('Kitchen')[0]) === '["d"]' && open(q.named('Cellar')[0]) === '["u"]',
    `C: a close behind a move leaves the room it leaves alone (${open(q.named('Kitchen')[0])} ${open(q.named('Cellar')[0])})`
  );
}

// --- D: the door the close names, where it runs ----------------------------------------
{
  // "close w door" typed behind the move west runs in the Stable: its WEST
  // gate shuts, the one just crossed (east) stays as printed
  const h = replay(
    [
      stall('open'),
      '>> w',
      '>> close w door',
      stable('open').replace('a closed gate leading\n|west', 'an open gate leading\n|west'),
      '|> You close the gate.',
    ].join('\n')
  );
  check(
    open(h.named('Stable')[0]) === '["e"]',
    `D: a close behind a move runs where the move lands (${open(h.named('Stable')[0])})`
  );
  // Behind two moves it runs where the LAST one lands: through the Stable row
  // (07-04, the stalls on both sides) from the east Stall into the west one,
  // "close e gate" shuts the west Stall's gate — the Stable's west gate — not
  // the gate the first move came through
  const WEST_STALL = `|> Stall
|Low oak partitions separate this stall from the rest of the stable and gate to
|the east keeps the livestock from wandering off.  A wrought-iron lantern
|attached to the stone and timber outer wall provides some warm illumination.
|The floor is strewn with hay and couple of bales of hay are sitting in one
|corner.  It is bright.
|There is one obvious exit: an open gate leading east.
|a wooden horse cart, a rosewood wagon, a pine wagon, and an ebony wagon.`;
  const t = replay(
    [
      stall('open'),
      '>> w',
      '>> w',
      '>> close e gate',
      stable('open').replace('a closed gate leading\n|west', 'an open gate leading\n|west'),
      WEST_STALL,
      '|> You close the gate.',
    ].join('\n')
  );
  const row = t.named('Stable')[0];
  const [east, west] = [row?.links.e, row?.links.w].map((id) =>
    t.named('Stall').find((x) => x.id === id)
  );
  check(
    open(east) === '["w"]' && open(row) === '["e"]' && open(west) === '[]',
    `D: behind two moves, where the second lands (${open(east)} ${open(row)} ${open(west)})`
  );
  // A name every object inherits names no door ("constructor" read as a
  // direction rode on the move before it)
  const c = replay([stall('open'), '>> w', '>> close constructor'].join('\n'));
  check(
    c.r.townLocalizer.pendingMoves[0]?.closeAfter === undefined,
    `D: "close constructor" closes nothing (${c.r.townLocalizer.pendingMoves[0]?.closeAfter})`
  );
  // Two gates, "close gate": which one is unknown
  const g = replay(
    [
      stable('open').replace('a closed gate leading\n|west', 'an open gate leading\n|west'),
      '>> close gate',
      '|Which one, the east gate or the west gate?',
    ].join('\n')
  );
  check(
    open(g.named('Stable')[0]) === '["e","w"]',
    `D: an ambiguous noun closes nothing (${open(g.named('Stable')[0])})`
  );
  // Opens are not trusted: a stated "open" proves nothing until a block shows it
  const o = replay([stall('closed'), '>> open w gate', '|You open the gate.'].join('\n'));
  check(open(o.named('Stall')[0]) === '[]', 'D: an open command records nothing');
}

fx.remove();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-door-close: all checks passed');
