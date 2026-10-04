/**
 * Regression test: a login starts the town engine over (Oct 2026 deep dive,
 * commands / identity lenses — the engine part of the login race).
 *
 * At a login line ("Running under version ..." / "You are already playing,
 * reconnecting to old object") the server session starts over: commands
 * still queued from before are void, transit lines announced arrivals that
 * never came, and the login burst's room is where DartMUD put the player —
 * an entry, matched against the persisted position (resume). The live app
 * must call TownLocalizer.onLogin at that line, before the burst; the
 * replay engine does.
 *
 *  A. session_2026-07-04T00-44-41-433.log:612-1191: Mazorn idles in the
 *     Bone Pit's Cave, the session is taken over elsewhere, and the
 *     reconnect at :1131 finds him out on the mountainside; his first
 *     survey is open ocean (`swim se`). Still "inside" the Cave, the engine
 *     took that survey as walking out of the Cave and taught the ocean hex
 *     as the Cave's exit anchor.
 *  B. A reconnect re-printing the room the player was in: an entry (resume)
 *     — no move typed before it claims it.
 *  C. What onLogin clears: the queue, active / lost, a pending exit anchor
 *     and every pending transit (portal, teleport, a dark arrival — after a
 *     transit too); the teleport return memory is map data and stays.
 *  D. A character switch: the localizer that resolves the login burst is
 *     reset at the login line — the new character's, or (the --switch-late
 *     race model) the previous character's, the new one being reset in
 *     turn when its stores take over.
 */
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';
import { TownLocalizer, type TownResolution } from '../../src/lib/townLocalizer';
import { TownMapStore } from '../../src/lib/townMap';
import { makeExpander } from '../lib/replayInput';
import { SessionFixture } from '../lib/sessionFixture';
import { TownReplay, type BlockEvent } from '../lib/townReplay';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const expand = makeExpander([]);
const fx = new SessionFixture('login-reset-');
function replay(text: string) {
  const blocks: BlockEvent[] = [];
  const r = new TownReplay({ expand: (raw) => expand(raw) }, { onBlock: (ev) => blocks.push(ev) });
  r.replayLog(fx.write(text));
  const rooms = () => [...r.townMap.towns.values()].flatMap((t) => [...t.rooms.values()]);
  return { r, blocks, rooms };
}

// --- A: the reconnect out on the ocean -------------------------------------------
const CAVE = `|Cave
|This is a natural cleft in the rock which forms a tall, narrow cave which goes
|back for some distance.  The floor is littered with pieces of bone and heaps of
|what looks like garbage are piled near the wall.  It is well lit.
|There is one obvious exit: out.
|a disgusting carrion demon.`;
// session_2026-07-04T00-44-41-433.log:1169-1192, verbatim
const OCEAN = String.raw`|You gaze at your surroundings.
|              -----               #) a fortress on a crag.
|             /~  ~~\
|        -----  ~  ~~-----
|       /  ~~ \ ~~  /  ~~ \
|  -----~~  ~  -----~~  ~  -----
| /~~ ~~\~~  ~/~~ ~~\~~  ~/ ~  ~\
|-  ~  ~~-----  ~  ~~-----~ ~~  ~-
| \  ~  / ^^ ^\  ~  / ~~ ~\  ~~ /
|  -----^ ^#^ ^-----~  ~  ~-----
| / ~~  \^ ^^^/  ~  \~  ~ / ~  ~\
|-~  ~~  -----~~  ~  -----~ ~~  ~-
| \~  ~~/ ~~ ~\~~ ~~/ ~~  \  ~~ /
|  -----~  ~  ~-----~  ~~ ~-----
| /~~  ~\~  ~ / ~~ ~\~  ~ /x xx \
|-  ~~ ~~-----~  ~  ~----- xx xx -
| \  ~  / ~~ ~\~  ~ /~~  ~\ xx x/
|  -----~  ~  ~-----  ~~ ~~-----
|       \~  ~ /~  ~~\  ~  /
|        -----  ~  ~~-----
|             \ ~~  /
|              -----
|This is a large expanse of ocean.  It is raining.    It is extremely light here.`;
{
  const h = replay(
    [
      '|Running under version 3.2.10-dev.608.',
      '|You are Mazorn the spyder.  You are a middle aged spyder.',
      CAVE,
      '@9000',
      '|Name: ',
      '|Password: ',
      '|You are already playing, reconnecting to old object.',
      '|You are on the side of a rocky mountain.  Rain is making the rock somewhat',
      '|> You are Mazorn the spyder.  You are a middle aged spyder.',
      '>> swim se',
      OCEAN,
    ].join('\n')
  );
  const anchors = [...h.r.townMap.towns.values()].map((t) => JSON.stringify(t.anchors));
  check(
    anchors.length === 1 && anchors[0] === '{}',
    `A: the ocean hex is no exit anchor of the Cave (${anchors})`
  );
}

