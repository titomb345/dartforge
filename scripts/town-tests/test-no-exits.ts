/**
 * Regression test: a room without exits ("There are no obvious exits.").
 *
 * The exits line is the room block's anchor, and the town parser, the hex
 * RoomParser and the replay tools only knew the "There is one obvious
 * exit:" / "There are N exits:" forms. The spirit plane's Arena (and MUSH's
 * Rift, ledges, rooftops, slides: 4,095 sightings) prints "There are no
 * obvious exits." — so its block vanished, the hex engine got no town-room
 * event, and the move into it stayed queued. In
 * session_2026-07-01T15-45-27-282.log:3460-3494 the dead "n" then claimed
 * the Dressing Room the arena transports you to: a false Arena Armory
 * -n-> Dressing Room link that walks followed 10 times that session.
 *
 * With the room parsed: Armory -n-> Arena, the Dressing Room is an honest
 * unexplained arrival (a teleport), and its "ne" into the Eye of the Temple
 * links normally. The Arena itself lists no exit, so no way back is
 * inferred out of it (a phantom "s" to the Armory, which the load cleanse
 * cannot judge: an empty exit union reads as "unknown" there).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RoomParser, type RoomParserEvent } from '../../src/lib/roomParser';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// --- The hex parser: a room without exits is still not a hex -------------
{
  const events: RoomParserEvent[] = [];
  const p = new RoomParser((e) => events.push(e));
  p.feedLine('There are no obvious exits.');
  check(
    events.length === 1 && events[0].type === 'town-room',
    `RoomParser: "There are no obvious exits." is a town-room event (got ${JSON.stringify(events)})`
  );
}

// --- The Arena sequence through the replay engine -------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-exits-'));
/** A session log from `|`-prefixed server lines and `>> ` input: each input
 *  line one second after the previous, server output stamped with its
 *  command's second (as the real log is: the Dressing Room arrived 10 s
 *  after the "n", inside the queue's 20 s expiry) */
function sessionLog(text: string): string {
  let t = Date.UTC(2026, 6, 1, 9, 51, 0);
  const lines = text.split('\n').map((raw) => {
    if (raw.startsWith('>> ')) t += 1000;
    const d = new Date(t);
    const h = d.getUTCHours();
    const stamp =
      `[2026-07-01 ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}:` +
      `${String(d.getUTCSeconds()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}]`;
    return `${stamp} ${raw.replace(/^\s*\|/, '')}`;
  });
  const f = path.join(dir, 'session_2026-07-01T15-45-27-282.log');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

// session_2026-07-01T15-45-27-282.log:3456-3510 (the fight shortened)
const ARMORY = `|Arena Armory
|A small, square stone chamber where the challengers may prepare themselves for
|battle.  On one wall is a rack holding many sorts of weapons and shields.  It is
|shadowy.
|There is one obvious exit: north.`;
const ARENA = `|Arena
|A large circular area with high stone walls.  The ground is covered in well
|raked sand and overhead is what appears to be a leaden sky from which a
|directionless light seems to shine.  It is shadowy.
|There are no obvious exits.`;
const DRESSING = `|Dressing Room
|This is a small, square chamber where a challenger may collect his possessions
|after a challenge.  There is a large sign on the wall.  It is shadowy.
|There is one obvious exit: northeast.`;
const EYE = `|Eye of the Temple
|The center of the temple is timeworn, but the power here is as deep as the bones
|of the earth.  This chamber is octagonal with a high, corbelled vault overhead.
|Each of the walls is carved in deep bas relief, and torches burn in brackets
|shedding a flickering red light.  It is bright.
|There are three exits: south, north, and northwest.`;
const log = `${ARMORY}
>> take longsword
|You take an iron longsword from the rack.
>> l
${ARMORY}
>> n
${ARENA}
|Felis the Lynx Champion incarnate.
>> k felis
|You attack Felis the Lynx Champion incarnate.
|Felis died!
|A disembodied voice snarls into your ear: "Victory is yours, Mazorn the Lynx Champion!"
>> l
${ARENA}
|an iron war hammer, and a leather heater shield.
|You drop an iron longsword.
|You are transported back to the mortal plane.
${DRESSING}
|a mysterious bag labeled 'Mazorn'.
>> l
${DRESSING}
>> ne
${EYE}
|a large altar (embedded with axes).`;

const kinds: string[] = [];
const r = new TownReplay(
  { expand: (raw) => [raw] },
  { onBlock: ({ block, res }) => kinds.push(`${block.name}:${res.kind}`) }
);
r.replayLog(sessionLog(log));
const rooms = [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
const one = (name: string) => rooms.filter((x) => x.name === name);
const armory = one('Arena Armory')[0];
const arena = one('Arena');
const dressing = one('Dressing Room');
const eye = one('Eye of the Temple');

check(r.stats.lostBlocks === 0, `every exits line yields a block (lost ${r.stats.lostBlocks})`);
check(
  kinds.join(' ') ===
    'Arena Armory:entered Arena Armory:stationary Arena:new-room Arena:stationary ' +
      'Dressing Room:jumped Dressing Room:stationary Eye of the Temple:new-room',
  `resolutions: ${kinds.join(' ')}`
);
check(arena.length === 1, `one Arena room (got ${arena.length})`);
check(
  !!armory && arena.length === 1 && armory.links.n === arena[0].id,
  `Arena Armory -n-> Arena (Armory links ${JSON.stringify(armory?.links)})`
);
check(
  !!armory && dressing.length === 1 && armory.links.n !== dressing[0].id,
  'no false Arena Armory -n-> Dressing Room link'
);
check(
  arena.length === 1 && arena[0].exits.length === 0 && Object.keys(arena[0].links).length === 0,
  `the Arena lists no exit and gets no inferred way back (links ${JSON.stringify(arena[0]?.links)})`
);
check(
  dressing.length === 1 && eye.length === 1 && dressing[0].links.ne === eye[0].id,
  `Dressing Room -ne-> Eye of the Temple (links ${JSON.stringify(dressing[0]?.links)})`
);
check(r.townLocalizer.pendingMoves.length === 0, 'nothing left queued');

fs.rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`${failures} no-exits assertion(s) failed`);
  process.exit(1);
}
console.log('PASS: rooms without exits — parsed, linked, no phantom way back, hex town-room event');
