/**
 * Regression test: response-aware door crossing (DoorRunner).
 * Message strings are live-confirmed (Bill, July 2026) + corpus-mined.
 * The runner must: stop trying keys once one works, remember it for the
 * far-side lock, skip lock entirely when it never unlocked, leave doors
 * found open untouched, stop trying keyring slots that don't exist, and
 * report near-side failures (locked out, door closed) as not-ok.
 */
import { DoorRunner, type DoorCrossingOptions } from '../../src/lib/doorRunner';

let fail = false;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    fail = true;
  }
};

/** Drive a runner with a command → reply script (undefined = silence). */
function drive(
  script: Record<string, string>,
  opts: Partial<DoorCrossingOptions> = {}
): { sent: string[]; result: Promise<import('../../src/lib/doorRunner').DoorCrossingResult> } {
  const sent: string[] = [];
  // eslint-disable-next-line prefer-const
  let runner: DoorRunner;
  const send = async (cmd: string) => {
    sent.push(cmd);
    const reply = script[cmd];
    if (reply) setTimeout(() => runner.feedLine(reply), 0);
  };
  runner = new DoorRunner({
    dir: 'w',
    opp: 'e',
    keys: 5,
    send,
    responseTimeoutMs: 25,
    ...opts,
  });
  return { sent, result: runner.run() };
}

