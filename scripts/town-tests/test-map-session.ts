/**
 * Regression test: whose map the live stores hold (src/lib/mapSession.ts) —
 * Oct 2026 deep dive, persistence lens, app-wiring stage.
 *
 * The session runs here with the real engine (TownParser → TownLocalizer →
 * TownMapStore, the shared line dispatcher) behind a small stand-in for
 * useMapTracker: map files in memory, loads that land when the test says.
 * The scenarios are the persistence lens's interleaving model
 * (race-model.ts), now against the shipped rules.
 *
 *  S1. A typed-name login switches characters while the old map is loaded:
 *      the login chunk — the new character's first room block — is held
 *      until the new map has loaded, then resolves THERE (and resumes its
 *      login there), never in the previous character's map or file.
 *  S2. A load that fails leaves the stores empty and owned by no one:
 *      nothing is ever written to either character's file. The next login
 *      as that character reads the map again.
 *  S3. A double switch inside one slow read: the late load is dropped, the
 *      first character's maps are back, nothing is wiped or crossed; input
 *      held for the abandoned switch is dropped with it.
 *  S4. A login as the character whose map is loaded swaps nothing; one as
 *      the character whose map is loading reads it once.
 *  S5. Held input replays in order, each at its own time.
 *  S6. Saves: 2 s after the latest change but never more than 10 s after
 *      the first; a fired save leaves nothing pending (a switch or an
 *      unmount after it writes nothing); nothing is saved while a map
 *      loads; a switch writes the OLD owner's pending changes to the old
 *      owner's file.
 *  S7. A data-dir change reloads the same character: flush, then load.
 */
import { MapStoreSession, SAVE_MAX_WAIT_MS, type HeldMapInput } from '../../src/lib/mapSession';
import { dispatchTownLine } from '../../src/lib/townLineEvents';
import { TownLocalizer, type TownResolution } from '../../src/lib/townLocalizer';
import { TownMapStore } from '../../src/lib/townMap';
import { TownParser } from '../../src/lib/townParser';
import { FakeTimers } from '../lib/fakeTimers';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const BEDCHAMBER = [
  'Bedchamber',
  'This is a bedchamber on an upper floor of the keep where one of the senior',
  'rangers may rest and store his or her gear.  Starlight streams in through a',
  'window on the east wall.  It is shadowy.',
  'There is one obvious exit: a closed oak door leading west.',
];
const STALL = [
  'Stall',
  'Wooden walls separate this stall from the rest of the stable.  A gate to the',
  'north keeps the livestock from wandering off.  The floor is strewn with hay.',
  'It is dark.',
  'There is one obvious exit: an open gate leading north.',
];
const LOGIN = 'Running under version 3.2.10-dev.608.';

interface Stores {
  town: TownMapStore;
}
interface PendingLoad {
  char: string;
  land(): void;
  fail(): void;
}

/** useMapTracker in miniature: the same session, the same pipeline order */
function app(disk: Map<string, string>) {
  const file = (c: string) => `map-${c}.json`;
  const a = {
    now: 1_000_000,
    clock: null as number | null,
    town: new TownMapStore(),
    loc: null as unknown as TownLocalizer,
    parser: null as unknown as TownParser,
    loads: [] as PendingLoad[],
    installs: 0,
    failed: [] as string[],
    replayed: [] as HeldMapInput[],
    /** Every resolution, with the character whose map resolved it */
    resolved: [] as { owner: string | null; name: string; kind: TownResolution['kind'] }[],
    timers: null as unknown as FakeTimers,
    session: null as unknown as MapStoreSession<Stores>,
    t: () => a.clock ?? a.now,
    processLine(line: string) {
      dispatchTownLine(line, a.loc, a.t());
      a.parser.feedLine(line);
    },
    feedLine(line: string) {
      if (a.session.hold({ kind: 'line', line, at: a.now })) return;
      a.processLine(line);
    },
    trackCommand(command: string) {
      if (a.session.hold({ kind: 'command', command, at: a.now })) return;
      a.loc.trackCommand(command, a.t());
    },
    noteLogin() {
      if (a.session.hold({ kind: 'login', at: a.now })) return;
      a.loc.onLogin();
    },
    /** App.onCharacterName + App.onLogin, synchronously at the login line */
    login(char: string) {
      a.session.begin(char);
      a.noteLogin();
      a.feedLine(LOGIN);
    },
    feed(lines: string[]) {
      for (const l of lines) a.feedLine(l);
    },
    advance(ms: number) {
      a.now += ms;
      a.timers.run();
    },
    fileRooms(c: string): string[] | null {
      const s = disk.get(file(c));
      if (!s) return null;
      const td = (JSON.parse(s) as { townData: { towns: { rooms: { name: string }[] }[] } })
        .townData;
      return td.towns.flatMap((t) => t.rooms.map((r) => r.name));
    },
    liveRooms: () =>
      [...a.town.towns.values()].flatMap((t) => [...t.rooms.values()].map((r) => r.name)),
  };
  const fresh = (town: TownMapStore) => {
    a.town = town;
    a.loc = new TownLocalizer(town);
    a.parser = new TownParser((block) => {
      const res = a.loc.onRoomBlock(block, null, a.t());
      a.resolved.push({ owner: a.session.owner, name: block.name, kind: res.kind });
      a.session.scheduleSave();
    });
  };
  fresh(new TownMapStore());
  a.timers = new FakeTimers(() => a.now);
  a.session = new MapStoreSession<Stores>({
    load: (char) =>
      new Promise<Stores>((resolve, reject) => {
        a.loads.push({
          char,
          land: () => {
            const s = disk.get(file(char));
            resolve({
              town: TownMapStore.deserialize(s ? JSON.parse(s).townData : null),
            });
          },
          fail: () => reject(new Error('read failed')),
        });
      }),
    install: (stores) => {
      a.installs++;
      fresh(stores?.town ?? new TownMapStore());
    },
    save: (char) => disk.set(file(char), JSON.stringify({ townData: a.town.serialize() })),
    replay: (input) => {
      a.replayed.push(input);
      a.clock = input.at;
      try {
        if (input.kind === 'line') a.processLine(input.line);
        else if (input.kind === 'command') a.loc.trackCommand(input.command, a.t());
        else a.loc.onLogin();
      } finally {
        a.clock = null;
      }
    },
    loadFailed: (char) => a.failed.push(char),
    timers: a.timers,
    now: () => a.now,
  });
  return a;
}

