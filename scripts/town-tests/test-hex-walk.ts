/**
 * Regression test: the hex walk executor (src/lib/hexWalk.ts) and the walk
 * pacing both executors share (src/lib/walkPacing.ts) — Oct 2026 deep dive,
 * app-wiring stage. The hex walk lived inside useMapTracker, untested; it
 * now runs as a plain class, driven here by survey resolutions the way the
 * hook drives it (every send tracked through onCommand first).
 *
 *  A. Moves are pipelined two ahead of their surveys and confirmed in order;
 *     the walk arrives.
 *  B. A manual survey mid-walk (stationary, nothing moved) is no step; a
 *     direction the player types stops the walk, the walk's own sends do
 *     not; a survey that moved elsewhere, or lost the position, stops it.
 *  C. While the client holds sends (the action blocker, during a cast) the
 *     walk sends nothing and does not time out; it goes on when released.
 *  D. The step timeout runs from the moment a move goes out: a cast ending
 *     in the last moments of the 8 s window (at the click, or after a
 *     confirmation) used to stop the walk with "no response from the MUD",
 *     before its move had gone out or before the survey could arrive. A
 *     move nobody answers still times out, 8 s after its send, and a cast
 *     that starts after it went out does not stretch that.
 *  E. A failed send stops its own walk, not the one that replaced it.
 */
import type { SurveyResolution } from '../../src/lib/hexLocalizer';
import type { Direction } from '../../src/lib/hexUtils';
import { HexWalkExecutor } from '../../src/lib/hexWalk';
import { WALK_STEP_TIMEOUT } from '../../src/lib/walkPacing';
import { FakeTimers } from '../lib/fakeTimers';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

/** Let the executor's sends settle */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const survey = (moved: Direction | null, kind: SurveyResolution['kind'] = 'expected') => ({
  kind,
  pos: { island: 0, q: 0, r: 0 },
  moved,
  conflicts: 0,
});