// --- B: a reconnect re-printing the room -------------------------------------------
{
  const STABLE = `|Stable
|This area is used to house mounts and beasts of burden.  Wooden partitions
|separate the area into stalls and wooden gates prevent the animals from
|wandering.  It is bright.
|There are four exits: north, west, east, and south.`;
  const h = replay(
    [
      '|Running under version 3.2.10-dev.608.',
      '|You are Mazorn the spyder.  You are a middle aged spyder.',
      STABLE,
      '>> n',
      '@5',
      '|You are already playing, reconnecting to old object.',
      STABLE,
      '|> You are Mazorn the spyder.  You are a middle aged spyder.',
    ].join('\n')
  );
  const kinds = h.blocks.map((b) => b.res.kind as TownResolution['kind']);
  check(
    JSON.stringify(kinds) === '["entered","entered"]',
    `B: the reconnect's room is an entry (${kinds})`
  );
  check(!!h.blocks[1] && !h.blocks[1].wasActive, 'B: the engine was reset at the login line');
  check(h.rooms().length === 1, `B: no phantom room (${h.rooms().map((x) => x.name)})`);
  check(Object.keys(h.rooms()[0]?.links ?? {}).length === 0, 'B: no link');
  check(h.r.townLocalizer.pendingMoves.length === 0, 'B: the dead move is gone');
}
// --- C: what onLogin clears ------------------------------------------------------
const block = (name: string, exits: string, desc: string): TownRoomBlock => ({
  name,
  descFirst: desc,
  desc,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});
const STREET = block(
  'Main Street',
  'north and south',
  'A muddy street runs north between low houses.'
);
const SQUARE = block(
  'Town Square',
  'north and south',
  'A cobbled square with a well in its middle.'
);
/** A store whose current room has a word-identical twin in another town: only
 *  a resume finds it (a fresh entry's global match is ambiguous: new town) */
