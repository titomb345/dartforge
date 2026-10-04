/**
 * Town engine regression suite — runs every scenario test in
 * scripts/town-tests/ through tsx (in parallel) and reports pass/fail.
 *
 * Usage: npx tsx scripts/test-town.ts
 *
 * These are the guards for hard-won localizer behaviors (each one fixed a
 * real duplication/false-link cascade found live or via replay). Any town
 * engine change must keep them green, alongside the corpus validation:
 *   bash scripts/town-validate.sh     (replays + ground-truth checks + this suite)
 * which runs the live-faithful replay (scripts/replay-town.ts: per-character
 * stores, TCP fragments rejoined, concurrent app instances skipped), the
 * --switch-late model of today's login race, and scores both maps against
 * the ground-truth oracle (scripts/gt/). Measure against a FROZEN corpus
 * copy (DF_SESSIONS / DF_ALIASES / GT_ORACLE): the Dropbox sessions dir grows
 * every day and moves every number.
 *
 * Baseline (Oct 3 2026, frozen corpus of 186 session logs 2026-06-19..
 * 2026-10-02, after the bounded-stretch stage): live-faithful replay
 * expected 87.2%, entered 1,435 (every login is an entry now), new-room
 * 483, corrected 206, relocalized 35, jumped 4, link misses 3, merges 2,
 * lost blocks 0, 501 rooms (mazorn 434, trilok 66, garen 1); cardinal links
 * 823 exact (90.0%) / 83 long / 8 off-axis, 0 shared cells, 0 grid errors;
 * ground truth (stage-1 oracle) dup 4, glued towns 2, misplaced rooms 8,
 * links 1003 ok / 1 contradicted, wrong-room 7. The --switch-late race
 * (closed live by the app-wiring stage's login hold; the mode now models
 * the app before it): merges 3, 502 rooms, ground truth dup 4. The
 * app-wiring stage (live line wiring, login hold, walk executor, session
 * log, OutputFilter) changed none of these numbers. (Teleport /
 * forced-move / dark / door / anchor / login stage: the same localization
 * numbers with the half-plane stretch, cardinal links 755 exact (82.6%) /
 * 148 long / 11 off-axis; parser stage: 87.1%, corrected 226, jumped 6, link misses 7,
 * 502 rooms, dup 5, glued towns 4, misplaced 25, wrong-room 8; queue stage:
 * jumped 11, link misses 13, lost blocks 13, 505 rooms, dup 10, misplaced
 * 31, wrong-room 10; lockstep-merge stage: 86.4%, new-room 511, link misses
 * 51, 533 rooms, dup 35, wrong-room 40; harness stage, engine unchanged:
 * new-room 517, 544 rooms, dup 46; race dup 64.) Older baselines (single
 * shared store, raw log lines: 85.6% / 641 rooms / Eris glued to Soriktos)
 * are not comparable.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'town-tests');
const tests = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith('test-') && f.endsWith('.ts'))
  .sort();

function runTest(test: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // One command string: npx is a .cmd shim on Windows, which needs a shell
    const child = spawn(`npx tsx "${path.join(dir, test)}"`, { shell: true });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

// Each test is its own process; run a few at a time, report in name order
const results = new Array<Promise<{ ok: boolean; output: string }>>(tests.length);
const width = Math.max(1, Math.min(8, os.cpus().length));
let next = 0;
const lanes = Array.from({ length: width }, async () => {
  while (next < tests.length) {
    const i = next++;
    results[i] = runTest(tests[i]);
    await results[i];
  }
});
await Promise.all(lanes);

let failed = 0;
for (let i = 0; i < tests.length; i++) {
  const { ok, output } = await results[i];
  if (ok) {
    console.log(`PASS  ${tests[i]}`);
  } else {
    failed++;
    console.log(`FAIL  ${tests[i]}`);
    console.log(output.split('\n').slice(-15).join('\n'));
  }
}

console.log(`\n${tests.length - failed}/${tests.length} town regression tests passed`);
process.exit(failed > 0 ? 1 : 0);
