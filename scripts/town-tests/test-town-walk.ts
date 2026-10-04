/**
 * Regression test: the town walk executor (src/lib/townWalk.ts) — Oct 2026
 * deep dive, walking lens, app-wiring stage. Each scenario drives the real
 * executor against the real TownLocalizer and TownMapStore; the walk's own
 * sends are tracked the way useMapTracker tracks them (executor first, then
 * the localizer), and replies come back as room blocks or server lines
 * through the shared dispatcher (townLineEvents.ts).
 *
 *  A. A look mid-walk is no manual movement, and its reply (a re-print of the
 *     room) is no step: typing "l" stopped 12 corpus walks. A real move
 *     typed mid-walk, and an exit word the room offers, still stop it.
 *  B. One step's commands go out at a time: a confirmation that arrives
 *     while a step is still being sent starts no second send chain.
 *  C. A door step waits for the room before it, and the step after a door
 *     waits for the crossing (10 of 1,485 corpus door sequences bounced; the
 *     pipelined next move then ran from the wrong room). Each door is named
 *     by its own noun on each side: "open n gate" / "close s gate", "open d
 *     trapdoor" / "close u trapdoor" ("door" finds neither), a pair of doors
 *     by "door". A door standing open is walked through and left open — and
 *     the next step still waits for the crossing.
 *  D. A step is confirmed only in the walk's own town (room ids are per-town
 *     counters).
 *  E. No walk starts while a move sent under 3 s ago is unanswered; an older
 *     one, or a look, doesn't stop it. A click on another room stops a walk
 *     under way; a click on its own destination, or on a room with no known
 *     route, leaves it going. The hex walk is stopped only by a walk that
 *     starts.
 *  F. A merge stops the walk only when the walk's town was merged away.
 *  G. "You are already there." for a walk to the room the player is in.
 *  H. buildDoorSequence: the /door built-in still says "door"; door nouns map
 *     to the word the server answers to; "/door constructor" sends nothing.
 *  I. Whether a step crosses a door is read at send time from the room it
 *     leaves: a door the saved map remembers but the fresh exits line no
 *     longer shows is walked through plainly.
 *  J. While the client holds sends (the action blocker, during a cast) the
 *     walk sends nothing and does not time out; it goes on when released.
 *     Queued behind the blocker, steps counted as sent and were later
 *     released as "manual movement". The step timeout runs from the moment
 *     a step goes out: a cast ending in the last moments of the 8 s window
 *     used to stop the walk with "no response from the MUD", before its
 *     step had gone out or before the reply could arrive. A cast that starts
 *     after a step went out does not stretch that step's window. A block
 *     that starts while a door sequence goes out holds the rest of the
 *     sequence (queued, its move went out later as the player's); a move the
 *     player typed during the cast still stops the walk; nothing answers the
 *     held step before its move goes out.
 *  K. A step into an unlit room ("It is pitch black.") is confirmed by the
 *     localizer's blind advance along the walked link; a dark step it
 *     cannot follow stops the walk; a look into darkness is no step.
 *  L. Transits and forced moves stop the walk; a "What ?" that fails one of
 *     the walk's steps stops it at once (it used to wait out the 8 s step
 *     timeout). A block that loses the position stops it.
 *  M. A walk cancelled while a door sequence goes out stops short of the
 *     move; once the move is out, the door behind is still closed and locked.
 *  N. A step nobody answers times out.
 */
import { buildDoorSequence, doorCommandNoun } from '../../src/lib/doorSequence';
import { dispatchTownLine } from '../../src/lib/townLineEvents';
import { TownLocalizer, type TownResolution } from '../../src/lib/townLocalizer';
import { TownMapStore, type TownRoom } from '../../src/lib/townMap';
import { parseTownExits, type TownDir, type TownRoomBlock } from '../../src/lib/townParser';
import { TownWalkExecutor } from '../../src/lib/townWalk';
import { WALK_STEP_TIMEOUT } from '../../src/lib/walkPacing';
import { FakeTimers } from '../lib/fakeTimers';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `${name} is a room of the keep, described at a usable length.`,
  desc: `${name} is a room of the keep, described at a usable length.  It is bright.`,
  exits: parseTownExits(exits),
});

/** Let the executor's send chains run (they await each send) */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

type RoomSpec = [name: string, x: number, y: number, z: number, exits: string];

