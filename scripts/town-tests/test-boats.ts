/**
 * Regression test: boats are no town rooms. A rowboat rows off to other
 * docks and beaches, so a boat room filed into the town it was moored in
 * glues every shore it puts in at onto that town. Bill's live save had
 * "Westmore Dock -[enter rowboat]-> In a Rowboat" and "North Pier -[enter
 * galley]-> Oar Deck"; and every look inside the rowboat flipped the map
 * indoors, every survey back out.
 *
 *  A. The Westmore rowboat (session_2026-11-05T23-54-55-152.log:7726-7860):
 *     board, look, row out and back, look, climb out onto the dock. No boat
 *     room, no boarding link, the hex map stays outdoors aboard and counts
 *     the rows; ashore on the same Westmore Dock.
 *  B. The Tobermore galley (session_2026-11-02T22-15-40-061.log:4184-4209):
 *     "exit" lands on North Pier with no line of its own; the pier keeps its
 *     link to the Town dock.
 *  C. An exit word that fails: the next block is the boat again, still
 *     aboard.
 *  D. Climbing out at sea (MUSH dm-2022-02-06.txt:113120): the survey right
 *     after "You climb out of the rowboat." is ashore (in the water).
 *  E. A login aboard (no boarding line): the boat room is still no room.
 *  F. A save made before boats were recognized loads without its boat rooms
 *     (and a room only a boat room links with), keeping the dock.
 *  G. Boats are no hex landmarks: the rowboat in a survey's legend used to
 *     put a boat icon on every hex it crossed. A ferry landing stays one,
 *     and saved boat landmarks (and their icons) are dropped on load.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HexMapStore } from '../../src/lib/hexMap';
import { isVesselLandmark } from '../../src/lib/mapMarkers';
import { TownMapStore } from '../../src/lib/townMap';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boats-'));
let fileNo = 0;
/** One session log: `|`-prefixed lines are server output, `>> ` lines input;
 *  every line one second after the previous */
