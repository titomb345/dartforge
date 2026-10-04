/**
 * Regression test: the oracle-backed TRUE wrong-room metric
 * (scripts/gt/lib/oracleTrace.ts) and its block lookup (OracleIndex.classOf
 * in scripts/gt/lib/oracle.ts).
 *
 * This is the number every town-engine change is judged by
 * (scripts/town-validate.sh prints it next to the desc-disagreement proxy),
 * so a silent change in how it classifies blocks would be blamed on the
 * engine. Example: comparing class ids only — dropping the same name +
 * same canonical text rule — counts every door/portcullis state change as
 * a wrong room and moves the corpus count from 40 to 98 of 21,265 while
 * every other test stays green. Also pins the adapter that keeps an oracle
 * built before the exits-list grammar (back/out/exit as the only named
 * exits) classifying blocks and rooms that now list "hole" or "path" too —
 * without it those blocks fall out of the metric as unclassified.
 *
 * Uses a small synthetic oracle, so it needs no corpus.
 */
import { OracleIndex, RoomMatcher, type Oracle, type OracleClass } from '../gt/lib/oracle';
import { OracleTrace } from '../gt/lib/oracleTrace';
import { groupKey } from '../gt/lib/canon';
import type { TownRoomBlock } from '../../src/lib/townParser';
import type { TownResolution } from '../../src/lib/townLocalizer';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

const cls = (id: number, name: string, dirs: string[], canon: string): OracleClass => ({
  id,
  name,
  dirs,
  named: [],
  group: groupKey(name, dirs, []),
  canon,
  sents: canon.split(/(?<=[.!?])\s+/),
  n: 10,
  nM: 5,
  nD: 5,
  first: '2026-06-01',
  last: '2026-09-01',
  variants: 1,
  ex: 'x',
  exD: null,
  place: 0,
  multLB: 1,
  multWhy: '',
  fragments: 0,
});

const MARKET_N = 'This is the northern edge of the market square. Stalls line the street.';
const MARKET_S = 'This is the southern edge of the market square. Stalls line the street here.';
const GATE = 'A heavy portcullis guards the gate. Guards watch the road.';
// A long text (past the engine's 600-char desc cap) and a same-group rival
// that shares its LAST sentences but not its first — only the capped-prefix
// rule can tell a capped capture of HALL apart from HALL_RIVAL.
const sentence = (i: number) =>
  `The ${['eastern', 'western', 'northern', 'southern'][i % 4]} wall of this long hall bears tapestry number ${i} of the old series.`;
const HALL_BODY = Array.from({ length: 9 }, (_, i) => sentence(i + 1)).join(' ');
const HALL = `This great hall is the heart of the keep. ${HALL_BODY}`;
const HALL_RIVAL = `This lesser hall serves the servants. ${HALL_BODY}`;
const SHOP =
  'A small, plain shop, dealing in wares most extravagant. Her goods are not on display.';

const oracle: Oracle = {
  meta: {},
  volatile: ['The market is busy.'],
  classes: [
    cls(0, 'Market', ['e', 's', 'w'], MARKET_N),
    cls(1, 'Market', ['e', 'n', 'w'], MARKET_S),
    cls(2, 'Gatehouse', ['n', 's'], GATE),
    // Same name + canon, other exits: the portcullis is down
    cls(3, 'Gatehouse', ['n'], GATE),
    cls(4, 'Hall', ['e', 'w'], HALL),
    cls(5, 'Hall', ['e', 'w'], HALL_RIVAL),
    // An oracle built before the exits-list grammar keys classes by
    // back/out/exit only: the shop's hole is invisible to it. Same text,
    // with and without the "back" exit (the matcher must pick by exits).
    cls(6, 'Gem Shop', ['s'], SHOP),
    {
      ...cls(7, 'Gem Shop', ['s'], SHOP),
      named: ['back'],
      group: groupKey('Gem Shop', ['s'], ['back']),
    },
  ],
  edges: [],
  places: [
    {
      id: 0,
      label: 'Eris',
      classes: [0, 1, 2, 3, 4, 5, 6, 7],
      twins: [],
      mushOnly: [],
      sightingsD: 1,
      topNames: [],
    },
  ],
};
const index = new OracleIndex(oracle);

const block = (name: string, dirs: string[], desc: string): TownRoomBlock =>
  ({
    name,
    descFirst: desc.slice(0, 60),
    desc,
    exits: { dirs, doorDirs: [], openDoorDirs: [], named: [], raw: '' },
  }) as unknown as TownRoomBlock;
const res = (kind: string, roomId: number, townId = 1): TownResolution =>
  ({ kind, pos: { townId, roomId }, moved: null }) as unknown as TownResolution;