/** A town, a localizer standing in `start`, and an executor wired like the hook */
function setup(rooms: RoomSpec[], links: [string, TownDir, string][], start: string) {
  const map = new TownMapStore();
  const town = map.createTown('Keep');
  const byName = new Map<string, TownRoom>();
  for (const [name, x, y, z, exits] of rooms) {
    byName.set(name, map.addRoom(town, block(name, exits), x, y, z, 0));
  }
  const room = (name: string) => byName.get(name)!;
  for (const [from, dir, to] of links) map.link(town, room(from), dir, room(to));
  const loc = new TownLocalizer(map);
  loc.active = true;
  map.pos = { townId: town.id, roomId: room(start).id };
  const h = {
    map,
    town,
    room,
    loc,
    now: 100_000,
    sent: [] as string[],
    echoes: [] as string[],
    /** The action blocker holds sends (a cast is running) */
    held: false,
    /** What the blocker queued while held (App's sendCommandRef); `own`:
     *  the walk sent it */
    queued: [] as { cmd: string; own: boolean }[],
    /** When set, every send waits until released (see release) */
    gated: false,
    waiting: [] as (() => void)[],
    inFlight: 0,
    maxInFlight: 0,
    starts: 0,
    timers: null as unknown as FakeTimers,
    exec: null as unknown as TownWalkExecutor,
    /** A room block arrives */
    arrive(name: string, exits: string): TownResolution {
      const res = loc.onRoomBlock(block(name, exits), null, h.now);
      h.exec.onResolution(res);
      return res;
    },
    /** A server line the town engine reads directly */
    line(text: string): void {
      const events = dispatchTownLine(text, loc, h.now);
      if (events.length > 0) h.exec.onLineEvents(events);
    },
    /** A command goes out past the blocker, tracked (App's sendReleasedRef) */
    track(cmd: string): void {
      // useMapTracker.trackCommand: the executor sees the send first, then
      // the localizer tracks it
      h.exec.onCommand(cmd, h.now);
      loc.trackCommand(cmd, h.now);
    },
    /** The player types a command (the blocker queues it while held) */
    type(cmd: string): void {
      if (h.held) h.queued.push({ cmd, own: false });
      else h.track(cmd);
    },
    /** The cast ends: the blocker sends what it queued */
    unblock(): void {
      h.held = false;
      for (const { cmd, own } of h.queued.splice(0)) {
        h.track(cmd);
        if (own) h.sent.push(cmd);
      }
    },
    release(): void {
      h.waiting.shift()?.();
    },
    /** 10 ms of time passes: due timers fire, send chains run */
    async tick(): Promise<void> {
      h.now += 10;
      h.timers.run();
      await settle();
    },
    async advanceTo(t: number): Promise<void> {
      while (h.now < t) await h.tick();
    },
    stopped: () => h.echoes.filter((e) => e.startsWith('[Map] Walk stopped')),
  };
  h.timers = new FakeTimers(() => h.now);
  h.exec = new TownWalkExecutor({
    map: () => map,
    localizer: () => loc,
    send: async (cmd) => {
      if (h.held) {
        // Queued behind the blocker, tracked only when released
        h.queued.push({ cmd, own: true });
        return;
      }
      h.track(cmd);
      h.sent.push(cmd);
      h.inFlight++;
      h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
      if (h.gated) await new Promise<void>((resolve) => h.waiting.push(resolve));
      h.inFlight--;
    },
    doorKeys: () => 2,
    sendsHeld: () => h.held,
    indoors: () => true,
    echo: (m) => h.echoes.push(m),
    changed: () => {},
    starting: () => h.starts++,
    now: () => h.now,
    timers: h.timers,
  });
  return h;
}

// A straight corridor
const corridor: RoomSpec[] = [
  ['Hall', 0, 0, 0, 'There is one obvious exit: east.'],
  ['Gallery', 1, 0, 0, 'There are two exits: west and east.'],
  ['Study', 2, 0, 0, 'There are two exits: west and east.'],
  ['Library', 3, 0, 0, 'There is one obvious exit: west.'],
];
const corridorLinks: [string, TownDir, string][] = [
  ['Hall', 'e', 'Gallery'],
  ['Gallery', 'e', 'Study'],
  ['Study', 'e', 'Library'],
];
const WE = 'There are two exits: west and east.';