function twinned(room: TownRoomBlock) {
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(room, null, 1_000); // entered: town 0, room 0
  map.addRoom(map.createTown('Twin'), room, 5, 5, 0, 0);
  return { map, loc };
}
{
  const { map, loc } = twinned(STREET);
  const ooc = map.createTown('OOC');
  const hall = map.addRoom(ooc, block('OOC Entry Hall', 'north and south', 'A hall.'), 0, 0, 0, 0);
  map.teleportReturn = { townId: ooc.id, roomId: hall.id };
  loc.trackCommand('n', 1_100);
  loc.trackCommand('look', 1_200);
  loc.onTeleport(); // a transit line no arrival followed (the link died)
  loc.onLogin();
  check(!loc.active && !loc.lost, 'C: inactive, not lost');
  check(loc.pendingMoves.length === 0, 'C: queue cleared');
  check(!loc.trackCommand('n', 2_000), 'C: nothing queues before the login burst');
  const res = loc.onRoomBlock(STREET, null, 3_000);
  check(
    res.kind === 'entered' && res.pos?.townId === 0 && res.pos.roomId === 0,
    `C: the burst's room is a resume, not a teleport arrival (${res.kind} ${JSON.stringify(res.pos)})`
  );
  check(map.towns.size === 3, `C: no new town (${map.towns.size})`);
  check(
    map.teleportReturn?.townId === ooc.id && map.teleportReturn.roomId === hall.id,
    `C: the teleport return memory survives (${JSON.stringify(map.teleportReturn)})`
  );

  // A pending portal transit: the burst's room resumes too
  const t2 = twinned(SQUARE);
  t2.loc.onPortalTransit('north');
  t2.loc.onLogin();
  const r2 = t2.loc.onRoomBlock(SQUARE, null, 2_000);
  check(
    r2.kind === 'entered' && r2.pos?.townId === 0 && t2.map.towns.size === 2,
    `C: no portal arrival after a login (${r2.kind}, ${t2.map.towns.size} towns)`
  );

  // A portal into an unlit room before the login: no fresh entry either
  const t4 = twinned(SQUARE);
  t4.loc.onPortalTransit('north');
  t4.loc.onDarkArrival(1_500);
  t4.loc.onLogin();
  const r4 = t4.loc.onRoomBlock(SQUARE, null, 2_000);
  check(
    r4.kind === 'entered' && r4.pos?.townId === 0 && t4.map.towns.size === 2,
    `C: the burst's room resumes after a dark transit arrival (${r4.kind}, ${t4.map.towns.size} towns)`
  );

  // A dark step into the unknown before the login: no one-shot correlation
  const map3 = new TownMapStore();
  const loc3 = new TownLocalizer(map3);
  loc3.onRoomBlock(STREET, null, 1_000);
  loc3.trackCommand('s', 1_100);
  loc3.onDarkArrival(1_200);
  loc3.onLogin();
  const r3 = loc3.onRoomBlock(STREET, null, 2_000);
  check(r3.kind === 'entered', `C: the burst's room resumes after a dark step (${r3.kind})`);
}

// --- D: which localizer a character switch resets ------------------------------------
{
  // Typed at the Name: prompt (the late-switch race applies to typed names)
  const SWITCH = [
    '|Running under version 3.2.10-dev.608.',
    '|You are Mazorn the spyder.  You are a middle aged spyder.',
    '|Stable\n|A stable with stalls for the horses and a loft above.  It is bright.\n|There is one obvious exit: north.',
    '|Saving Mazorn.',
    '|Name: ',
    '>> trilok',
    '|Password: ',
    '|Running under version 3.2.10-dev.608.',
    '|You are Trilok the mohnkee.  You are a young mohnkee.',
    '|The Souk\n|This is the southern side of the Souk, the central marketplace.  It is bright.\n|There is one obvious exit: north.',
  ].join('\n');
  const reset = new Set<TownLocalizer>();
  const orig = TownLocalizer.prototype.onLogin;
  TownLocalizer.prototype.onLogin = function (this: TownLocalizer) {
    reset.add(this);
    orig.call(this);
  };
  for (const switchLate of [false, true]) {
    reset.clear();
    let souk: TownLocalizer | undefined;
    const r: TownReplay = new TownReplay(
      { expand: (raw) => expand(raw), switchLate },
      {
        onBlock: ({ block }) => {
          if (block.name === 'The Souk') souk = r.townLocalizer;
        },
      }
    );
    r.replayLog(fx.write(SWITCH));
    const mode = switchLate ? 'late switch' : 'switch';
    check(r.char === 'trilok', `D (${mode}): Trilok's stores are live (${r.char})`);
    check(
      !!souk && reset.has(souk),
      `D (${mode}): the localizer that resolved the burst was reset at the login`
    );
    check(reset.has(r.townLocalizer), `D (${mode}): Trilok's own localizer starts after a login`);
  }
  TownLocalizer.prototype.onLogin = orig;
}

fx.remove();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('test-login-reset: all checks passed');
