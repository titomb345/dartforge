/**
 * Inspect mapped rooms against the oracle.
 *
 *   npx tsx scripts/gt/inspect-room.ts <towns.json> <townId> <roomId|name> [more ids...] [--oracle oracle.json]
 *
 * Oracle: --oracle, then GT_ORACLE, then scripts/gt/.cache/oracle.json.
 * <towns.json>: a replay-town.ts --out store or a live map-<char>.json.
 *
 * Prints each room's text, exits, coordinates, visits, the oracle class its
 * text matches (check-towns.ts's matcher, lib/oracle.ts RoomMatcher — the
 * checker may still re-label a drifted room by its links), and every link
 * with the neighbour's class and whether the walked adjacency (oracle
 * edges) confirms that link.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RoomMatcher, loadOracle } from './lib/oracle';

interface Room {
  id: number;
  name: string;
  desc: string;
  x: number;
  y: number;
  z: number;
  visits: number;
  exits: string[];
  exitsEver?: string[];
  namedExits?: string[];
  links: Record<string, number>;
  __origin?: string;
  __merged?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf('--oracle');
const oracleFile =
  oi >= 0 ? args[oi + 1] : (process.env.GT_ORACLE ?? path.join(here, '.cache', 'oracle.json'));
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--oracle'));
const [townsFile, townIdS, ...roomArgs] = pos;
if (!townsFile || townIdS === undefined) {
  console.error('usage: npx tsx scripts/gt/inspect-room.ts <towns.json> <townId> <roomId|name>...');
  process.exit(1);
}

const O = loadOracle(oracleFile);
const matcher = new RoomMatcher(O);
const edgeSet = new Map<string, number>();
for (const e of O.edges) if (!e.skip) edgeSet.set(`${e.from}|${e.move}|${e.to}`, e.n);

let raw = JSON.parse(fs.readFileSync(townsFile, 'utf8'));
if (!raw.towns && raw.townData) raw = raw.townData;
const town = (raw.towns as { id: number; rooms: Room[] }[]).find((t) => t.id === Number(townIdS));
if (!town) throw new Error('no town ' + townIdS);
const rooms = new Map<number, Room>();
for (const r of town.rooms) rooms.set(r.id, r);

const REV: Record<string, string> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  u: 'd',
  d: 'u',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
};

const classOf = (r: Room) => matcher.match(r).cls;

const targets = roomArgs.flatMap((a) =>
  /^\d+$/.test(a) ? [Number(a)] : [...rooms.values()].filter((r) => r.name === a).map((r) => r.id)
);
for (const id of targets) {
  const r = rooms.get(id);
  if (!r) {
    console.log(`#${id}: not found`);
    continue;
  }
  const m = matcher.match(r);
  const c = m.cls;
  console.log(
    `#${r.id} "${r.name}" @(${r.x},${r.y},${r.z}) v${r.visits} exits=[${r.exits}] ` +
      `ever=[${r.exitsEver ?? ''}] named=[${r.namedExits ?? ''}] ` +
      `class=${c ? `c${c.id}[${c.dirs}]x${c.multLB} (${m.kind}${m.ambiguous ? `, ${m.ambiguous} ties` : ''})` : '?'}` +
      `${r.__origin ? ` origin=${r.__origin}` : ''}${r.__merged ? ` merged=${r.__merged}` : ''}`
  );
  console.log(`    ${String(r.desc).slice(0, 260)}`);
  for (const [d, to] of Object.entries(r.links)) {
    const n = rooms.get(to);
    const nc = n ? classOf(n) : null;
    let verdict = '';
    if (c && nc) {
      const fwd = edgeSet.get(`${c.id}|${d}|${nc.id}`);
      const back = edgeSet.get(`${nc.id}|${REV[d]}|${c.id}`);
      verdict = fwd || back ? `walked(n=${(fwd ?? 0) + (back ?? 0)})` : 'NOT WALKED';
    }
    console.log(
      `    -${d}-> #${to} "${n?.name}" ${nc ? `c${nc.id}` : '?'} @(${n?.x},${n?.y},${n?.z}) ${verdict}`
    );
  }
}