// --- A: a look mid-walk; real moves still stop it ----------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  check(h.exec.start(h.room('Library').id), 'A: the walk starts');
  await settle();
  check(h.sent.join() === 'e,e', `A: two steps in flight (${h.sent.join()})`);
  h.type('l');
  check(h.exec.active, 'A: a typed look does not stop the walk');
  h.arrive('Gallery', WE);
  await settle();
  check(h.sent.join() === 'e,e,e', `A: the third step goes out (${h.sent.join()})`);
  h.arrive('Study', WE);
  const look = h.arrive('Study', WE); // the look's reply: a re-print
  check(look.kind === 'stationary' && look.moved?.kind === 'look', "A: the look's reply");
  check(h.exec.active, 'A: ... is no step: the walk goes on');
  h.arrive('Library', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.'), `A: arrived (${h.echoes.join(' | ')})`);
  check(h.stopped().length === 0, `A: never stopped (${h.stopped().join(' | ')})`);
}
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Library').id);
  await settle();
  h.type('w');
  check(!h.exec.active, 'A: a typed move stops the walk');
  check(h.stopped().join() === '[Map] Walk stopped: manual movement', 'A: ... as manual movement');
}
{
  const h = setup(
    [
      ['Gem Shop', 0, 0, 0, 'There are two exits: west and hole.'],
      ['Street', -1, 0, 0, 'There are two exits: west and east.'],
      ['Corner', -2, 0, 0, 'There is one obvious exit: east.'],
    ],
    [
      ['Gem Shop', 'w', 'Street'],
      ['Street', 'w', 'Corner'],
    ],
    'Gem Shop'
  );
  h.exec.start(h.room('Corner').id);
  await settle();
  h.type('hole'); // an exit word the shop offers: a move
  check(!h.exec.active, 'A: an exit word the room offers stops the walk');
}

// --- B: one step's commands at a time -----------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.gated = true;
  h.exec.start(h.room('Study').id);
  await settle();
  check(h.sent.join() === 'e', 'B: the first step is going out');
  h.arrive('Gallery', WE); // confirmed while its send is still in flight
  await settle();
  check(h.sent.join() === 'e', `B: no second send chain while one runs (${h.sent.join()})`);
  h.release();
  await settle();
  check(h.sent.join() === 'e,e', `B: the next step follows the chain (${h.sent.join()})`);
  h.release();
  await settle();
  h.arrive('Study', WE);
  check(h.maxInFlight === 1, `B: never two sends in flight (${h.maxInFlight})`);
  check(h.echoes.includes('[Map] Arrived.'), 'B: arrived');
}