/** The app with `char` logged in and their map loaded */
async function loaded(disk: Map<string, string>, char: string) {
  const a = app(disk);
  a.login(char);
  a.loads.shift()!.land();
  await settle();
  return a;
}

// Seed: Mazorn's map with his Bedchamber
const seedDisk = new Map<string, string>();
{
  const a = app(seedDisk);
  a.session.begin('mazorn');
  a.loads.shift()!.land();
  await settle();
  a.feed(BEDCHAMBER);
  a.advance(2_000);
  check(
    JSON.stringify(a.fileRooms('mazorn')) === '["Bedchamber"]',
    `seed: Mazorn's file holds his Bedchamber (${a.fileRooms('mazorn')})`
  );
}

// --- S1: typed-name login switch ----------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  a.feed(BEDCHAMBER);
  check(
    a.resolved[a.resolved.length - 1]?.owner === 'mazorn' &&
      a.resolved[a.resolved.length - 1]?.kind === 'entered',
    "S1: Mazorn's login resumes in his Bedchamber"
  );
  a.advance(25 * 60_000);
  // "Name:" → typed "trilok" → the login chunk
  a.login('trilok');
  a.feed(STALL);
  check(
    a.resolved.filter((r) => r.name === 'Stall').length === 0,
    'S1: the login chunk waits while the map loads'
  );
  check(a.liveRooms().length === 0, "S1: ... and the live stores hold nobody's map meanwhile");
  a.loads.shift()!.land(); // trilok has no map yet
  await settle();
  const stall = a.resolved.find((r) => r.name === 'Stall');
  check(
    stall?.owner === 'trilok' && stall.kind === 'entered',
    `S1: Trilok's login block resolves in Trilok's map (${JSON.stringify(stall)})`
  );
  a.advance(2_000);
  check(
    JSON.stringify(a.fileRooms('trilok')) === '["Stall"]',
    `S1: Trilok's file holds his Stall (${a.fileRooms('trilok')})`
  );
  check(
    JSON.stringify(a.fileRooms('mazorn')) === '["Bedchamber"]',
    `S1: Mazorn's file never sees it (${a.fileRooms('mazorn')})`
  );
  // Trilok's next login resumes where he logged out
  a.advance(60_000);
  a.login('trilok'); // same character: no swap
  a.feed(STALL);
  const again = a.resolved[a.resolved.length - 1];
  check(
    again.name === 'Stall' && again.owner === 'trilok' && again.kind === 'entered',
    `S1: a re-login as Trilok resumes in his Stall (${JSON.stringify(again)})`
  );
}

// --- S2: a failed load -------------------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  a.feed(BEDCHAMBER);
  a.advance(3_000);
  const mazornBefore = disk.get('map-mazorn.json');
  a.login('trilok');
  a.loads.shift()!.fail();
  await settle();
  check(JSON.stringify(a.failed) === '["trilok"]', 'S2: the failure is reported');
  check(a.session.owner === null, 'S2: the stores belong to nobody');
  a.feed(STALL);
  a.advance(60_000);
  a.feed(STALL);
  a.advance(60_000);
  a.session.flush();
  check(!disk.has('map-trilok.json'), "S2: Trilok's file is never written");
  check(disk.get('map-mazorn.json') === mazornBefore, "S2: Mazorn's file is untouched");
  // the next login as Trilok reads his map again
  a.login('trilok');
  check(a.loads.length === 1 && a.loads[0].char === 'trilok', 'S2: a re-login retries the load');
  a.loads.shift()!.land();
  await settle();
  check(a.session.owner === 'trilok', 'S2: ... and Trilok owns the stores once it lands');
}