function sessionLog(text: string): string {
  const t0 = Date.UTC(2026, 10, 6, 9, 0, 0) + fileNo * 3_600_000;
  const lines = text.split('\n').map((raw, i) => {
    const d = new Date(t0 + i * 1000);
    const h = d.getUTCHours();
    const stamp =
      `[${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')} ${h % 12 || 12}:` +
      `${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ` +
      `${h < 12 ? 'AM' : 'PM'}]`;
    return `${stamp} ${raw.replace(/^\s*\|/, '')}`;
  });
  const f = path.join(dir, `session_2026-11-06T${String(fileNo++).padStart(2, '0')}-00-00-000.log`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
function replay(text: string) {
  const r = new TownReplay({ expand: (raw) => [raw] });
  r.replayLog(sessionLog(text));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const named = (n: string) => rooms().filter((x) => x.name === n);
  return { r, rooms, named, here: () => r.townMap.room(r.townMap.pos) };
}

const WESTMORE_DOCK = `|Westmore Dock
|You stand on the town dock of Westmore.  The harbor is sheltered by a stone
|breakwater, with a narrow channel leading into the large bay to the southwest.
|To the northeast is the town square and you can see the town spreading along
|Front Street parallel to the shoreline.  It is well lit.  The air is quite
|chilly.
|There is one obvious exit: northeast.
|a wooden rowboat christened "The Minnow".
|Dryfter the centaur.`;
const IN_A_ROWBOAT = `|In a Rowboat
|You are in a rowboat docked at the Westmore Dock.  It is well lit.  The air is
|quite chilly.
|There is one obvious exit: exit.
|Dryfter the centaur.`;
const ROW_SW = `>> row sw
|You take hold of the oars.
|You try to row to the southwest.
|You row out away from land.
|Outside you see:
|You gaze at your surroundings.
|
|              -----               1) a wooden rowboat christened "the minnow"
|             /..  .\\              W) a small town.
|        -----  .  ..-----         2) a building in a clearing.
|       /.  . \\  .  /..  .\\
|  ----- ..  . -----  ..  .-----
| /"   "\\ .   /  "" \\  .  /""  "\\
|-  "   "----- "  "  -----  ""  "-
| \\  "  / ~~ ~\\""  "/  ww \\  "  /
|  -----~  ~  ~----- w Www -----
| /~  ~~\\~  ~ /~  ~~\\ w  w/  "  \\
|-  ~  ~~-----  ~1 ~~-----""  "  *
| \\ ~~  /~  ~ \\ ~~  /"  " \\"" ""*
|  ----- ~~  ~ ----- ""  " **^**
| /~  ~ \\ ~~ ~/~  ~~\\ "" "* ww w\\
|- ~~  ~ ----- ~~  ~ -****w  2  w-
| \\ ~~ ~/w  w \\ ~~  /  w  \\w ww /
|  -----  w  w -----ww ww  -----
|       \\  w  / w  w\\w  ww/
|        -----  ww  w-----
|             \\  ww /
|              -----`;
const ROW_NE = `>> row ne
|You're off balance.
|You try to row to the northeast.
|You made some progress.
|You pull into the harbor.
|Outside you see:
|Westmore Dock: A dock in a sheltered harbor. < ne >
|a wooden rowboat christened "The Minnow".`;

// --- A: the Westmore rowboat ---------------------------------------------------
{
  const h = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> lead enter rowboat',
      '|Dryfter boards a wooden rowboat christened "The Minnow"',
      '|You board the boat.',
      IN_A_ROWBOAT,
      '>> l',
      IN_A_ROWBOAT,
      ROW_SW,
      ROW_NE,
      '>> l',
      IN_A_ROWBOAT,
    ].join('\n')
  );
  check(h.named('In a Rowboat').length === 0, 'A: the rowboat is no town room');
  check(h.r.townLocalizer.aboard, 'A: aboard after the trip');
  check(!h.r.townLocalizer.active, 'A: the town engine is off aboard');
  check(!h.r.hexLocalizer.indoors, 'A: a look inside the rowboat leaves the hex map outdoors');
  check(h.r.stats.boardings === 1, `A: one boarding (${h.r.stats.boardings})`);
  const dock = h.named('Westmore Dock');
  check(dock.length === 1, `A: one Westmore Dock (${dock.length})`);
  check(
    dock[0] && Object.keys(dock[0].namedLinks).length === 0,
    `A: no boarding link (${JSON.stringify(dock[0]?.namedLinks)})`
  );

  // A row after a look inside the boat is a hex move
  const rows = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> enter rowboat',
      '|You board the boat.',
      IN_A_ROWBOAT,
      '>> l',
      IN_A_ROWBOAT,
      '>> row sw',
    ].join('\n')
  );
  const pending = rows.r.hexLocalizer.pendingMoves.map((m) => m.dir).join(',');
  check(pending === 'sw', `A: the hex map counts the rows (${pending})`);

  // ... and ashore again, on the same dock
  const h2 = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> enter rowboat',
      '|You board the boat.',
      IN_A_ROWBOAT,
      '>> exit',
      '|You climb out of the rowboat.',
      WESTMORE_DOCK,
    ].join('\n')
  );
  check(!h2.r.townLocalizer.aboard, 'A: ashore after climbing out');
  check(h2.r.townLocalizer.active, 'A: the town engine is on again');
  check(h2.named('Westmore Dock').length === 1, 'A: back on the one Westmore Dock');
  check(h2.here()?.name === 'Westmore Dock', `A: position on the dock (${h2.here()?.name})`);
  check(h2.r.hexLocalizer.indoors, 'A: on the dock the hex map is indoors');
  check(h2.rooms().length === 1, `A: nothing else mapped (${h2.rooms().length})`);
}