// --- C: door holds and door nouns ---------------------------------------------------
const gateRooms: RoomSpec[] = [
  ['Hall', 0, 0, 0, 'There is one obvious exit: east.'],
  ['Gallery', 1, 0, 0, 'There are three exits: west, east, and a closed iron gate leading north.'],
  ['Garden', 1, -1, 0, 'There are two exits: a closed iron gate leading south and east.'],
  ['Arbor', 2, -1, 0, 'There is one obvious exit: west.'],
];
const gateLinks: [string, TownDir, string][] = [
  ['Hall', 'e', 'Gallery'],
  ['Gallery', 'n', 'Garden'],
  ['Garden', 'e', 'Arbor'],
];
{
  const h = setup(gateRooms, gateLinks, 'Hall');
  h.exec.start(h.room('Arbor').id);
  check(
    h.echoes.includes('[Map] Walking 3 rooms (1 door)...'),
    `C: banner (${h.echoes.join(' | ')})`
  );
  await settle();
  check(h.sent.join() === 'e', `C: the door step waits for the Gallery (${h.sent.join()})`);
  h.arrive('Gallery', 'There are three exits: west, east, and a closed iron gate leading north.');
  await settle();
  const gate = [
    'e',
    'unlock n gate with key',
    'unlock n gate with key 2',
    'open n gate',
    'n',
    'close s gate',
    'lock s gate with key',
    'lock s gate with key 2',
  ];
  check(
    h.sent.join('|') === gate.join('|'),
    `C: the gate is named "gate" on both sides, and the step after it waits (${h.sent.join('|')})`
  );
  h.arrive('Garden', 'There are two exits: an open iron gate leading south and east.');
  await settle();
  check(h.sent[h.sent.length - 1] === 'e', 'C: the crossing confirmed, the next step goes out');
  check(
    JSON.stringify(h.room('Garden').openDoorDirs) === '[]',
    'C: the gate closed behind is recorded closed'
  );
  h.arrive('Arbor', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.'), 'C: arrived through the gate');
}
{
  const h = setup(
    [
      ['Study', 0, 0, 0, 'There are two exits: west and a closed oak trapdoor leading down.'],
      ['Cellar', 0, 0, -1, 'There is one obvious exit: a closed oak trapdoor leading up.'],
    ],
    [['Study', 'd', 'Cellar']],
    'Study'
  );
  h.exec.start(h.room('Cellar').id);
  await settle();
  check(
    h.sent.join('|') ===
      [
        'unlock d trapdoor with key',
        'unlock d trapdoor with key 2',
        'open d trapdoor',
        'd',
        'close u trapdoor',
        'lock u trapdoor with key',
        'lock u trapdoor with key 2',
      ].join('|'),
    `C: a trapdoor is a trapdoor (${h.sent.join('|')})`
  );
}
{
  const h = setup(
    [
      [
        'Assembly Hall',
        0,
        0,
        0,
        'There are two exits: a closed pair of oak doors leading west and east.',
      ],
      ['Bailey', -1, 0, 0, 'There is one obvious exit: a closed pair of oak doors leading east.'],
      ['Messhall', 1, 0, 0, 'There is one obvious exit: west.'],
    ],
    [
      ['Assembly Hall', 'w', 'Bailey'],
      ['Assembly Hall', 'e', 'Messhall'],
    ],
    'Assembly Hall'
  );
  h.exec.start(h.room('Bailey').id);
  await settle();
  check(
    h.sent.slice(0, 3).join('|') ===
      'unlock w door with key|unlock w door with key 2|open w door' &&
      h.sent.includes('close e door'),
    `C: a pair of doors answers to "door" (${h.sent.join('|')})`
  );
  const h2 = setup(
    [
      [
        'Assembly Hall',
        0,
        0,
        0,
        'There are two exits: a closed pair of oak doors leading west and east.',
      ],
      ['Messhall', 1, 0, 0, 'There is one obvious exit: west.'],
    ],
    [['Assembly Hall', 'e', 'Messhall']],
    'Assembly Hall'
  );
  h2.exec.start(h2.room('Messhall').id);
  await settle();
  check(
    h2.sent.join() === 'e',
    `C: the plain exit beside the doors is walked plainly (${h2.sent})`
  );
}
{
  // Each side of a crossing by its own noun: a gate here, a door beyond
  const h = setup(
    [
      ['Gallery', 0, 0, 0, 'There are two exits: west and a closed iron gate leading north.'],
      ['Garden', 0, -1, 0, 'There is one obvious exit: a closed oak door leading south.'],
    ],
    [['Gallery', 'n', 'Garden']],
    'Gallery'
  );
  h.exec.start(h.room('Garden').id);
  await settle();
  check(
    h.sent.join('|') ===
      [
        'unlock n gate with key',
        'unlock n gate with key 2',
        'open n gate',
        'n',
        'close s door',
        'lock s door with key',
        'lock s door with key 2',
      ].join('|'),
    `C: the far side is closed and locked by its own noun (${h.sent.join('|')})`
  );
}
{
  const open = gateRooms.map(
    (r): RoomSpec =>
      r[0] === 'Gallery'
        ? [
            'Gallery',
            1,
            0,
            0,
            'There are three exits: west, east, and an open iron gate leading north.',
          ]
        : r
  );
  const h = setup(open, gateLinks, 'Hall');
  h.exec.start(h.room('Arbor').id);
  await settle();
  h.arrive('Gallery', 'There are three exits: west, east, and an open iron gate leading north.');
  await settle();
  check(
    h.sent.join() === 'e,n',
    `C: an open gate is walked through, nothing else sent (${h.sent})`
  );
  check(!h.sent.some((c) => c.startsWith('close')), 'C: ... and left open');
}

// --- D: confirmation in the walk's own town only ----------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  const other = h.map.createTown('Elsewhere');
  h.exec.start(h.room('Study').id);
  await settle();
  h.exec.onResolution({
    kind: 'expected',
    pos: { townId: other.id, roomId: h.room('Gallery').id },
    moved: null,
  });
  check(!h.exec.active, 'D: the same room id in another town is no confirmation');
  check(
    h.stopped().join() === '[Map] Walk stopped: unexpected movement',
    `D: ... unexpected movement (${h.stopped()})`
  );
}

