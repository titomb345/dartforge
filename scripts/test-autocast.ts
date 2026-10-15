/**
 * Autocast regression test — drives the AutoCaster with the real MUD lines
 * for full concentration and practice outcomes, and checks that power and
 * weight only move once a batch of casts is judged.
 *
 * Usage: npx tsx scripts/test-autocast.ts
 */
import { AutoCaster, DEFAULT_CASTER_CONFIG, isValidBatchRule } from '../src/lib/autoCaster';

// The caster waits 300ms after "You finish practicing" before calling a
// fail. Run those timers by hand so the test is instant.
let nextTimer = 0;
let pending = new Map<number, () => void>();
globalThis.setTimeout = ((fn: () => void) => {
  pending.set(++nextTimer, fn);
  return nextTimer;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => void pending.delete(id)) as typeof clearTimeout;
const flush = () => {
  const run = pending;
  pending = new Map();
  run.forEach((fn) => fn());
};

let failed = 0;
function check(what: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) failed = 1;
}

const BEBT = "You're bright-eyed and bushy-tailed.";
const sent: string[] = [];
const echoed: string[] = [];

const caster = new AutoCaster();
function start(power: number) {
  sent.length = 0;
  echoed.length = 0;
  caster.start(
    'gl',
    power,
    null,
    async (cmd) => void sent.push(cmd),
    (msg) => void echoed.push(msg),
    () => {},
    async (cmd) => void sent.push(cmd)
  );
}

/** One full cast: conc ready, cast goes out, outcome arrives. */
function cast(success: boolean) {
  caster.processServerLine(BEBT);
  caster.processServerLine('You finish practicing.');
  if (success) caster.processServerLine('You think you would have succeeded.');
  else flush();
}
const casts = (pattern: string) => [...pattern].forEach((c) => cast(c === 'S'));
const power = () => caster.getState().power;

// --- Default rule: every 4 casts, 3-4 harder, 2 hold, 0-1 easier ---
caster.configure(DEFAULT_CASTER_CONFIG);
start(200);
cast(true);
check('casts go out at the starting power', sent.includes('cast ! gl @200'));
casts('SS');
check('power holds mid-batch even after 3 successes', power() === 200);
casts('F');
check('3 of 4 makes it harder (power down by 10)', power() === 190);
check('batch counters reset after judging', caster.getState().batchCasts === 0);

casts('SSSS');
check('4 of 4 makes it harder', power() === 180);
casts('SFSF');
check('2 of 4 holds', power() === 180);
check(
  'hold is reported',
  echoed.some((m) => m.includes('holding @180'))
);
casts('SFFF');
check('1 of 4 makes it easier (power up by 20)', power() === 200);
casts('FFFF');
check('0 of 4 makes it easier', power() === 220);
check('cycle count covers every cast', caster.getState().cycleCount === 20);

// --- Manual power change restarts the batch ---
casts('SS');
caster.setPower(300, () => {});
check('setting power restarts the batch', caster.getState().batchCasts === 0);
casts('SS');
check('the two earlier successes no longer count', power() === 300);
casts('SF');
check('next full batch judged from the restart', power() === 290);
caster.stop(() => {});

// --- Weight mode follows the batch too ---
start(50);
casts('SSS');
check('no weight taken mid-batch', !sent.some((c) => c.startsWith('take')));
casts('S');
check('harder at the power floor enters weight mode', caster.getState().weightMode);
check('takes weight once', sent.filter((c) => c.startsWith('take 10 tallow')).length === 1);
casts('SSFF');
check('2 of 4 in weight mode holds the weight', caster.getState().carriedWeight === 10);
casts('FFFS');
check('1 of 4 in weight mode puts weight back', caster.getState().carriedWeight === 5);
caster.stop(() => {});
check('stop returns carried weight', sent.includes('put 5 tallow in bin'));

// --- Custom rule ---
caster.setBatch(1, 1, 0, () => {});
start(200);
cast(true);
check('batch of 1 adjusts after every cast (success)', power() === 190);
cast(false);
check('batch of 1 adjusts after every cast (fail)', power() === 210);
check(
  'batch of 1 keeps the old message wording',
  echoed.some((m) => m === '[Autocast: fail, power → @210]')
);
caster.stop(() => {});

caster.setBatch(6, 5, 2, () => {});
start(200);
casts('SSSSFF');
check('6-cast batch: 4 successes holds when harder needs 5', power() === 200);
casts('SFFSFF');
check('6-cast batch: 2 successes makes it easier', power() === 220);
caster.stop(() => {});

// --- Rule validation ---
check('default rule is valid', isValidBatchRule(4, 3, 1));
check('every-cast rule is valid', isValidBatchRule(1, 1, 0));
check('harder above batch size is rejected', !isValidBatchRule(4, 5, 1));
check('easier overlapping harder is rejected', !isValidBatchRule(4, 2, 2));
check('zero batch size is rejected', !isValidBatchRule(0, 0, 0));
check('missing numbers are rejected', !isValidBatchRule(4, NaN, NaN));

caster.configure({ ...DEFAULT_CASTER_CONFIG, batchSize: 4, harderAt: 9, easierAt: 1 });
check('a bad saved rule falls back to the default', caster.getState().harderAt === 3);

process.exit(failed);
