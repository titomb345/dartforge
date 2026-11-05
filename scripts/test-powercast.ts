/**
 * Autopowercast regression test — drives the AutoPowercast loop with real
 * DartMUD wording taken from the session logs, on a fake clock, and checks
 * what it sends and when.
 *
 * The status bar trackers read each line before the loop does, the same
 * order as the app, so the loop sees the readings it would really see.
 *
 * Usage: npx tsx scripts/test-powercast.ts
 */
import {
  AutoPowercast,
  DEFAULT_POWERCAST_CONFIG,
  type AutoPowercastConfig,
  type Vitals,
} from '../src/lib/autoPowercast';
import { CONCENTRATION_LEVELS, matchConcentrationLine } from '../src/lib/concentrationPatterns';
import { findAuraLevel, matchAuraLine } from '../src/lib/auraPatterns';

// A fake clock, so the 5 second settling pause and the minute-long reply
// timers run instantly and in order.
let now = 0;
let nextId = 0;
let timers: { id: number; at: number; fn: () => void }[] = [];
globalThis.setTimeout = ((fn: () => void, ms?: number) => {
  timers.push({ id: ++nextId, at: now + (ms ?? 0), fn });
  return nextId;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => {
  timers = timers.filter((t) => t.id !== id);
}) as typeof clearTimeout;
function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    now = t.at;
    t.fn();
  }
  now = end;
}

let failed = 0;
function check(what: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) failed = 1;
}

const BEBT = "You're bright-eyed and bushy-tailed.";
const OFF_BALANCE = "You're off balance.";
const CHANNELLED = 'You channel power to pearl.';
const NO_AURA = 'You appear to have no aura.';
const LOST = 'None of the power got outside your head.';

const pc = new AutoPowercast();
const vitals: Vitals = { conc: CONCENTRATION_LEVELS[0], aura: findAuraLevel('scintillating') };
let sent: string[] = [];
let echoed: string[] = [];

/** A line from the game: the trackers read it first, then the loop. */
function game(line: string) {
  const c = matchConcentrationLine(line);
  if (c) vitals.conc = c.level;
  const a = matchAuraLine(line);
  if (a) vitals.aura = a.level;
  pc.processServerLine(line);
}

function start(cfg: Partial<AutoPowercastConfig> = {}) {
  pc.reset();
  timers = [];
  sent = [];
  echoed = [];
  vitals.conc = CONCENTRATION_LEVELS[0];
  vitals.aura = findAuraLevel('scintillating');
  pc.configure({ ...DEFAULT_POWERCAST_CONFIG, item: 'pearl', channelCount: 2, ...cfg });
  pc.start(
    async (cmd) => void sent.push(cmd),
    async (action) => void sent.push(action),
    (msg) => void echoed.push(msg),
    () => vitals
  );
}
const channels = () => sent.filter((c) => c.startsWith('channel ')).length;
const stoppedWith = (text: string) =>
  !pc.active && echoed.some((m) => m.includes('stopped') && m.includes(text));

/** Store every channel of the round and get to the point of discharging. */
function chargeUp(count: number) {
  advance(5000);
  for (let i = 0; i < count; i++) {
    game(CHANNELLED);
    advance(5000);
  }
}

// --- Shent's report: no wait after a powercast ---
start({ auraTarget: 'intense-violet' });
check('nothing is channelled before the settling pause ends', channels() === 0);
advance(5000);
check('channels once the pause ends with full readings', channels() === 1);
game(CHANNELLED);
advance(5000);
game(CHANNELLED);
advance(5000);
check('waits out the pause again before discharging', sent.includes('discharge pearl'));
game('You discharge the pearl.');
game('You feel some power enter you.');
game('You begin to cast the spell.');
game('You finish practicing.');
const channelsBefore = channels();
// The real order from the logs: the cost shows up about two seconds later
advance(2000);
game('Your aura appears to be dim violet.');
game(OFF_BALANCE);
advance(3000);
check('no channel right after the powercast', channels() === channelsBefore);
check('opens the mind after the powercast', sent.at(-1) === 'set mind to open');
check(
  'says what it is waiting for',
  echoed.some((m) => m.includes('waiting for full concentration and an intense violet aura'))
);
game(BEBT);
check('full concentration alone is not enough with an aura set', channels() === channelsBefore);
game('Your aura appears to be intense violet.');
check('channels again once both are back', channels() === channelsBefore + 1);
check('counts the powercast', pc.getState().cycleCount === 1);