// --- S3: a double switch inside one slow read -------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  a.feed(BEDCHAMBER);
  a.advance(500); // unsaved change pending
  a.session.begin('trilok'); // the switch button...
  a.feed(STALL); // Trilok's login burst, held for his map
  a.session.begin('mazorn'); // ...and back, before Trilok's map has been read
  check(a.loads.length === 2, 'S3: two loads in flight');
  const [trilokLoad, mazornLoad] = a.loads.splice(0);
  mazornLoad.land();
  await settle();
  trilokLoad.land(); // the slow read lands last
  await settle();
  check(a.session.owner === 'mazorn', 'S3: Mazorn owns the stores');
  check(
    JSON.stringify(a.liveRooms()) === '["Bedchamber"]',
    `S3: the live stores are Mazorn's, not the late load's (${a.liveRooms()})`
  );
  check(
    !a.resolved.some((r) => r.name === 'Stall'),
    "S3: input held for the abandoned switch never reaches Mazorn's map"
  );
  a.feed(BEDCHAMBER);
  a.advance(SAVE_MAX_WAIT_MS);
  check(
    JSON.stringify(a.fileRooms('mazorn')) === '["Bedchamber"]',
    `S3: Mazorn's map survives (${a.fileRooms('mazorn')})`
  );
  check(!disk.has('map-trilok.json'), 'S3: nothing written for Trilok');
}

// --- S4: same-character login -------------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  const installs = a.installs;
  const loc = a.loc;
  check(!a.session.begin('Mazorn'), 'S4: a login as the loaded character is no switch');
  check(a.loads.length === 0 && a.installs === installs, 'S4: no load, no swap');
  check(a.loc === loc, 'S4: the live localizer carries on');
  a.session.begin('trilok');
  check(
    !a.session.begin('Trilok') && a.loads.length === 1,
    'S4: a login as the character whose map is loading reads it once'
  );
}

// --- S5: held input order and times ------------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  a.replayed.length = 0;
  a.session.begin('trilok');
  a.noteLogin();
  a.now += 10;
  a.feedLine('first');
  a.now += 10;
  a.trackCommand('n');
  a.now += 10;
  a.feedLine('second');
  const at0 = a.now - 30;
  a.loads.shift()!.land();
  await settle();
  check(
    JSON.stringify(a.replayed) ===
      JSON.stringify([
        { kind: 'login', at: at0 },
        { kind: 'line', line: 'first', at: at0 + 10 },
        { kind: 'command', command: 'n', at: at0 + 20 },
        { kind: 'line', line: 'second', at: at0 + 30 },
      ]),
    `S5: held input replays in order, at its own times (${JSON.stringify(a.replayed)})`
  );
  check(!a.session.holding, 'S5: input flows again');
}

// --- S6: saves ---------------------------------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  let saves = 0;
  const realSave = disk.set.bind(disk);
  disk.set = (k: string, v: string) => {
    if (k === 'map-mazorn.json') saves++;
    return realSave(k, v);
  };
  a.session.scheduleSave();
  a.advance(1_999);
  check(saves === 0, 'S6: nothing saved before 2 s of quiet');
  a.advance(1);
  check(saves === 1, 'S6: saved after 2 s of quiet');
  a.session.flush();
  check(saves === 1, 'S6: a fired save leaves nothing pending: the next flush writes nothing');
  // continuous changes every second: still saved within 10 s of the first
  for (let i = 0; i < 30 && saves === 1; i++) {
    a.session.scheduleSave();
    a.advance(1_000);
  }
  check(saves === 2, `S6: continuous changes are saved within 10 s (${saves} saves)`);
  // a switch flushes the old owner's pending changes into the OLD owner's file
  a.feed(BEDCHAMBER);
  a.advance(500);
  const savesBefore = saves;
  a.session.begin('trilok');
  check(saves === savesBefore + 1, "S6: the switch saves Mazorn's pending changes to his file");
  check(!disk.has('map-trilok.json'), "S6: ... and nothing to Trilok's");
  a.session.scheduleSave();
  a.session.flush();
  check(!disk.has('map-trilok.json'), 'S6: nothing is saved while a map loads');
}

// --- S7: data-dir change --------------------------------------------------------------------
{
  const disk = new Map(seedDisk);
  const a = await loaded(disk, 'mazorn');
  a.feed(BEDCHAMBER);
  a.advance(500);
  const installs = a.installs;
  check(a.session.begin('mazorn', true), 'S7: a reload of the same character is a switch');
  check(a.loads.length === 1 && a.loads[0].char === 'mazorn', 'S7: ... that reads the map again');
  check(a.installs === installs + 1 && a.session.owner === null, 'S7: ... after swapping out');
  a.loads.shift()!.land();
  await settle();
  check(a.session.owner === 'mazorn', 'S7: reloaded');
  check(JSON.stringify(a.liveRooms()) === '["Bedchamber"]', 'S7: with the flushed changes');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — map store session (ownership, login hold, saves)');