// --- B: the Tobermore galley ----------------------------------------------------
const NORTH_PIER = `|North Pier
|You are standing on a pier which is part of the main dock.  The shipyard lies to
|your south, and the land curves around to your north where the lighthouse stands
|watch on the point.  It is painfully bright.  It is snowing.
|There is one obvious exit: southeast.
|a galley, and 705 crates.
|Silsby the purser.`;
const OAR_DECK = `|Oar Deck
|You are on the rowing deck of a galley.  There are eight rows of benches, each
|with an oar on alternate sides of the ship, so that the ship may be rowed by
|eight or more strong individuals.  Around the vessel in North Pier you see:
|Silsby the purser and 705 crates.  It is painfully bright.  It is snowing.
|There are two exits: exit and a closed hatch leading down.
|Brown the boatswain.`;
const TOWN_DOCK = `|Town dock
|You are standing on the main dock of town.  To the south you can see the
|shipyard.  Sweeping your vision northward, you take in the buildings of
|Tobermore huddled together in the lee of the hills.  The docks continue to the
|northwest and to the west, a ruined stone bridge once led over to an islet.
|Finally, at the north end of the little shelf of land, there is a lighthouse on
|the point.  It is painfully bright.  It is snowing.
|There are three exits: east, northwest, and south.`;
{
  const h = replay(
    [
      '>> l',
      NORTH_PIER,
      '>> enter galley',
      '|You board the boat.',
      OAR_DECK,
      '>> exit',
      NORTH_PIER,
      '>> se',
      TOWN_DOCK,
    ].join('\n')
  );
  check(h.named('Oar Deck').length === 0, 'B: the galley is no town room');
  check(!h.r.townLocalizer.aboard, 'B: ashore after "exit"');
  const pier = h.named('North Pier');
  check(pier.length === 1, `B: one North Pier (${pier.length})`);
  check(
    pier[0] && Object.keys(pier[0].namedLinks).length === 0,
    `B: no boarding link (${JSON.stringify(pier[0]?.namedLinks)})`
  );
  const dock = h.named('Town dock')[0];
  check(!!dock && pier[0]?.links.se === dock.id, 'B: North Pier -se-> Town dock');
  check(h.here()?.name === 'Town dock', `B: position on the Town dock (${h.here()?.name})`);
}

// --- C: an exit word that fails ----------------------------------------------------
{
  const h = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> enter rowboat',
      '|You board the boat.',
      IN_A_ROWBOAT,
      '>> exit',
      '|What ?',
      '>> l',
      IN_A_ROWBOAT,
    ].join('\n')
  );
  check(h.r.townLocalizer.aboard, 'C: still aboard after the boat prints again');
  check(h.named('In a Rowboat').length === 0, 'C: the rowboat is no town room');
}

// --- D: climbing out at sea --------------------------------------------------------
{
  const h = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> enter rowboat',
      '|You board the boat.',
      IN_A_ROWBOAT,
      '>> exit',
      '|You climb out of the rowboat.',
      ROW_SW.split('\n').slice(5).join('\n'), // the survey alone
      '|This is a large expanse of ocean.    It is extremely light here.',
      '>> l',
    ].join('\n')
  );
  check(!h.r.townLocalizer.aboard, 'D: the survey after climbing out is ashore');
  check(!h.r.townLocalizer.active, 'D: outdoors');
}

// --- E: a login aboard -------------------------------------------------------------
{
  const h = replay(['>> l', IN_A_ROWBOAT].join('\n'));
  check(h.rooms().length === 0, `E: no room mapped (${h.rooms().length})`);
  check(h.r.townMap.towns.size === 0, `E: no town started (${h.r.townMap.towns.size})`);
  check(h.r.townLocalizer.aboard, 'E: aboard');
}

