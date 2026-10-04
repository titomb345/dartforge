/**
 * Self-test of the ground-truth checker: does check-towns.ts catch planted
 * defects? Takes a real map (a character's replay store, e.g.
 * towns-mazorn.json from replay-town.ts --out) and plants, one at a time:
 *   1. a duplicate of the Eris Gatehouse (unlinked copy)  → dup +1
 *   2. Ash Street's s-link rewired to the plaza center     → 1 more contradicted link
 *   3. the keep Day Room moved up one floor                → "+1 floor(s) off"
 *
 *   npx tsx scripts/gt/check-selftest.ts <towns-mazorn.json> [--oracle oracle.json]
 *
 * Exits non-zero when a planted defect goes unnoticed.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface Room {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  exits: string[];
  links: Record<string, number>;
  namedLinks?: Record<string, number>;
}
interface Store {
  towns: { id: number; name: string; rooms: Room[]; nextRoomId: number }[];
}
interface CheckJson {
  totals: { dup: number; con: number; fl: number };
  contradicted: { from: string; dir: string; expected: string }[];
  floorIssues: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf('--oracle');
const oracle =
  oi >= 0 ? args[oi + 1] : (process.env.GT_ORACLE ?? path.join(here, '.cache', 'oracle.json'));
const input = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--oracle'));
if (!input) {
  console.error('usage: npx tsx scripts/gt/check-selftest.ts <towns.json> [--oracle oracle.json]');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-selftest-'));

function check(store: Store, label: string): CheckJson {
  const f = path.join(tmp, `${label}.json`);
  const out = path.join(tmp, `${label}-check.json`);
  fs.writeFileSync(f, JSON.stringify(store));
  // One command string: npx is a .cmd shim on Windows, which needs a shell
  const cmd = `npx tsx "${path.join(here, 'check-towns.ts')}" "${f}" --oracle "${oracle}" --json "${out}"`;
  const res = spawnSync(cmd, { encoding: 'utf8', shell: true });
  if (res.status !== 0) throw new Error(`check-towns failed:\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(fs.readFileSync(out, 'utf8')) as CheckJson;
}

const original = JSON.parse(fs.readFileSync(input, 'utf8')) as Store;
const clone = () => JSON.parse(JSON.stringify(original)) as Store;
/** The town holding the Eris market plaza (its center is the 8-exit Market) */
function erisOf(s: Store) {
  const town = s.towns.find((t) =>
    t.rooms.some((r) => r.name === 'Market' && r.exits.length === 8)
  );
  if (!town) throw new Error('no town with the Eris plaza center in ' + input);
  return town;
}
const named = (rooms: Room[], name: string) => {
  const r = rooms.find((x) => x.name === name);
  if (!r) throw new Error(`no "${name}" room in the Eris town`);
  return r;
};

const base = check(original, 'base');
let failed = 0;
const verdict = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};
console.log(
  `baseline: dup=${base.totals.dup} contradicted=${base.totals.con} floorErr=${base.totals.fl}`
);

{
  const s = clone();
  const town = erisOf(s);
  const gate = named(town.rooms, 'Gatehouse');
  town.rooms.push({ ...gate, id: town.nextRoomId++, x: gate.x + 99, links: {}, namedLinks: {} });
  const r = check(s, 'dup');
  verdict(
    r.totals.dup === base.totals.dup + 1,
    `planted duplicate Gatehouse: dup ${base.totals.dup} → ${r.totals.dup}`
  );
}
{
  const s = clone();
  const town = erisOf(s);
  const ash = named(town.rooms, 'Ash Street');
  const center = town.rooms.find((r) => r.name === 'Market' && r.exits.length === 8)!;
  if (ash.links.s === undefined) throw new Error('Ash Street has no s-link to rewire');
  ash.links.s = center.id;
  const r = check(s, 'link');
  const hit = r.contradicted.find((c) => c.from.startsWith('Ash Street') && c.dir === 's');
  verdict(
    r.totals.con === base.totals.con + 1 && !!hit,
    `rewired Ash Street -s-> plaza center: contradicted ${base.totals.con} → ${r.totals.con}` +
      (hit ? ` (walks say -s-> ${hit.expected})` : '')
  );
}
{
  const s = clone();
  const town = erisOf(s);
  const day = named(town.rooms, 'Day Room');
  day.z += 1;
  const r = check(s, 'floor');
  const hit = r.floorIssues.find((f) => f.includes('Day Room') && f.includes('+1 floor'));
  verdict(
    !!hit && r.totals.fl === base.totals.fl + 1,
    `Day Room moved up a floor: ${hit ?? 'not reported'}`
  );
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} self-test(s) FAILED` : 'checker self-tests passed');
process.exit(failed ? 1 : 0);