function setup() {
  const h = {
    now: 100_000,
    sent: [] as Direction[],
    echoes: [] as string[],
    held: false,
    /** Make the next send fail */
    failNext: false,
    timers: null as unknown as FakeTimers,
    exec: null as unknown as HexWalkExecutor,
    /** The player types a command (tracked like any send) */
    type(cmd: string): void {
      h.exec.onCommand(cmd);
    },
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
  h.exec = new HexWalkExecutor({
    send: async (dir) => {
      // useMapTracker.trackCommand: the executor sees every send
      h.exec.onCommand(dir);
      h.sent.push(dir);
      if (h.failNext) {
        h.failNext = false;
        throw new Error('IPC failed');
      }
    },
    sendsHeld: () => h.held,
    echo: (m) => h.echoes.push(m),
    changed: () => {},
    timers: h.timers,
  });
  return h;
}

const PATH: Direction[] = ['n', 'ne', 'se'];
const TARGET = { q: 2, r: -1 };

// --- A: pipelined, confirmed in order ------------------------------------------
{
  const h = setup();
  h.exec.start(PATH, TARGET);
  await settle();
  check(h.echoes.join() === '[Map] Walking 3 hexes...', `A: banner (${h.echoes})`);
  check(h.sent.join() === 'n,ne', `A: two moves in flight (${h.sent})`);
  check(h.exec.progress?.remaining.join() === 'n,ne,se', 'A: the route preview');
  h.exec.onResolution(survey('n'));
  await settle();
  check(h.sent.join() === 'n,ne,se', `A: a confirmation sends the next (${h.sent})`);
  h.exec.onResolution(survey('ne'));
  h.exec.onResolution(survey('se'));
  check(!h.exec.active && h.echoes.includes('[Map] Arrived.'), 'A: arrived');
  check(h.stopped().length === 0, `A: never stopped (${h.stopped()})`);
}

// --- B: what stops a walk, what doesn't ---------------------------------------------
{
  const h = setup();
  h.exec.start(PATH, TARGET);
  await settle();
  h.exec.onResolution(survey(null, 'stationary'));
  check(h.exec.active, 'B: a manual survey mid-walk is no step');
  h.type('survey');
  check(h.exec.active, 'B: ... nor is a command that moves nowhere');
  h.type('southwest');
  check(
    h.stopped().join() === '[Map] Walk stopped: manual movement',
    `B: a direction the player types stops it (${h.stopped()})`
  );
  const u = setup();
  u.exec.start(PATH, TARGET);
  await settle();
  u.exec.onResolution(survey('s'));
  check(
    u.stopped().join() === '[Map] Walk stopped: unexpected movement',
    `B: a survey that moved elsewhere stops it (${u.stopped()})`
  );
  const l = setup();
  l.exec.start(PATH, TARGET);
  await settle();
  l.exec.onResolution({ kind: 'lost', pos: null, moved: null, conflicts: 0 });
  check(
    l.stopped().join() === '[Map] Walk stopped: position lost',
    `B: ... and so does a lost position (${l.stopped()})`
  );
}

// --- C: the action blocker holds the walk -------------------------------------------
{
  const h = setup();
  h.held = true;
  h.exec.start(PATH, TARGET);
  check(
    h.echoes.join() === '[Map] Walking 3 hexes... (after the current action finishes)',
    `C: the player is told the walk waits (${h.echoes})`
  );
  const t0 = h.now;
  await h.advanceTo(t0 + 12_000);
  check(h.sent.length === 0, `C: nothing sent while sends are held (${h.sent})`);
  check(h.exec.active, 'C: no timeout while held for 12 s');
  h.held = false;
  await h.advanceTo(t0 + 12_300);
  check(h.sent.join() === 'n,ne', `C: released, the walk goes on (${h.sent})`);
}

// --- D: the step window runs from the send ----------------------------------------------
for (const [releasedAt, roundTrip] of [
  [7_900, 200],
  [7_700, 350],
  [7_990, 7_000],
]) {
  const h = setup();
  const t0 = h.now;
  h.held = true;
  h.exec.start(PATH, TARGET);
  await h.advanceTo(t0 + releasedAt);
  h.held = false;
  while (h.sent.length === 0 && h.now < t0 + releasedAt + 1_000) await h.tick();
  const sentAt = h.now;
  check(
    h.sent.join() === 'n,ne',
    `D: released ${releasedAt} ms after the click, the moves go out (${h.sent}; ${h.stopped()})`
  );
  await h.advanceTo(sentAt + roundTrip);
  check(h.exec.active, `D: ... and wait ${roundTrip} ms for the survey (${h.stopped()})`);
  h.exec.onResolution(survey('n'));
  h.exec.onResolution(survey('ne'));
  await settle();
  h.exec.onResolution(survey('se'));
  check(h.echoes.includes('[Map] Arrived.'), `D: ... and arrive (released at ${releasedAt})`);
}
{
  // A cast that starts after the moves went out holds the moves to come, not
  // the surveys of those out: the MUD answers them first
  const h = setup();
  h.exec.start(PATH, TARGET);
  await settle();
  const t0 = h.now;
  h.held = true;
  await h.advanceTo(t0 + WALK_STEP_TIMEOUT - 10);
  check(h.exec.active, 'D: moves out before a cast are waited for...');
  await h.advanceTo(t0 + WALK_STEP_TIMEOUT + 10);
  check(
    h.stopped().join() === '[Map] Walk stopped: no response from the MUD',
    `D: ... for their own window, cast or not (${h.stopped()})`
  );
}
{
  // Held after a confirmation, released late in the window it started
  const h = setup();
  h.exec.start(PATH, TARGET);
  await settle();
  h.held = true;
  h.exec.onResolution(survey('n'));
  h.exec.onResolution(survey('ne'));
  const t1 = h.now;
  await h.advanceTo(t1 + 7_900);
  check(h.sent.join() === 'n,ne', `D: the last move waits behind the cast (${h.sent})`);
  h.held = false;
  await h.advanceTo(t1 + 8_300);
  check(
    h.exec.active && h.sent.join() === 'n,ne,se',
    `D: ... then goes out and is waited for (${h.sent}; ${h.stopped()})`
  );
  h.exec.onResolution(survey('se'));
  check(h.echoes.includes('[Map] Arrived.'), 'D: ... arrived');
}
{
  // Nobody answers: 8 s after the send, not after the click
  const h = setup();
  const t0 = h.now;
  h.held = true;
  h.exec.start(PATH, TARGET);
  await h.advanceTo(t0 + 5_000);
  h.held = false;
  while (h.sent.length === 0) await h.tick();
  const sentAt = h.now;
  await h.advanceTo(sentAt + WALK_STEP_TIMEOUT - 10);
  check(h.exec.active, 'D: an unanswered move is waited for the whole window after its send...');
  await h.advanceTo(sentAt + WALK_STEP_TIMEOUT + 10);
  check(
    h.stopped().join() === '[Map] Walk stopped: no response from the MUD',
    `D: ... and no longer (${h.stopped()})`
  );
}

// --- E: a failed send ----------------------------------------------------------------------
{
  const h = setup();
  h.failNext = true;
  h.exec.start(['n'], { q: 0, r: -1 });
  await settle();
  check(
    h.stopped().join() === '[Map] Walk stopped: send failed',
    `E: a failed send stops the walk (${h.stopped()})`
  );
  const r = setup();
  r.failNext = true;
  r.exec.start(['n'], { q: 0, r: -1 });
  r.exec.start(['s'], { q: 0, r: 1 }); // replaced before the failure lands
  await settle();
  check(
    r.exec.active && r.stopped().length === 0,
    `E: ... but not the walk that replaced it (${r.stopped()})`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — hex walk executor');