// --- F: an old save with boat rooms ------------------------------------------------
{
  const room = (id: number, name: string, x: number, extra: object) => ({
    id,
    name,
    desc: `${name} description.`,
    descFirst: `${name} description.`,
    doorDirs: [],
    exits: [],
    exitsEver: [],
    icon: null,
    lastSeen: 0,
    links: {},
    namedExits: [],
    namedLinks: {},
    notes: '',
    openDoorDirs: [],
    portal: false,
    visits: 1,
    x,
    y: 0,
    z: 0,
    ...extra,
  });
  const store = TownMapStore.deserialize({
    v: 2,
    nextTownId: 2,
    pos: { townId: 0, roomId: 2 },
    towns: [
      {
        id: 0,
        name: 'Front Street',
        anchors: { '0:1,2': 0, '0:9,9': 2 },
        nextRoomId: 4,
        entryRoomId: 0,
        rooms: [
          room(0, 'Port Street', 0, { exits: ['sw'], exitsEver: ['sw'], links: { sw: 1 } }),
          room(1, 'Westmore Dock', -1, {
            exits: ['ne'],
            exitsEver: ['ne'],
            links: { ne: 0 },
            namedLinks: { 'enter rowboat': 2 },
          }),
          room(2, 'In a Rowboat', -2, { namedExits: ['exit'], links: { d: 3 } }),
          room(3, 'Hold', -2, { z: -1, links: { u: 2 } }),
        ],
      },
      {
        id: 1,
        name: 'In a Rowboat',
        anchors: {},
        nextRoomId: 1,
        entryRoomId: 0,
        rooms: [room(0, 'In a Rowboat', 0, { namedExits: ['exit'] })],
      },
    ],
  });
  const town = store.get(0)!;
  check(
    [...town.rooms.values()].map((r) => r.name).join(',') === 'Port Street,Westmore Dock',
    `F: boat rooms cut (${[...town.rooms.values()].map((r) => r.name).join(',')})`
  );
  const dock = town.rooms.get(1);
  check(
    !!dock && Object.keys(dock.namedLinks).length === 0 && dock.links.ne === 0,
    'F: the dock keeps its street link and loses the boarding link'
  );
  check(JSON.stringify(town.anchors) === '{"0:1,2":0}', `F: anchor on the boat dropped`);
  check(store.pos === null, 'F: a position on the boat is no position');
  check(!store.get(1), 'F: a town that was nothing but a boat is gone');
}

// --- G: boats are no hex landmarks ------------------------------------------------
{
  // The Westmore rowboat trip: the legend's "1) a wooden rowboat christened
  // "the minnow"" marks nothing
  const h = replay(
    [
      '>> l',
      WESTMORE_DOCK,
      '>> enter rowboat',
      '|You board the boat.',
      IN_A_ROWBOAT,
      ROW_SW,
      "|You're off balance.", // (a survey resolves at the next server line)
      // Landmarks are recorded once a survey is placed confidently: the
      // second look at the same water
      '>> survey',
      ROW_SW.split('\n').slice(5).join('\n'),
      "|You're off balance.",
      '>> l',
    ].join('\n')
  );
  const cells = Object.values(h.r.hexMap.serialize().cells);
  const boats = cells.filter(
    (c) => c.marker === 'boat' || c.landmarks.some((l) => /rowboat/i.test(l))
  );
  check(
    cells.some((c) => c.landmarks.length > 0),
    'G: the survey recorded its landmarks'
  );
  check(boats.length === 0, `G: no boat landmark or icon (${boats.length})`);

  for (const v of [
    'a wooden rowboat christened "the minnow"',
    'a ferry barge',
    'a barge',
    'a pine rowboat',
  ])
    check(isVesselLandmark(v), `G: "${v}" is a boat`);
  for (const p of [
    'a ferry landing',
    'a ferry landing on the shore of the sea',
    'a small port town',
  ])
    check(!isVesselLandmark(p), `G: "${p}" is a place`);

  const cell = (q: number, landmarks: string[], marker: string | null) => ({
    q,
    r: 0,
    island: 0,
    terrain: 'water',
    landmarks,
    marker,
  });
  const store = HexMapStore.deserialize({
    version: 2,
    pos: null,
    nextIsland: 1,
    cells: {
      '0:0,0': cell(0, ['a wooden rowboat christened "the minnow"'], 'boat'),
      '0:1,0': cell(1, ['a ferry landing', 'a ferry barge'], 'boat'),
      '0:2,0': cell(2, ['a pine rowboat', 'a small town'], 'boat'),
      '0:3,0': cell(3, ['a strange stone'], 'tower'),
    },
  });
  const at = (q: number) => store.get(0, q, 0)!;
  check(at(0).landmarks.length === 0 && at(0).marker === null, 'G: a sailed hex loses the rowboat');
  check(
    at(1).landmarks.join('|') === 'a ferry landing' && at(1).marker === 'boat',
    `G: the ferry landing stays (${at(1).landmarks.join('|')}, ${at(1).marker})`
  );
  check(at(2).marker === 'town', `G: re-classified from what is left (${at(2).marker})`);
  check(at(3).marker === 'tower', 'G: an explicit marker is kept');
}

fs.rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('boats: all checks passed');