// --- E: still moving --------------------------------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.loc.trackCommand('e', h.now - 1_000);
  check(!h.exec.start(h.room('Study').id), 'E: a move sent 1 s ago is unanswered: no walk');
  check(h.echoes.join() === '[Map] Still moving...', `E: the player is told (${h.echoes})`);
  check(h.sent.length === 0, 'E: nothing sent');
  const old = setup(corridor, corridorLinks, 'Hall');
  old.loc.trackCommand('e', old.now - 4_000);
  check(old.exec.start(old.room('Study').id), 'E: a move 4 s old does not stop a walk');
  const look = setup(corridor, corridorLinks, 'Hall');
  look.loc.trackCommand('l', look.now - 100);
  check(look.exec.start(look.room('Study').id), 'E: nor does a look');

  // a click during a walk: the walk stops; once its steps land, a click walks
  const w = setup(corridor, corridorLinks, 'Hall');
  w.exec.start(w.room('Library').id);
  await settle();
  w.now += 500;
  check(!w.exec.start(w.room('Gallery').id), 'E: a click mid-walk walks nowhere yet');
  check(
    w.echoes.slice(1).join(' | ') === '[Map] Walk stopped: new destination | [Map] Still moving...',
    `E: ... it stops the walk and asks for a click once the steps land (${w.echoes.join(' | ')})`
  );
  w.arrive('Gallery', WE);
  w.arrive('Study', WE);
  check(w.exec.start(w.room('Hall').id), 'E: with the steps landed, the next click walks');
  check(
    w.starts === 2 && h.starts === 0 && look.starts === 1,
    `E: only a walk that starts stops the hex walk (${w.starts}, ${h.starts}, ${look.starts})`
  );
}
{
  // The walk's own destination clicked again (an impatient double click)
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Library').id);
  await settle();
  h.now += 300;
  check(h.exec.start(h.room('Library').id), "E: a click on the walk's own destination...");
  check(
    h.exec.active && h.echoes.length === 1 && h.sent.join() === 'e,e',
    `E: ... leaves it going, sending nothing more (${h.echoes.join(' | ')}; ${h.sent})`
  );
  // A room no known route reaches
  const loft = h.map.addRoom(h.town, block('Loft', 'There is one obvious exit: down.'), 9, 9, 1, 0);
  check(!h.exec.start(loft.id), 'E: no walk to a room no route reaches...');
  check(
    h.echoes[h.echoes.length - 1] === '[Map] No known route there.' && h.exec.active,
    `E: ... said so, and the walk under way goes on (${h.echoes.join(' | ')})`
  );
  h.arrive('Gallery', WE);
  h.arrive('Study', WE);
  h.arrive('Library', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.') && h.starts === 1, 'E: ... to its destination');
}

// --- F: merges ------------------------------------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  const other = h.map.createTown('Fragment');
  h.exec.start(h.room('Study').id);
  await settle();
  const gallery = { townId: h.town.id, roomId: h.room('Gallery').id };
  const fused = { moved: 2, fused: 1, placed: 1 };
  h.exec.onResolution({
    kind: 'expected',
    pos: gallery,
    moved: null,
    merged: { from: other.id, into: h.town.id, ...fused },
  });
  check(h.exec.active, "F: a fragment merged INTO the walk's town keeps the walk");
  check(h.exec.progress?.remaining === 1, 'F: ... and the step counts');
  h.exec.onResolution({
    kind: 'expected',
    pos: { townId: other.id, roomId: 0 },
    moved: null,
    merged: { from: h.town.id, into: other.id, ...fused },
  });
  check(!h.exec.active, "F: the walk's own town merged away stops it");
  check(h.stopped().join() === '[Map] Walk stopped: map changed', 'F: ... map changed');
}

// --- G: already there --------------------------------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Gallery');
  check(!h.exec.start(h.room('Gallery').id), 'G: no walk to where you stand');
  check(h.echoes.join() === '[Map] You are already there.', `G: told so (${h.echoes})`);
  check(h.starts === 0, 'G: ... and the hex walk is left alone');
}

