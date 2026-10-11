/**
 * Regression test: bare exit words are moves where the room lists them.
 *
 * DartMUD exits lists name non-directional exits — "hole", "path", "pool",
 * "mudschool", a door "leading backroom" — and typing the word walks it.
 * The parser knew only back/out/exit and the command classifier only its
 * fixed verbs, so `hole` out of Syphe's Gem Shop (after "move mat" uncovers
 * it) was never queued: Main Entrance became a "jumped" floater with no
 * route from the shop, and the way back up was a relocalization
 * (session_2026-07-05T15-39-35-835.log:2935-2960, 3176-3191).
 *
 * A word is a move only where a room the command may run in offers it —
 * the current room, or any room the queued moves lead to over known links
 * (a walk sends its next step before the previous one is confirmed; Bill
 * types ahead; a queued move may fail). A room offers the words its latest
 * exits line lists and the ones it was walked through (the shop stops
 * listing "hole" once you come back up it). A word that then fails draws
 * "What ?", which pops it. A movement verb may lead it ("lead hole");
 * DartMUD is case-sensitive ("Hole" is no command).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';
import { TownMapStore } from '../../src/lib/townMap';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { TownReplay } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const SHOP = `|Syphe's Gem Shop
|A small, plain shop, dealing in wares most extravagant.  Syphe's goods are not
|on display, but she will graciously show you her 'list'  It is bright.`;
const SHOP_EXITS = '|There are two exits: back and south.';
const SHOP_HOLE = '|There are three exits: back, south, and hole.';
const ENTRANCE = `|Main Entrance
|This is the old main entrance to Lower Segliz. To the east you see stairs
|leading upward. The stairs are boarded up with a hole roughly cut into the
|boards. Engravings cover the walls. To the south, the path opens slightly.  It
|is well lit.
|There are two exits: hole and south.`;
const LOWER_MAIN = `|Lower Main
|This is the main corridor of Lower Segliz. Light filters in from the east. To
|the west, the corridor opens up a bit.  It is bright.
|There are three exits: north, east, and west.`;

// --- The real sequence through the replay engine ---------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-words-'));
function sessionLog(text: string): string {
  let t = Date.UTC(2026, 6, 5, 14, 9, 40);
  const lines = text.split('\n').map((raw) => {
    if (raw.startsWith('>> ')) t += 1000;
    const d = new Date(t);
    const h = d.getUTCHours();
    const stamp =
      `[2026-07-05 ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}:` +
      `${String(d.getUTCSeconds()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}]`;
    return `${stamp} ${raw.replace(/^\s*\|/, '')}`;
  });
  const f = path.join(dir, 'session_2026-07-05T15-39-35-835.log');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
{
  const log = `${SHOP}
${SHOP_EXITS}
|Syphe the gemcutter.
>> move mat
|You move the mat to reveal a hole in the boards.
>> l
${SHOP}
${SHOP_HOLE}
|Syphe the gemcutter.
>> hole
${ENTRANCE}
>> s
${LOWER_MAIN}
>> n
${ENTRANCE}
>> hole
${SHOP}
${SHOP_EXITS}
|Syphe the gemcutter.
>> move mat
|You move the mat to reveal a hole in the boards.
>> hole
${ENTRANCE}`;
  const kinds: string[] = [];
  const r = new TownReplay(
    { expand: (raw) => [raw] },
    { onBlock: ({ block, res }) => kinds.push(`${block.name}:${res.kind}`) }
  );
  r.replayLog(sessionLog(log));
  const rooms = [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  const shop = rooms.filter((x) => x.name === "Syphe's Gem Shop");
  const entrance = rooms.filter((x) => x.name === 'Main Entrance');
  // The last trip down (a synthetic continuation: Bill always looked after
  // "move mat", session_2026-07-25T20-28-24-529.log:2140-2149) leaves from
  // the shop as last printed, without "hole": the walked hole still counts —
  // the word is tracked and its block expected (it was "corrected"), as
  // when a walk routes through the hole
  check(
    kinds.join(' ') ===
      "Syphe's Gem Shop:entered Syphe's Gem Shop:stationary Main Entrance:new-room " +
        "Lower Main:new-room Main Entrance:expected Syphe's Gem Shop:expected " +
        'Main Entrance:expected',
    `resolutions: ${kinds.join(' ')}`
  );
  check(shop.length === 1 && entrance.length === 1, 'one shop, one entrance');
  check(
    shop[0]?.namedLinks.hole === entrance[0]?.id && entrance[0]?.namedLinks.hole === shop[0]?.id,
    `Gem Shop <-[hole]-> Main Entrance (${JSON.stringify(shop[0]?.namedLinks)} / ${JSON.stringify(entrance[0]?.namedLinks)})`
  );
  check(
    entrance[0]?.namedExits.join() === 'hole',
    `the entrance lists its exit word (namedExits [${entrance[0]?.namedExits}])`
  );
  const town = r.townMap.get(r.townMap.pos!.townId)!;
  const route = r.townMap.findPath(
    town,
    shop[0].id,
    rooms.find((x) => x.name === 'Lower Main')!.id
  );
  check(
    route?.map((s) => s.cmd).join() === 'hole,s',
    `walkable: shop -> Lower Main = ${JSON.stringify(route?.map((s) => s.cmd))}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Which room's words count ---------------------------------------------
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(exits),
});
const B_SHOP = block(
  "Syphe's Gem Shop",
  'There are three exits: back, south, and hole.',
  "A small, plain shop, dealing in wares most extravagant.  Syphe's goods are not on display."
);
const B_ENTRANCE = block(
  'Main Entrance',
  'There are two exits: hole and south.',
  'This is the old main entrance to Lower Segliz. To the east you see stairs leading upward.'
);
const B_LOWER = block(
  'Lower Main',
  'There are three exits: north, east, and west.',
  'This is the main corridor of Lower Segliz. Light filters in from the east.'
);
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 1_000_000;
  loc.onRoomBlock(B_SHOP, null, t);
  check(loc.trackCommand('Hole', (t += 500)) === false, '"Hole" (capitalized) is no move');
  check(loc.trackCommand('hole', (t += 500)), 'a word the current room lists is a move');
  loc.onRoomBlock(B_ENTRANCE, null, (t += 300));
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(B_LOWER, null, (t += 300));
  check(
    loc.trackCommand('hole', (t += 500)) === false,
    'Lower Main lists no "hole": the word is no move there'
  );
  // a walk pipelines "n" + "hole": the hole is in the room "n" leads to
  check(loc.trackCommand('n', (t += 100)), 'n queued');
  check(loc.trackCommand('hole', (t += 100)), 'the queued "n" leads to a room listing "hole"');
  const q = loc.pendingMoves.map((m) =>
    m.kind === 'named' ? m.cmd : m.kind === 'dir' ? m.dir : 'l'
  );
  check(q.join() === 'n,hole', `queue [${q}]`);
  loc.onRoomBlock(B_ENTRANCE, null, (t += 300));
  const back = loc.onRoomBlock(B_SHOP, null, (t += 300));
  check(
    back.kind === 'expected' && back.moved?.kind === 'named' && back.moved.cmd === 'hole',
    `the walked hole resolves expected (${back.kind}, ${JSON.stringify(back.moved)})`
  );
  // an unknown link stops the prediction: "w" from the entrance's south room
  // was never walked, so nothing says where "hole" would run
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(B_ENTRANCE, null, (t += 300));
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(B_LOWER, null, (t += 300));
  loc.trackCommand('w', (t += 100));
  check(
    loc.trackCommand('hole', (t += 100)) === false,
    'no word move past an unwalked exit (the queue cannot say where it runs)'
  );
}
{
  // a movement verb leads the word like "lead out"
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(B_SHOP, null, 2_000_000);
  check(loc.trackCommand('lead hole', 2_000_500), '"lead hole" is a move');
  const m = loc.pendingMoves[0];
  check(
    m?.kind === 'named' && m.cmd === 'hole' && m.verb === 'lead',
    `recorded bare with its verb (${JSON.stringify(m)})`
  );
  check(loc.trackCommand('look hole', 2_000_600) === false, '"look hole" is no move');
}
{
  // Every room the command may run in counts, not just the last one: the
  // current room lists "hole" while a queued "s" leads to a room without it.
  // Whether "hole" runs in the shop depends on the "s" (it may fail), so
  // the word is tracked — and when it does reach the street, DartMUD's
  // "What ?" pops it, so the next move lines up again
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 3_000_000;
  const STREET = block(
    'Main Street',
    'There are four exits: west, north, east, and a closed red door leading south.',
    'This is the main street of Segliz. To the north you see a small shop.  To the south lies a tall, red tower.'
  );
  loc.onRoomBlock(B_SHOP, null, t);
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(STREET, null, (t += 300));
  loc.trackCommand('n', (t += 500));
  loc.onRoomBlock(B_SHOP, null, (t += 300)); // shop -s-> street is a known link now
  check(loc.trackCommand('s', (t += 500)), 's queued');
  check(loc.trackCommand('hole', (t += 100)), 'the current room lists "hole": tracked');
  check(
    loc.onRoomBlock(STREET, null, (t += 300)).kind === 'expected',
    'the "s" arrives on the street'
  );
  check(loc.onUnknownCommand(), '"What ?" on the street fails the queued "hole"');
  check(loc.pendingMoves.length === 0, `queue empty (${loc.pendingMoves.length})`);
  loc.trackCommand('w', (t += 500));
  check(
    loc.onRoomBlock(
      block(
        'Main Street, West End',
        'There are three exits: north, south, and east.',
        "This is the western end of Segliz's main street.  Mystic Way intersects it here."
      ),
      null,
      (t += 300)
    ).kind === 'new-room',
    'the next move lines up'
  );
}
{
  // A queued look moves no one: the prediction steps over it
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  let t = 4_000_000;
  loc.onRoomBlock(B_ENTRANCE, null, t);
  loc.trackCommand('s', (t += 500));
  loc.onRoomBlock(B_LOWER, null, (t += 300));
  loc.trackCommand('l', (t += 500));
  loc.trackCommand('n', (t += 100));
  check(loc.trackCommand('hole', (t += 100)), 'look, n, hole: "n" leads to a room listing "hole"');
}

if (failures > 0) {
  console.error(`${failures} exit-word assertion(s) failed`);
  process.exit(1);
}
console.log(
  'PASS: bare exit words — tracked where offered (listed or walked; current or queue-predicted room), verbs, case'
);
