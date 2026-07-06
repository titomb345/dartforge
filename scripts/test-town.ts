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
 * Baseline (July 2026, Dropbox sessions dir currently holds 48 logs; the
 * dir drifts over time — older notes cite 44 logs / 71.5% and 166 logs /
 * 78.3%; re-baseline against main when it moves): expected ≥ 69.3%,
 * 0 lost, town 1 "Eris Road" ≈ 123 rooms, dup fingerprint groups ≤ 9.
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