// --- The wait before discharging sees the drop from the last channel ---
start({ channelCount: 1 });
advance(5000);
game(CHANNELLED);
advance(1000);
game(OFF_BALANCE);
advance(4000);
check('no discharge while concentration is down', !sent.includes('discharge pearl'));
game(BEBT);
check('discharges once concentration is back', sent.includes('discharge pearl'));

// --- Running out of aura partway through a round ---
start({ channelCount: 3, delaySec: 0 });
advance(5000);
game(CHANNELLED);
advance(0); // a delay of 0 still sends the next channel from a timer
game(NO_AURA);
check('keeps the channels already stored', pc.getState().channelsDone === 1);
check('waits for aura', pc.getState().waitingFor === 'resume');
check(
  'says it ran out',
  echoed.some((m) => m.includes('out of aura with 1 of 3 channels stored'))
);
const beforeAura = channels();
game('Your aura appears to be very dim red.');
check('waits out the settling pause even with aura back', channels() === beforeAura);
advance(5000);
check('carries on with the round once aura is back', channels() === beforeAura + 1);
game(NO_AURA);
check('only says it once per round', echoed.filter((m) => m.includes('out of aura')).length === 1);
advance(5000);
check('still waiting while there is no aura', channels() === beforeAura + 1);
advance(60000);
check('tries again after a minute with no aura news', channels() === beforeAura + 2);
game(CHANNELLED);
advance(0);
game(CHANNELLED);
check('finishes the round it started', pc.getState().waitingFor === 'cast');
check('stored all three', pc.getState().channelsDone === 3);

// --- A channel that stores nothing ---
start({ delaySec: 0 });
advance(5000);
game(LOST);
check('a lost channel is not counted', pc.getState().channelsDone === 0);
advance(4000);
check('a delay of 0 still leaves a gap before trying again', channels() === 1);
advance(1000);
check('tries again after the gap', channels() === 2);
game(CHANNELLED);
check('the next good channel counts', pc.getState().channelsDone === 1);
for (let i = 0; i < 8; i++) {
  advance(5000);
  game(LOST);
}
check('eight lost channels in a row stop the loop', stoppedWith('8 channels in a row'));

// --- A channel the game never answers ---
start();
advance(5000);
game('Moot waves.');
advance(59000);
check('still waiting just under a minute', pc.active);
advance(1000);
check('stops after a minute with no answer', stoppedWith('"channel 1 pearl" got no reply'));

// --- Discharge waits for the result ---
start({ channelCount: 1, container: 'scrip' });
chargeUp(1);
check(
  'takes the focus out and discharges',
  sent.slice(-2).join('|') === 'take pearl from scrip|discharge pearl'
);
check('does not isolate before the discharge result', !sent.includes('set mind to isolated'));
game('You discharge the pearl.');
game('You feel some power enter you.');
check(
  'then isolates, puts the focus back and casts',
  sent.slice(-3).join('|') === 'set mind to isolated|put pearl in scrip|/powercast 0'
);

// --- An empty focus ---
start({ channelCount: 1, container: 'scrip' });
chargeUp(1);
game('You discharge the pearl.');
game('You feel nothing.');
check('no powercast with an empty focus', !sent.includes('/powercast 0'));
check('no isolate with an empty focus', !sent.includes('set mind to isolated'));
check('puts the focus back', sent.includes('put pearl in scrip'));
check('goes back to channelling', pc.active && pc.getState().waitingFor === 'channel');
check(
  'says why',
  echoed.some((m) => m.includes('the focus was empty'))
);

// --- A discharge the game never answers ---
start({ channelCount: 1, container: 'scrip' });
chargeUp(1);
advance(60000);
check('stops when the discharge gets no answer', stoppedWith('"discharge pearl" got no reply'));
check('puts the focus back on the way out', sent.at(-1) === 'put pearl in scrip');
check('does not claim the mind is isolated', !echoed.some((m) => m.includes('still isolated')));

// --- Things that already worked keep working ---
start();
advance(5000);
game('You cannot channel to pearl.');
check('a wrong item name stops the loop', stoppedWith('cannot channel to "pearl"'));

start({ channelCount: 1 });
chargeUp(1);
game('You feel some power enter you.');
game('Your aura is too weak.');
check('a failed powercast recovers', pc.active && pc.getState().waitingFor === 'channel');
for (let i = 0; i < 2; i++) {
  chargeUp(1);
  game('You feel some power enter you.');
  game('Your aura is too weak.');
}
check('three failed powercasts in a row stop it', stoppedWith('3 powercasts in a row'));

start({ channelCount: 1 });
chargeUp(1);
game('You feel some power enter you.');
pc.stop((m) => void echoed.push(m));
check('stopping mid-cast says the mind is isolated', echoed.at(-1)!.includes('still isolated'));

process.exit(failed);
