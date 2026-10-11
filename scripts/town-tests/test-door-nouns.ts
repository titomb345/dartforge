/**
 * Regression test: each door's noun is kept on the mapped room.
 *
 * DartMUD's door commands name the door: "open s gate", "close u trapdoor"
 * ("door" does not find a gate). The exits parser reads each door's noun
 * (TownExits.doorNouns); the room keeps the latest sighting's nouns per
 * direction (TownRoom.doorNouns) for the walker's door commands, in the
 * same latest-sighting way as doorDirs/openDoorDirs. The field is OPTIONAL:
 * absent on rooms without a door and on rooms saved before nouns were
 * recorded, so saves stay lean and old saves load unchanged; a merge copy
 * gets its own object (the shared-links lesson: spread copies alias).
 */
import { TownMapStore } from '../../src/lib/townMap';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};
const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `This is the ${name.toLowerCase()}, a perfectly ordinary place in town.`,
  desc: `This is the ${name.toLowerCase()}, a perfectly ordinary place in town.  It is bright.`,
  exits: parseTownExits(exits),
});

const map = new TownMapStore();
let t = 1000;
const A = map.createTown('Bailey');
// the Assembly Hall: a pair of oak doors west, a plain exit east
const hall = map.addRoom(
  A,
  block('Assembly Hall', 'There are two exits: a closed pair of oak doors leading west and east.'),
  0,
  0,
  0,
  (t += 1000)
);
const messhall = map.addRoom(
  A,
  block('Messhall', 'There are four exits: west, a closed oak door leading north, south, and up.'),
  1,
  0,
  0,
  (t += 1000),
  'e'
);
const yard = map.addRoom(
  A,
  block('Yard', 'There are two exits: north and south.'),
  0,
  1,
  0,
  (t += 1000)
);
map.link(A, hall, 'e', messhall);

check(
  JSON.stringify(hall.doorNouns) === '{"w":"doors"}' && hall.doorDirs.join() === 'w',
  `a new room keeps its door nouns (${JSON.stringify(hall.doorNouns)}, doors [${hall.doorDirs}])`
);
check(JSON.stringify(messhall.doorNouns) === '{"n":"door"}', 'Messhall: an oak door north');
check(!('doorNouns' in yard), 'a room without a door carries no doorNouns field');

// latest sighting: a gate seen open, then the line without it (state
// truncation, a door destroyed) — the field follows the sighting
const gateBlock = block('Yard', 'There are two exits: north and an open iron gate leading south.');
map.touchRoom(yard, gateBlock, (t += 1000));
check(
  JSON.stringify(yard.doorNouns) === '{"s":"gate"}',
  `touch adds nouns (${JSON.stringify(yard.doorNouns)})`
);
check(yard.doorNouns !== gateBlock.exits.doorNouns, 'the room owns its nouns object');
map.touchRoom(yard, block('Yard', 'There are two exits: north and south.'), (t += 1000));
check(!('doorNouns' in yard), 'touch without a door removes the field');

// serialize -> deserialize: present stays, absent stays absent, junk dropped
const saved = JSON.parse(JSON.stringify(map.serialize())) as {
  towns: { rooms: Record<string, unknown>[] }[];
};
saved.towns[0].rooms.find((r) => r.name === 'Messhall')!.doorNouns = ['n', 'door'];
const loaded = TownMapStore.deserialize(saved);
const lt = [...loaded.towns.values()][0];
const lroom = (name: string) => [...lt.rooms.values()].find((r) => r.name === name)!;
check(
  JSON.stringify(lroom('Assembly Hall').doorNouns) === '{"w":"doors"}',
  'door nouns survive a save round trip'
);
check(!('doorNouns' in lroom('Yard')), 'a room without doors loads without the field');
check(!('doorNouns' in lroom('Messhall')), 'a malformed doorNouns value is dropped on load');
const old = TownMapStore.deserialize({
  v: 2,
  nextTownId: 1,
  towns: [
    {
      id: 0,
      name: 'Old',
      anchors: {},
      nextRoomId: 1,
      entryRoomId: 0,
      rooms: [
        {
          id: 0,
          name: 'Gatehouse',
          descFirst: '',
          desc: '',
          x: 0,
          y: 0,
          z: 0,
          exits: ['e', 'w'],
          exitsEver: ['e', 'w'],
          doorDirs: ['w'],
          openDoorDirs: [],
          namedExits: [],
          portal: false,
          icon: null,
          links: {},
          namedLinks: {},
          visits: 1,
          lastSeen: 0,
          notes: '',
        },
      ],
    },
  ],
});
check(
  !('doorNouns' in [...[...old.towns.values()][0].rooms.values()][0]),
  'a pre-noun save loads unchanged (no field invented)'
);

// a merge COPY owns its nouns object
const B = map.createTown('Messhall');
const bMess = map.addRoom(
  B,
  block('Messhall', 'There are four exits: west, a closed oak door leading north, south, and up.'),
  0,
  0,
  0,
  (t += 1000)
);
const bPantry = map.addRoom(
  B,
  block('Pantry', 'There are two exits: south and a closed hatch leading down.'),
  0,
  -1,
  0,
  (t += 1000),
  'n'
);
map.link(B, bMess, 'n', bPantry);
const res = map.mergeTowns(B, bMess.id, A, messhall.id);
const pantry = [...A.rooms.values()].find((r) => r.name === 'Pantry');
check(!!res && !!pantry, `the fragment merged and its Pantry was copied (${JSON.stringify(res)})`);
check(
  !!pantry &&
    JSON.stringify(pantry.doorNouns) === '{"d":"hatch"}' &&
    pantry.doorNouns !== bPantry.doorNouns,
  `the copy carries its own nouns object (${JSON.stringify(pantry?.doorNouns)})`
);

if (fail) process.exit(1);
console.log('PASS: door nouns — kept per direction on the room, optional, saved, copied');