// --- H: door sequences -----------------------------------------------------------------
{
  check(
    buildDoorSequence('west', 2)!.join('|') ===
      'unlock w door with key|unlock w door with key 2|open w door|w|close e door|lock e door with key|lock e door with key 2',
    'H: the /door built-in still says "door"'
  );
  check(
    buildDoorSequence('d', 1, 'trapdoor')!.join('|') ===
      'unlock d trapdoor with key|open d trapdoor|d|close u trapdoor|lock u trapdoor with key',
    'H: one noun names both sides when the far side is unknown'
  );
  check(
    doorCommandNoun('doors') === 'door' &&
      doorCommandNoun('gates') === 'gate' &&
      doorCommandNoun('trapdoor') === 'trapdoor' &&
      doorCommandNoun('curtain') === 'curtain' &&
      doorCommandNoun(undefined) === 'door',
    'H: door nouns map to the word the server answers to'
  );
  check(buildDoorSequence('constructor', 2) === null, 'H: "/door constructor" sends nothing');
}

// --- I: door state read at send time ------------------------------------------------------
{
  const h = setup(gateRooms, gateLinks, 'Hall');
  h.exec.start(h.room('Arbor').id);
  await settle();
  // The Gallery's fresh exits line: the "gate" was a misparse, plain north
  h.arrive('Gallery', 'There are three exits: west, east, and north.');
  await settle();
  check(
    h.sent.join() === 'e,n,e',
    `I: a door the fresh line no longer shows is walked plainly, the next step pipelined (${h.sent})`
  );
}