(async () => {
  // 1. Known open (exits line): walk straight through, leave it open.
  {
    const { sent, result } = drive({}, { knownOpen: true });
    const res = await result;
    check(res.ok && res.wasOpen, 'knownOpen: should pass through ok');
    check(sent.join('|') === 'w', `knownOpen: sent [${sent}], expected just the move`);
  }

  // 2. Locked door, key 3 fits: stop keys at 3, lock with exactly key 3.
  {
    const { sent, result } = drive({
      'unlock w door with key': 'You fail.',
      'unlock w door with key 2': '> You fail.',
      'unlock w door with key 3': 'You unlock the wrought iron gate.',
      'open w door': 'You open the wrought iron gate.',
      'close e door': 'You close the wrought iron gate.',
      'lock e door with key 3': 'You lock the wrought iron gate.',
    });
    const res = await result;
    check(res.ok && res.unlockedWithKey === 3, `key3: ok=${res.ok} key=${res.unlockedWithKey}`);
    check(
      sent.join('|') ===
        'unlock w door with key|unlock w door with key 2|unlock w door with key 3|open w door|w|close e door|lock e door with key 3',
      `key3: sent [${sent.join('|')}]`
    );
  }

  // 3. Remembered key tried first.
  {
    const { sent, result } = drive(
      {
        'unlock w door with key 3': 'You unlock the oak door.',
        'open w door': 'You open the oak door.',
        'close e door': 'You close the oak door.',
        'lock e door with key 3': 'You lock the oak door.',
      },
      { preferredKey: 3 }
    );
    const res = await result;
    check(res.ok && res.unlockedWithKey === 3, 'preferred: should unlock first try');
    check(sent[0] === 'unlock w door with key 3', `preferred: first sent ${sent[0]}`);
    check(sent.length === 5, `preferred: ${sent.length} commands, expected 5`);
  }

  // 4. No lock: skip remaining keys AND skip the far-side lock.
  {
    const { sent, result } = drive({
      'unlock w door with key': 'The oak door has no lock!',
      'open w door': 'You open the oak door.',
      'close e door': 'You close the oak door.',
    });
    const res = await result;
    check(res.ok && res.unlockedWithKey === undefined, 'nolock: ok without a key');
    check(
      sent.join('|') === 'unlock w door with key|open w door|w|close e door',
      `nolock: sent [${sent.join('|')}]`
    );
  }

  // 5. Found standing open (reply, not exits line): move only, leave open.
  {
    const { sent, result } = drive({
      'unlock w door with key': 'The set of oaken double doors is open.',
    });
    const res = await result;
    check(res.ok && res.wasOpen, 'open-reply: should pass through and leave open');
    check(sent.join('|') === 'unlock w door with key|w', `open-reply: sent [${sent.join('|')}]`);
  }

  // 6. Locked and no key fits: clean near-side failure.
  {
    const { sent, result } = drive({
      'unlock w door with key': 'You fail.',
      'unlock w door with key 2': 'You fail.',
      'unlock w door with key 3': 'You fail.',
      'unlock w door with key 4': 'You fail.',
      'unlock w door with key 5': 'You fail.',
      'open w door': 'The steel door is locked.',
    });
    const res = await result;
    check(!res.ok && /locked/.test(res.reason ?? ''), `locked-out: ok=${res.ok} "${res.reason}"`);
    check(!sent.includes('w'), 'locked-out: must not send the move');
  }

  // 7. "You don't have one of those." stops higher keyring slots.
  {
    const { sent, result } = drive({
      'unlock w door with key': 'You fail.',
      'unlock w door with key 2': "You don't have one of those.",
      'open w door': 'The wrought iron gate is locked!',
    });
    await result;
    const unlocks = sent.filter((c) => c.startsWith('unlock'));
    check(unlocks.length === 2, `nokey: ${unlocks.length} unlock attempts, expected 2`);
  }

  // 8. Move blocked and the fallback can't help (still locked): not ok.
  {
    const { result } = drive(
      {
        w: 'The wrought iron gate is closed.',
        'open w door': 'The wrought iron gate is locked!',
        'unlock w door with key': 'You fail.',
        'unlock w door with key 2': 'You fail.',
        'unlock w door with key 3': 'You fail.',
        'unlock w door with key 4': 'You fail.',
        'unlock w door with key 5': 'You fail.',
      },
      { knownOpen: true }
    );
    const res = await result;
    check(!res.ok, 'move-blocked: must report failure');
  }

  // 8b. Stale open state: believed open, actually closed — fall back to the
  // closed-door sequence and cross anyway instead of aborting the walk.
  {
    const sent: string[] = [];
    let moves = 0;
    // eslint-disable-next-line prefer-const
    let runner: DoorRunner;
    const script: Record<string, string> = {
      'unlock w door with key': 'You unlock the oak door.',
      'open w door': 'You open the oak door.',
      'close e door': 'You close the oak door.',
      'lock e door with key': 'You lock the oak door.',
    };
    const send = async (cmd: string) => {
      sent.push(cmd);
      if (cmd === 'w') {
        moves++;
        // First move bounces off the closed door; the retry succeeds
        if (moves === 1) setTimeout(() => runner.feedLine('The oak door is closed.'), 0);
        else setTimeout(() => runner.notifyMoved(), 0);
      } else if (script[cmd]) {
        setTimeout(() => runner.feedLine(script[cmd]), 0);
      }
    };
    runner = new DoorRunner({
      dir: 'w',
      opp: 'e',
      keys: 1,
      knownOpen: true,
      send,
      responseTimeoutMs: 25,
    });
    const res = await runner.run();
    check(
      res.ok && res.unlockedWithKey === 1,
      `stale-open: ok=${res.ok} key=${res.unlockedWithKey}`
    );
    check(moves === 2, `stale-open: ${moves} move attempts, expected 2`);
    check(sent.includes('lock e door with key'), 'stale-open: must lock behind (we unlocked)');
  }

  // 8c. Arrival-room prose can't fail the move: once two unmatched lines
  // stream past (the room block), a late "It is closed." desc line is
  // ignored and the move counts as succeeded.
  {
    const sent: string[] = [];
    // eslint-disable-next-line prefer-const
    let runner: DoorRunner;
    const send = async (cmd: string) => {
      sent.push(cmd);
      if (cmd === 'w') {
        setTimeout(() => {
          runner.feedLine('Gatehouse');
          runner.feedLine('This is a tunnel-like passage through the gatehouse.');
          runner.feedLine('It is closed.'); // desc prose — must NOT fail the move
        }, 0);
      }
    };
    runner = new DoorRunner({
      dir: 'w',
      opp: 'e',
      keys: 1,
      knownOpen: true,
      send,
      responseTimeoutMs: 5000,
    });
    const t0 = Date.now();
    const res = await runner.run();
    check(res.ok, 'desc-prose: crossing must succeed');
    check(Date.now() - t0 < 4000, 'desc-prose: room block should end the move wait early');
  }

  // 9. notifyMoved short-circuits the move wait (no timeout needed).
  {
    const script: Record<string, string> = {
      'unlock w door with key': 'You unlock the oak door.',
      'open w door': 'You open the oak door.',
      'close e door': 'You close the oak door.',
      'lock e door with key': 'You lock the oak door.',
    };
    const sent: string[] = [];
    // eslint-disable-next-line prefer-const
    let runner: DoorRunner;
    const send = async (cmd: string) => {
      sent.push(cmd);
      if (cmd === 'w') setTimeout(() => runner.notifyMoved(), 0);
      else if (script[cmd]) setTimeout(() => runner.feedLine(script[cmd]), 0);
    };
    runner = new DoorRunner({
      dir: 'w',
      opp: 'e',
      keys: 1,
      knownOpen: false,
      send,
      responseTimeoutMs: 5000, // would hang the test if notifyMoved didn't fire
    });
    const t0 = Date.now();
    const res = await runner.run();
    check(res.ok, 'notifyMoved: crossing should complete');
    check(Date.now() - t0 < 4000, 'notifyMoved: move wait should not hit the timeout');
  }

  if (fail) process.exit(1);
  console.log('PASS — door runner reacts correctly to every confirmed reply');
})();
