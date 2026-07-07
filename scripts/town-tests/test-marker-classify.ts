/**
 * Regression test: landmark/room icon auto-classification.
 * Inputs are real landmark strings from the 5-year corpus and real DartMUD
 * room names — the rules must keep classifying them the same way.
 */
import { classifyLandmark, classifyRoomIcon } from '../../src/lib/mapMarkers';

let fail = false;
const check = (got: string | null, expected: string | null, input: string) => {
  if (got !== expected) {
    console.error(`FAIL: "${input}" → ${got}, expected ${expected}`);
    fail = true;
  }
};

// Hex landmarks (corpus strings)
const hex: [string, string | null][] = [
  ['a small town next to the sea of eris', 'town'],
  ["a small village clinging to the water's", 'town'],
  ['a large port city', 'town'],
  ['a fortress on a crag', 'castle'],
  ['a path leading to a fortress on a crag', 'castle'], // castle beats path
  ['a small shimmering black castle of the', 'castle'],
  ['a single tower rises slightly above the', 'tower'],
  ['a single windmill rises above the', 'tower'],
  ['the beacon of a lighthouse marks the', 'tower'],
  ['a jagged cave in the side of a mountain', 'cave'],
  ['a dark opening in the hills', 'cave'],
  ['a ragged chasm in the ground', 'cave'],
  ['a small dark cave mouth', 'cave'],
  ['a white temple on a hill', 'temple'],
  ['an entrance to a graveyard', 'grave'],
  ['a cluster of pavilions', 'camp'],
  ['a circle of tents', 'camp'],
  ['a small campfire burns nearby', 'camp'],
  ['a cluster of farms', 'farm'],
  ['an old plantation', 'farm'],
  ['a pine rowboat', 'boat'],
  ['a ferry landing', 'boat'],
  ['a barge with a dock floating next to it', 'boat'],
  ['a large pile of boulders', null], // generic → diamond
  ['a strange rock formation on the horizon', null],
  ['a clearing in the forest', null],
];
for (const [input, expected] of hex) check(classifyLandmark(input), expected, input);

// Town rooms (name, desc → icon)
const rooms: [string, string, string | null][] = [
  ['First Bank of Eris', '', 'bank'],
  ['General Store', '', 'shop'],
  ['Pottery', '', 'shop'],
  ['The Prancing Pony Inn', '', 'inn'],
  ['Taproom', '', 'inn'],
  ['Luminarian Church', '', 'temple'],
  ['Smithy', '', 'smithy'],
  ['Stables', '', 'stable'],
  ['Market', 'This is a spacious market square in the heart of Eris.', 'shop'],
  ['Common Room', 'A bulletin board is mounted by the door.', 'inn'],
  ['Guild Hall', 'There is a bulletin board here covered in notices.', 'board'],
  ['Waterfront street', 'A quiet street along the water.', null],
  ['Vestibule', '', null],
];
for (const [name, desc, expected] of rooms) check(classifyRoomIcon(name, desc), expected, name);

if (fail) process.exit(1);
console.log('PASS — landmark and room icon classification stable');