// --- J: the action blocker holds the walk ---------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.held = true;
  h.exec.start(h.room('Study').id);
  check(
    h.echoes.join() === '[Map] Walking 2 rooms... (after the current action finishes)',
    `J: the player is told the walk waits (${h.echoes})`
  );
  await settle();
  for (let i = 0; i < 40; i++) {
    h.now += 250;
    h.timers.run();
    await settle();
  }
  check(h.sent.length === 0, `J: nothing sent while sends are held (${h.sent})`);
  check(h.exec.active, `J: no timeout while held for ${10_000 / 1000} s`);
  h.held = false;
  h.now += 250;
  h.timers.run();
  await settle();
  check(h.sent.join() === 'e,e', `J: released, the walk goes on (${h.sent})`);
  h.arrive('Gallery', WE);
  h.arrive('Study', WE);
  check(h.echoes.includes('[Map] Arrived.'), 'J: arrived');
}
// A cast that ends near the end of the step window: the step goes out and
// gets the whole window for its reply (released / round trip, in ms)
for (const [releasedAt, roundTrip] of [
  [7_900, 200], // released after the last retry before the window ends
  [7_700, 350], // the step goes out at 7,750; its reply comes after 8,000
  [7_990, 7_000],
]) {
  const h = setup(corridor, corridorLinks, 'Hall');
  const t0 = h.now;
  h.held = true;
  h.exec.start(h.room('Study').id);
  await h.advanceTo(t0 + releasedAt);
  h.unblock();
  while (h.sent.length === 0 && h.now < t0 + releasedAt + 1_000) await h.tick();
  const sentAt = h.now;
  check(
    h.sent.join() === 'e,e',
    `J: released ${releasedAt} ms after the click, the steps go out (${h.sent}; ${h.stopped()})`
  );
  await h.advanceTo(sentAt + roundTrip);
  check(
    h.exec.active,
    `J: ... and wait ${roundTrip} ms for the reply (${h.stopped().join(' | ')})`
  );
  h.arrive('Gallery', WE);
  h.arrive('Study', WE);
  check(h.echoes.includes('[Map] Arrived.'), `J: ... and arrive (released at ${releasedAt})`);
}
{
  // The window runs from the step's send: held 5 s, then nothing answers
  const h = setup(corridor, corridorLinks, 'Hall');
  const t0 = h.now;
  h.held = true;
  h.exec.start(h.room('Study').id);
  await h.advanceTo(t0 + 5_000);
  h.unblock();
  while (h.sent.length === 0) await h.tick();
  const sentAt = h.now;
  await h.advanceTo(sentAt + WALK_STEP_TIMEOUT - 10);
  check(h.exec.active, 'J: an unanswered step is waited for the whole window after its send...');
  await h.advanceTo(sentAt + WALK_STEP_TIMEOUT + 10);
  check(
    h.stopped().join() === '[Map] Walk stopped: no response from the MUD',
    `J: ... and no longer (${h.stopped()})`
  );
}
{
  // A cast that starts after the steps went out holds the steps to come, not
  // the replies to those out: the MUD answers them first
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Study').id);
  await settle();
  const t0 = h.now;
  h.held = true;
  await h.advanceTo(t0 + WALK_STEP_TIMEOUT - 10);
  check(h.exec.active, 'J: steps out before a cast are waited for...');
  await h.advanceTo(t0 + WALK_STEP_TIMEOUT + 10);
  check(
    h.stopped().join() === '[Map] Walk stopped: no response from the MUD',
    `J: ... for their own window, cast or not (${h.stopped()})`
  );
}
{
  // Held mid-walk: the next step waits behind the cast; the cast ends late in
  // the window that started at the last confirmation
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Library').id);
  await settle();
  h.held = true; // a cast starts
  h.arrive('Gallery', WE);
  h.arrive('Study', WE);
  const t1 = h.now;
  await h.advanceTo(t1 + 7_900);
  check(h.sent.join() === 'e,e', `J: the last step waits behind the cast (${h.sent})`);
  h.unblock();
  await h.advanceTo(t1 + 8_300);
  check(
    h.exec.active && h.sent.join() === 'e,e,e',
    `J: ... then goes out and is waited for (${h.sent}; ${h.stopped()})`
  );
  h.arrive('Library', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.'), 'J: ... arrived');
}
// A block that starts while a door sequence goes out (an auto-cast's cast,
// read between two sends) holds the rest of it, not the blocker's queue
async function heldDoorChain() {
  const h = setup(gateRooms, gateLinks, 'Gallery');
  h.gated = true;
  h.exec.start(h.room('Arbor').id);
  await settle();
  check(h.sent.join() === 'unlock n gate with key', 'J: the door sequence starts');
  h.held = true; // the cast starts while the first unlock is out
  h.release();
  for (let i = 0; i < 1_200; i++) await h.tick(); // 12 s of casting
  check(
    h.sent.join() === 'unlock n gate with key' && h.queued.length === 0,
    `J: the rest of the sequence waits, none of it queued behind the blocker (${h.queued.map((q) => q.cmd)})`
  );
  check(h.exec.active, 'J: ... and the walk with it');
  return h;
}
{
  const h = await heldDoorChain();
  h.unblock();
  for (let i = 0; i < 40; i++) {
    await h.tick();
    h.release(); // each send of the sequence completes
  }
  check(
    h.sent.slice(1).join('|') ===
      [
        'unlock n gate with key 2',
        'open n gate',
        'n',
        'close s gate',
        'lock s gate with key',
        'lock s gate with key 2',
      ].join('|') && h.exec.active,
    `J: the cast over, the sequence goes on as the walk's own (${h.sent.join('|')}; ${h.stopped()})`
  );
  h.arrive('Garden', 'There are two exits: an open iron gate leading south and east.');
  await h.tick();
  check(h.sent[h.sent.length - 1] === 'e', `J: ... the next step follows (${h.sent.join('|')})`);
  h.arrive('Arbor', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.'), `J: ... arrived (${h.echoes.join(' | ')})`);
}
{
  // ... while a move the player typed during the cast still stops the walk
  const h = await heldDoorChain();
  h.type('w');
  h.unblock();
  for (let i = 0; i < 40; i++) {
    await h.tick();
    h.release();
  }
  check(
    h.stopped().join() === '[Map] Walk stopped: manual movement',
    `J: the player's own move stops the walk (${h.stopped()})`
  );
  check(
    h.sent.join() === 'unlock n gate with key',
    `J: ... and the sequence stops short of the walk's move (${h.sent})`
  );
}
{
  // While the sequence waits, its move has not gone out: nothing can answer it
  const h = await heldDoorChain();
  h.exec.onLineEvents([{ kind: 'unknown-command', verb: null, failed: true }]);
  check(h.exec.active, 'J: a failed move is not the held step');
  h.exec.onResolution({
    kind: 'expected',
    pos: { townId: h.town.id, roomId: h.room('Garden').id },
    moved: null,
  });
  check(
    h.stopped().join() === '[Map] Walk stopped: unexpected movement',
    `J: ... nor is the step's room, reached before its move went out (${h.stopped()})`
  );
}

// --- K: dark steps ---------------------------------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Library').id);
  await settle();
  h.line('It is pitch black.'); // the Gallery is unlit
  await settle();
  check(h.exec.progress?.remaining === 2, 'K: the dark step is confirmed by the blind advance');
  check(h.sent.join() === 'e,e,e', `K: ... and the walk goes on (${h.sent})`);
  h.arrive('Study', WE);
  h.arrive('Library', 'There is one obvious exit: west.');
  check(h.echoes.includes('[Map] Arrived.'), `K: arrived (${h.echoes.join(' | ')})`);
}
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Study').id);
  await settle();
  h.loc.lost = true; // the localizer no longer knows the room
  h.line('It is pitch black.');
  check(!h.exec.active, 'K: a dark step the localizer cannot follow stops the walk');
  check(
    h.stopped().join() === '[Map] Walk stopped: lost track of you in the dark',
    `K: ... saying why (${h.stopped()})`
  );
  const l = setup(corridor, corridorLinks, 'Hall');
  l.exec.start(l.room('Study').id);
  await settle();
  l.exec.onLineEvents([{ kind: 'dark', wasActive: true, result: 'look' }]);
  check(l.exec.active && l.exec.progress?.remaining === 2, 'K: a look into darkness is no step');
}

