/**
 * Town engine regression suite — runs every scenario test in
 * scripts/town-tests/ through tsx and reports pass/fail.
 *
 * Usage: npx tsx scripts/test-town.ts
 *
 * These are the guards for hard-won localizer behaviors (each one fixed a
 * real duplication/false-link cascade found live or via replay). Any town
 * engine change must keep them green, alongside the corpus replay:
 *   npx tsx scripts/replay-town.ts --dartforge
 * Baseline (July 9 2026, Dropbox sessions dir currently holds 68 logs;
 * the dir drifts over time — older notes cite 51 logs / 71.8%, 48 logs /
 * 71.2%, 166 logs / 78.3%; re-baseline against main when it moves):
 * expected ≈ 81.9%, 0 lost, 13 towns, town 5 "Cloister Garth" ≈ 138
 * rooms / town 1 "Eris Road" ≈ 113 rooms, dup fingerprint groups (3+)
 * ≈ 12 (all LEGIT word-identical rooms: the Eris Market, the keep's
 * Vestibules and mirror-wing Bedchambers, the Blue Pearl Inn's
 * per-floor Hallway segments, the Soriktos Souk's sides, Jacinth
 * Street's segments, the Royal Stables' satellite Stalls), link misses
 * ≈ 7, link heals 0, jumped ≈ 7, blocks parsed ≈ 99.9%. This baseline
 * (soft-fail queue repair + twin-satellite guard + contradicted-link
 * cleanse, plus the replay now expanding `door <dir>` like the live
 * alias engine — see test-soft-fail-desync.ts) moved it from 74.9%
 * expected / 36 jumped / 28 link misses: door crossings used to replay
 * as floaters and the Eris keep counted 15 Vestibules (real: 4).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'town-tests');
const tests = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith('test-') && f.endsWith('.ts'))
  .sort();

let failed = 0;
for (const test of tests) {
  const file = path.join(dir, test);
  const res = spawnSync('npx', ['tsx', file], {
    encoding: 'utf8',
    timeout: 120_000,
    shell: process.platform === 'win32',
  });
  if (res.status === 0) {
    console.log(`PASS  ${test}`);
  } else {
    failed++;
    console.log(`FAIL  ${test}`);
    console.log((res.stdout + res.stderr).split('\n').slice(-15).join('\n'));
  }
}

console.log(`\n${tests.length - failed}/${tests.length} town regression tests passed`);
process.exit(failed > 0 ? 1 : 0);