// --- classOf lookups ---
check(
  index.classOf('Market', ['e', 's', 'w'], [], `${MARKET_N} The market is busy. It is bright.`)
    ?.id === 0,
  'exact lookup must strip lighting and learned volatile prose'
);
check(
  index.classOf('Market', ['e', 'n', 'w'], [], 'the market square. Stalls line the street here.')
    ?.id === 1,
  'a fragment capture (desc tail) must match its class by unique suffix'
);
const capped = HALL.slice(0, 600);
check(capped.length === 600 && !HALL.startsWith(capped + ' '), 'fixture: cap must cut a sentence');
check(
  index.classOf('Hall', ['e', 'w'], [], capped)?.id === 4,
  'a 600-char capped desc must match by its uncut sentences as a unique prefix'
);
check(
  index.classOf('Hall', ['e', 'w'], [], HALL_RIVAL.slice(0, 600))?.id === 5,
  "the capped prefix must pick the rival when the rival's text was captured"
);
check(index.classOf('Nowhere', ['n'], [], 'Nothing to see.') === undefined, 'unknown text');
// Since Oct 2026 the parser lists every exit word ("back, south, and hole"):
// a fixed pre-grammar oracle still classifies the block by back/out/exit
check(
  index.classOf('Gem Shop', ['s'], ['back', 'hole'], SHOP)?.id === 7,
  'a block with exit words the oracle predates is classified by back/out/exit'
);
check(
  index.classOf('Gem Shop', ['s'], ['hole'], SHOP)?.id === 6,
  '... none of them: no named exits'
);
check(
  new RoomMatcher(oracle).match({
    name: 'Gem Shop',
    desc: SHOP,
    exits: ['s'],
    namedExits: ['back', 'hole'],
  }).cls?.id === 7,
  'a mapped room with exit words the oracle predates scores its back/out/exit class'
);

// --- the trace ---
const t = new OracleTrace(index);
t.observe(
  'mazorn',
  block('Market', ['e', 's', 'w'], MARKET_N),
  res('new-room', 7),
  undefined,
  'f',
  1
);
t.observe(
  'mazorn',
  block('Market', ['e', 's', 'w'], MARKET_N),
  res('expected', 7),
  undefined,
  'f',
  2
);
check(
  t.totals().wrong === 0 && t.totals().checked === 1,
  `same class: checked, not wrong (got ${JSON.stringify(t.totals())})`
);

t.observe(
  'mazorn',
  block('Market', ['e', 'n', 'w'], MARKET_S),
  res('expected', 7),
  undefined,
  'f',
  3
);
check(t.wrong.expected === 1, 'another class on the same room must count as wrong under its kind');
check(
  t.wrongList.length === 1 &&
    t.wrongList[0].line === 3 &&
    t.wrongList[0].kind === 'expected' &&
    t.wrongList[0].block === 1 &&
    t.wrongList[0].room === 0,
  `wrongList entry must name the block class, the room class and the line: ${JSON.stringify(t.wrongList)}`
);

t.observe('mazorn', block('Gatehouse', ['n', 's'], GATE), res('new-room', 9), undefined, 'f', 4);
t.observe('mazorn', block('Gatehouse', ['n'], GATE), res('stationary', 9), undefined, 'f', 5);
check(
  t.totals().wrong === 1,
  'same name + same canonical text with other exits (door/portcullis state) must NOT be wrong'
);

// new-room and jumped re-stamp the room's class (a fresh room is whatever
// it was created from — never a wrong assignment)
t.observe(
  'mazorn',
  block('Market', ['e', 'n', 'w'], MARKET_S),
  res('jumped', 7),
  undefined,
  'f',
  6
);
t.observe(
  'mazorn',
  block('Market', ['e', 'n', 'w'], MARKET_S),
  res('expected', 7),
  undefined,
  'f',
  7
);
check(t.totals().wrong === 1, 'jumped must re-stamp the room class');
t.observe('mazorn', block('Gatehouse', ['n', 's'], GATE), res('new-room', 7), undefined, 'f', 8);
t.observe('mazorn', block('Gatehouse', ['n', 's'], GATE), res('expected', 7), undefined, 'f', 9);
check(t.totals().wrong === 1, 'new-room must re-stamp the room class');

// Room ids are per town and per character's store: trilok's town 1 room 7
// is a different room from mazorn's
t.observe(
  'trilok',
  block('Market', ['e', 's', 'w'], MARKET_N),
  res('expected', 7),
  undefined,
  'f',
  10
);
check(t.totals().wrong === 1, "another character's room with the same ids is another room");
t.observe(
  'mazorn',
  block('Market', ['e', 's', 'w'], MARKET_N),
  res('expected', 7, 2),
  undefined,
  'f',
  11
);
check(t.totals().wrong === 1, 'another town with the same room id is another room');

t.observe(
  'mazorn',
  block('Nowhere', ['n'], 'Nothing to see.'),
  res('expected', 7),
  undefined,
  'f',
  12
);
check(t.unclassified === 1, 'a block the oracle cannot classify must be counted as unclassified');

if (fail) process.exit(1);
console.log('PASS — the oracle trace counts true wrong rooms and only those');