// --- L: transits, forced moves, failed steps --------------------------------------------
{
  const reasons: [string, string][] = [
    ['You step into the portal.', 'stepped through a portal'],
    ['Your body becomes insubstantial.  Red and green lights swirl around you as', 'teleported'],
    ['Esira leads you up.', 'someone led you away'],
  ];
  for (const [line, reason] of reasons) {
    const h = setup(corridor, corridorLinks, 'Hall');
    h.exec.start(h.room('Study').id);
    await settle();
    h.line(line);
    check(
      h.stopped().join() === `[Map] Walk stopped: ${reason}`,
      `L: "${line.slice(0, 30)}" stops the walk (${h.stopped()})`
    );
  }
  const h = setup(
    [
      ['Gem Shop', 0, 0, 0, 'There are two exits: west and hole.'],
      ['Main Entrance', 0, 0, -1, 'There are two exits: hole and south.'],
    ],
    [],
    'Gem Shop'
  );
  h.map.linkNamed(h.room('Gem Shop'), 'hole', h.room('Main Entrance'));
  h.exec.start(h.room('Main Entrance').id);
  await settle();
  check(h.sent.join() === 'hole', `L: the walk sends the exit word (${h.sent})`);
  h.line('What ?'); // the mat covers the hole again
  check(
    h.stopped().join() === `[Map] Walk stopped: the game didn't understand "hole"`,
    `L: a failed step stops the walk at once (${h.stopped()})`
  );
}
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Study').id);
  await settle();
  h.exec.onResolution({ kind: 'lost', pos: null, moved: null });
  check(
    h.stopped().join() === '[Map] Walk stopped: position lost',
    `L: a block that loses the position stops the walk (${h.stopped()})`
  );
}

// --- M: cancelled while a door sequence goes out ----------------------------------------
{
  const h = setup(gateRooms, gateLinks, 'Gallery');
  h.gated = true;
  h.exec.start(h.room('Garden').id);
  await settle();
  check(h.sent.join() === 'unlock n gate with key', 'M: the sequence starts');
  h.exec.cancel('cancelled');
  h.release();
  await settle();
  check(
    h.sent.join() === 'unlock n gate with key',
    `M: cancelled before the move: it stops (${h.sent})`
  );

  const late = setup(gateRooms, gateLinks, 'Gallery');
  late.gated = true;
  late.exec.start(late.room('Garden').id);
  await settle();
  for (let i = 0; i < 3; i++) {
    late.release();
    await settle();
  }
  check(late.sent[late.sent.length - 1] === 'n', `M: the move is out (${late.sent})`);
  late.exec.cancel('cancelled');
  for (let i = 0; i < 4; i++) {
    late.release();
    await settle();
  }
  check(
    late.sent.slice(-3).join('|') === 'close s gate|lock s gate with key|lock s gate with key 2',
    `M: after the move the door behind is still closed and locked (${late.sent.join('|')})`
  );
}

// --- N: nobody answers ---------------------------------------------------------------------
{
  const h = setup(corridor, corridorLinks, 'Hall');
  h.exec.start(h.room('Study').id);
  await settle();
  h.now += WALK_STEP_TIMEOUT - 1;
  h.timers.run();
  check(h.exec.active, 'N: still waiting just before the timeout');
  h.now += 1;
  h.timers.run();
  check(
    h.stopped().join() === '[Map] Walk stopped: no response from the MUD',
    `N: timed out (${h.stopped()})`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — town walk executor');
