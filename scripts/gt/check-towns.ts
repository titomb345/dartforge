/**
 * Ground-truth checker for town maps.
 *
 *   npx tsx scripts/gt/check-towns.ts <towns.json> [more stores...] [--oracle oracle.json]
 *        [--json out.json] [--place <label>] [--details] [--examples N]
 *
 * <towns.json> is TownMapStore.serialize() output (replay-town.ts --out, or a
 * live save's "townData" value — a map-<char>.json file is accepted too).
 * Several stores (one per character, like the live app: replay-town.ts
 * --out towns.json writes towns-<char>.json) are checked together —
 * duplicates per store, unmapped truth against the union.
 * The oracle comes from build-oracle.ts (see its header): --oracle, then
 * GT_ORACLE, then scripts/gt/.cache/oracle.json. The last line,
 * "GT-SUMMARY ...", is the one-line A/B summary (dup per place, dupByOrigin
 * when the map was replayed with replay-town.ts --tag-origins, glued towns,
 * misplacedRooms = rooms of a minority place inside a glued town, link
 * verdicts, floor errors, identity drift, exitsEver pollution).
 *
 * Self-tests (2026-10-02): an injected duplicate Gatehouse raised dup by 1;
 * Ash Street's s-link rewired to the plaza center was reported contradicted
 * ("walks say -s-> Market#c200 (n=207)"); a Day Room moved up one floor was
 * reported "+1 floor(s) off". Floor checks compare rooms only within one
 * oracle floor-graph component (zero points are arbitrary per component —
 * the previous per-place comparison produced 4 false floor errors).
 *
 * Known limits: multiplicity is an adjacency-proven LOWER bound, so copies of
 * a twin the walks never proved (one hallway end per inn floor) are reported
 * as duplicates "each on its own floor" — eyeball those; rooms never walked
 * in the DF era have no DF-era class; places split where walks break, so a
 * small area entered by a special command (leap, pull lever) can show up as
 * "glued" to its real neighbour.
 *
 * Every mapped room is matched to an oracle CLASS (genuinely distinct room
 * text, volatile prose removed); then, per PLACE (physically continuous
 * area: Eris incl. the rangers' keep, Soriktos, the Knights' commandery,
 * Tobermore, the OOC hall, ...):
 *   - true distinct texts seen in the DF era vs mapped rooms
 *   - DUPLICATES: rooms mapped for a class beyond its physical multiplicity
 *     (multiplicity = adjacency-proven lower bound, so word-identical twins
 *     are not counted as duplicates)
 *   - UNMAPPED: DF-era classes with no mapped room (their sightings were
 *     filed under other rooms — over-merge — or the block never parsed)
 *   - GLUE: towns holding rooms of several places
 *   - LINKS: each mapped link checked against walked adjacency:
 *       confirmed / contradicted (walks say that exit leads elsewhere) /
 *       impossible (the class's exits line lacks the direction) / unverified;
 *     MISSING: walked edges between two singly-mapped classes of one town
 *     that the map does not link
 *   - FLOORS: mapped z vs oracle floor (from walked u/d) per place/town
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  RoomMatcher,
  loadOracle,
  type OracleClass as OClass,
  type OracleEdge as OEdge,
  type RoomMatch,
} from './lib/oracle';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(['--oracle', '--json', '--place', '--examples']);
const townsFiles = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.has(args[i - 1]))
);
const townsFile = townsFiles.join(' + ');
if (!townsFiles.length) {
  console.error(
    'usage: npx tsx check-towns.ts <towns.json> [more stores...] [--oracle oracle.json] [--json out.json] [--place label] [--details]'
  );
  process.exit(1);
}
const oracleFile =
  argValue('--oracle') ?? process.env.GT_ORACLE ?? path.join(here, '.cache', 'oracle.json');
const jsonOut = argValue('--json');
const placeFilter = argValue('--place');
const details = args.includes('--details');
const exampleCap = Number(argValue('--examples') ?? 8);

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
const O = loadOracle(oracleFile);
const C = O.classes;

interface Room {
  id: number;
  name: string;
  desc: string;
  descFirst: string;
  x: number;
  y: number;
  z: number;
  exits: string[];
  exitsEver?: string[];
  namedExits?: string[];
  links: Record<string, number>;
  namedLinks?: Record<string, number>;
  visits: number;
  /** provenance stamped by replay-town.ts --tag-origins */
  __origin?: string;
  __merged?: string;
}
interface TownJ {
  id: number;
  name: string;
  rooms: Room[];
}
// Several stores (one per character, like the live app) are checked
// together: duplicates are counted PER STORE (characters map independently),
// unmapped truth against the union. Town ids are offset by 1000 per store.
const towns: (TownJ & { store: number })[] = [];
townsFiles.forEach((f, si) => {
  let raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (raw && !raw.towns && raw.townData) raw = raw.townData; // live map-<char>.json
  for (const t of (raw.towns ?? []) as TownJ[])
    towns.push({ ...t, id: t.id + si * 1000, store: si });
});

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
const placeLabel = (p: number) => (p >= 0 ? O.places[p].label : p === -2 ? 'MULTI' : 'unplaced');
const classPlaces = (c: OClass): number[] =>
  c.places && c.places.length ? c.places : c.place >= 0 ? [c.place] : [];

// ---------------------------------------------------------------------------
// Room → class matching (shared with inspect-room.ts)
// ---------------------------------------------------------------------------
const matcher = new RoomMatcher(O);
const byName = matcher.byName;

// ---------------------------------------------------------------------------
// Oracle floors: relative z per class from walked u/d (BFS per place)
// ---------------------------------------------------------------------------
/** Oracle floor (relative z) per class, and the floor-graph component it was
 *  measured in — zero points are arbitrary per component, so floors are only
 *  comparable WITHIN one component. */
const oz = new Map<number, number>();
const ozComp = new Map<number, number>();
{
  const adj = new Map<number, [number, number][]>();
  const add = (a: number, b: number, dz: number) =>
    (adj.get(a) ?? adj.set(a, []).get(a)!).push([b, dz]);
  for (const e of O.edges) {
    if (e.skip || e.n < 2 || e.from === e.to || e.move.startsWith('named:')) continue;
    const ca = C[e.from];
    const cb = C[e.to];
    if (ca.multLB > 1 || cb.multLB > 1) continue; // twins can sit on several floors
    const dz = e.move === 'u' ? 1 : e.move === 'd' ? -1 : 0;
    add(e.from, e.to, dz);
    add(e.to, e.from, -dz);
  }
  for (const start of adj.keys()) {
    if (oz.has(start)) continue;
    oz.set(start, 0);
    ozComp.set(start, start);
    const q = [start];
    while (q.length) {
      const x = q.shift()!;
      for (const [y, dz] of adj.get(x)!) {
        if (oz.has(y)) continue;
        oz.set(y, oz.get(x)! + dz);
        ozComp.set(y, start);
        q.push(y);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Oracle adjacency lookups
// ---------------------------------------------------------------------------
const outBy = new Map<string, OEdge[]>(); // `${from}|${move}` → edges
for (const e of O.edges) {
  if (e.skip) continue;
  const k = `${e.from}|${e.move}`;
  (outBy.get(k) ?? outBy.set(k, []).get(k)!).push(e);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
interface MappedRoom {
  town: number;
  room: Room;
  m: RoomMatch;
}
const mapped: MappedRoom[] = [];
const matchKinds: Record<string, number> = {};
for (const t of towns) {
  for (const r of t.rooms) {
    const m = matcher.match(r);
    matchKinds[m.kind] = (matchKinds[m.kind] ?? 0) + 1;
    mapped.push({ town: t.id, room: r, m });
  }
}
const roomKey = (town: number, id: number) => `${town}:${id}`;
const byRoom = new Map<string, MappedRoom>();
for (const mr of mapped) byRoom.set(roomKey(mr.town, mr.room.id), mr);

// ---------------------------------------------------------------------------
// Identity drift: the engine's touchRoom overwrites a room's desc/exits with
// whatever block got assigned to it, so ONE wrong assignment re-labels the
// room for good (its text then says "northern edge" while its links are the
// north-east corner's). Text alone would mis-classify such rooms; re-label
// them by their LINKS when the links clearly fit another same-named class.
// ---------------------------------------------------------------------------
const textClass = new Map<string, OClass | null>();
for (const mr of mapped) textClass.set(roomKey(mr.town, mr.room.id), mr.m.cls);
const edgeExists = (a: number, d: string, b: number) =>
  (outBy.get(`${a}|${d}`) ?? []).some((e) => e.to === b) ||
  (outBy.get(`${b}|${REV[d] ?? ''}`) ?? []).some((e) => e.to === a);
const strongOut = (a: number, d: string) => (outBy.get(`${a}|${d}`) ?? []).filter((e) => e.n >= 2);
function linkScore(mr: MappedRoom, cls: OClass): { ok: number; bad: number } {
  let ok = 0;
  let bad = 0;
  for (const [d, toId] of Object.entries(mr.room.links)) {
    const nb = byRoom.get(roomKey(mr.town, toId));
    const nc = nb?.m.cls;
    if (!nc) continue;
    if (edgeExists(cls.id, d, nc.id)) ok++;
    else if (strongOut(cls.id, d).length) bad++;
  }
  return { ok, bad };
}
const drifted: { room: MappedRoom; from: OClass; to: OClass; before: string; after: string }[] = [];
for (let iter = 0; iter < 3; iter++) {
  for (const mr of mapped) {
    const cur = mr.m.cls;
    if (!cur) continue;
    const curS = linkScore(mr, cur);
    if (curS.bad === 0) continue;
    let best: OClass | null = null;
    let bestS = curS;
    for (const alt of byName.get(mr.room.name) ?? []) {
      if (alt.id === cur.id || alt.nD === 0) continue;
      const s = linkScore(mr, alt);
      // the links must fit the alternative clearly better: more confirmed,
      // fewer contradicted, and at least two confirmations
      if (s.ok >= 2 && s.ok - s.bad > bestS.ok - bestS.bad + 1) {
        best = alt;
        bestS = s;
      }
    }
    if (best) {
      mr.m = { cls: best, kind: mr.m.kind, ambiguous: mr.m.ambiguous };
    }
  }
}
for (const mr of mapped) {
  const t = textClass.get(roomKey(mr.town, mr.room.id));
  if (t && mr.m.cls && t.id !== mr.m.cls.id) {
    const before = linkScore(mr, t);
    const after = linkScore(mr, mr.m.cls);
    drifted.push({
      room: mr,
      from: t,
      to: mr.m.cls,
      before: `${before.ok} ok/${before.bad} contradicted`,
      after: `${after.ok} ok/${after.bad} contradicted`,
    });
  }
}

// Per class: mapped rooms
const roomsOfClass = new Map<number, MappedRoom[]>();
for (const mr of mapped) {
  if (!mr.m.cls) continue;
  (roomsOfClass.get(mr.m.cls.id) ?? roomsOfClass.set(mr.m.cls.id, []).get(mr.m.cls.id)!).push(mr);
}

// Place of a mapped room: its class's place; a cross-place twin takes the
// place most of its LINKED neighbours belong to.
function roomPlace(mr: MappedRoom): number {
  const c = mr.m.cls;
  if (!c) return -1;
  const ps = classPlaces(c);
  if (ps.length === 1) return ps[0];
  if (ps.length === 0) return -1;
  const votes = new Map<number, number>();
  const t = towns.find((x) => x.id === mr.town)!;
  const rooms = new Map(t.rooms.map((r) => [r.id, r]));
  for (const id of [...Object.values(mr.room.links), ...Object.values(mr.room.namedLinks ?? {})]) {
    const nb = rooms.get(id);
    const nm = nb ? byRoom.get(roomKey(mr.town, nb.id)) : undefined;
    const nc = nm?.m.cls;
    if (!nc) continue;
    const nps = classPlaces(nc);
    if (nps.length === 1) votes.set(nps[0], (votes.get(nps[0]) ?? 0) + 1);
  }
  let best = -2;
  let bestV = 0;
  for (const [p, v] of votes) if (v > bestV) [best, bestV] = [p, v];
  return best;
}
const placeOfRoom = new Map<string, number>();
for (const mr of mapped) placeOfRoom.set(roomKey(mr.town, mr.room.id), roomPlace(mr));

// ---- duplicates / unmapped per place ----
interface PlaceStats {
  label: string;
  trueTexts: number; // DF-era classes (unique + twins attached)
  trueRoomsLB: number; // sum of multiplicity lower bounds
  mapped: number;
  matchedClasses: number;
  duplicates: number;
  dupFloorDistinct: number;
  dupClasses: { cls: string; mapped: number; mult: number; rooms: string[] }[];
  unmapped: { cls: string; nD: number; ex: string | null }[];
  towns: Record<string, number>;
  links: { confirmed: number; contradicted: number; impossible: number; unverified: number };
  missing: number;
  floorErrors: number;
  dupByOrigin: Record<string, number>;
}
const stats = new Map<number, PlaceStats>();
const ensure = (p: number): PlaceStats => {
  let s = stats.get(p);
  if (!s) {
    s = {
      label: placeLabel(p),
      trueTexts: 0,
      trueRoomsLB: 0,
      mapped: 0,
      matchedClasses: 0,
      duplicates: 0,
      dupFloorDistinct: 0,
      dupClasses: [],
      unmapped: [],
      towns: {},
      links: { confirmed: 0, contradicted: 0, impossible: 0, unverified: 0 },
      missing: 0,
      floorErrors: 0,
      dupByOrigin: {},
    };
    stats.set(p, s);
  }
  return s;
};
const multIn = (c: OClass, p: number) =>
  c.multByPlace && c.multByPlace[p] !== undefined ? c.multByPlace[p] : c.multLB;
for (const c of C) {
  if (c.nD === 0) continue;
  for (const p of classPlaces(c)) {
    const s = ensure(p);
    s.trueTexts++;
    s.trueRoomsLB += multIn(c, p);
  }
}
for (const mr of mapped) {
  const p = placeOfRoom.get(roomKey(mr.town, mr.room.id))!;
  const s = ensure(p);
  s.mapped++;
  const tn = `${mr.town}`;
  s.towns[tn] = (s.towns[tn] ?? 0) + 1;
}
const storeOfTown = new Map(towns.map((t) => [t.id, t.store]));
/** Surplus duplicates by provenance (untagged maps report 'untagged') */
const dupByOrigin: Record<string, number> = {};
const originOf = (r: Room): string =>
  r.__merged ? 'merge-copy' : r.__origin ? r.__origin.split('@')[0] : 'untagged';
for (const c of C) {
  const rooms = roomsOfClass.get(c.id) ?? [];
  const byPlace = new Map<string, MappedRoom[]>(); // `${store}|${place}`
  for (const mr of rooms) {
    const p = placeOfRoom.get(roomKey(mr.town, mr.room.id))!;
    const k = `${storeOfTown.get(mr.town)}|${p}`;
    (byPlace.get(k) ?? byPlace.set(k, []).get(k)!).push(mr);
  }
  for (const [k, list] of byPlace) {
    const p = Number(k.split('|')[1]);
    const s = ensure(p);
    s.matchedClasses++;
    const m = p >= 0 ? multIn(c, p) : c.multLB;
    if (list.length > m) {
      const extra = list.length - m;
      s.duplicates += extra;
      // copies that each sit on their own floor may be mirror-floor twins
      // the adjacency lower bound could not prove (e.g. one hallway end per
      // inn floor) — reported separately so they can be eyeballed
      const zs = new Set(list.map((mr) => `${mr.town}|${mr.room.z}`));
      const floorDistinct = zs.size === list.length;
      if (floorDistinct) s.dupFloorDistinct += extra;
      // The `m` most-visited copies stand for the physical rooms; the rest
      // are the surplus, attributed to how they were made (replays run with
      // replay-town.ts --tag-origins stamp __origin/__merged).
      const ranked = [...list].sort((a, b) => b.room.visits - a.room.visits);
      for (const mr of ranked.slice(m)) {
        const o = originOf(mr.room);
        dupByOrigin[o] = (dupByOrigin[o] ?? 0) + 1;
        s.dupByOrigin[o] = (s.dupByOrigin[o] ?? 0) + 1;
      }
      const tag = (r: Room) =>
        r.__merged
          ? ` [merge-copy ${r.__merged}; ${r.__origin ?? ''}]`
          : r.__origin
            ? ` [${r.__origin}]`
            : '';
      s.dupClasses.push({
        cls: `${c.name}#${c.id}[${c.dirs}]${floorDistinct ? ' (each copy on its own floor: maybe mirror-floor twins)' : ''}`,
        mapped: list.length,
        mult: m,
        rooms: ranked.map(
          (mr) =>
            `t${mr.town}#${mr.room.id}@(${mr.room.x},${mr.room.y},${mr.room.z})v${mr.room.visits}${tag(mr.room)}`
        ),
      });
    }
  }
  if (c.nD > 0 && rooms.length === 0) {
    for (const p of classPlaces(c))
      ensure(p).unmapped.push({ cls: `${c.name}#${c.id}[${c.dirs}]`, nD: c.nD, ex: c.exD });
  }
}

// ---- links ----
interface LinkIssue {
  place: string;
  town: number;
  from: string;
  dir: string;
  to: string;
  expected: string;
  evidence: string;
}
const contradicted: LinkIssue[] = [];
const impossible: LinkIssue[] = [];
const missingLinks: LinkIssue[] = [];
const desc = (mr: MappedRoom) =>
  `${mr.room.name}#${mr.room.id}${mr.m.cls ? `(c${mr.m.cls.id})` : ''}@(${mr.room.x},${mr.room.y},${mr.room.z})`;
for (const mr of mapped) {
  const p = placeOfRoom.get(roomKey(mr.town, mr.room.id))!;
  const s = ensure(p);
  const ca = mr.m.cls;
  for (const [dir, toId] of Object.entries(mr.room.links)) {
    const tb = byRoom.get(roomKey(mr.town, toId));
    const cb = tb?.m.cls;
    if (!ca || !cb) {
      s.links.unverified++;
      continue;
    }
    if (!ca.dirs.includes(dir) && ca.named.length === 0) {
      // the class's exits line never lists this direction
      const allSame = C.filter((x) => x.group === ca.group).some((x) => x.dirs.includes(dir));
      if (!allSame) {
        s.links.impossible++;
        impossible.push({
          place: s.label,
          town: mr.town,
          from: desc(mr),
          dir,
          to: desc(tb!),
          expected: `${ca.name} exits [${ca.dirs}]`,
          evidence: ca.exD ?? ca.ex,
        });
        continue;
      }
    }
    const fwd = outBy.get(`${ca.id}|${dir}`) ?? [];
    if (fwd.some((e) => e.to === cb.id)) {
      s.links.confirmed++;
      continue;
    }
    const back = outBy.get(`${cb.id}|${REV[dir]}`) ?? [];
    if (back.some((e) => e.to === ca.id)) {
      s.links.confirmed++;
      continue;
    }
    const strongFwd = fwd.filter((e) => e.n >= 2);
    if (strongFwd.length) {
      s.links.contradicted++;
      contradicted.push({
        place: s.label,
        town: mr.town,
        from: desc(mr),
        dir,
        to: desc(tb!),
        expected: strongFwd.map((e) => `${C[e.to].name}#c${e.to}(n=${e.n})`).join(' | '),
        evidence: strongFwd[0].ex[0],
      });
    } else s.links.unverified++;
  }
}
// missing: walked edges between classes mapped exactly once in one town
for (const e of O.edges) {
  if (e.skip || e.n < 2 || e.move.startsWith('named:') || e.from === e.to) continue;
  const ra = roomsOfClass.get(e.from) ?? [];
  const rb = roomsOfClass.get(e.to) ?? [];
  if (ra.length !== 1 || rb.length !== 1) continue;
  if (C[e.from].multLB > 1 || C[e.to].multLB > 1) continue;
  const a = ra[0];
  const b = rb[0];
  if (a.town !== b.town) continue;
  if (a.room.links[e.move] === b.room.id) continue;
  const p = placeOfRoom.get(roomKey(a.town, a.room.id))!;
  const s = ensure(p);
  s.missing++;
  missingLinks.push({
    place: s.label,
    town: a.town,
    from: desc(a),
    dir: e.move,
    to: desc(b),
    expected:
      a.room.links[e.move] !== undefined
        ? `map links ${e.move} to #${a.room.links[e.move]}`
        : 'no link',
    evidence: `${e.ex[0]} (n=${e.n})`,
  });
}

// ---- floors ----
const floorIssues: string[] = [];
{
  const groups = new Map<string, MappedRoom[]>(); // town|place|floor-component → rooms with oracle z
  for (const mr of mapped) {
    const c = mr.m.cls;
    if (!c || !oz.has(c.id)) continue;
    if ((roomsOfClass.get(c.id) ?? []).length !== 1 || c.multLB > 1) continue;
    const p = placeOfRoom.get(roomKey(mr.town, mr.room.id))!;
    const k = `${mr.town}|${p}|${ozComp.get(c.id)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(mr);
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const offs = new Map<number, number>();
    for (const mr of list) {
      const off = mr.room.z - oz.get(mr.m.cls!.id)!;
      offs.set(off, (offs.get(off) ?? 0) + 1);
    }
    let modal = 0;
    let modalN = -1;
    for (const [o, n] of offs) if (n > modalN) [modal, modalN] = [o, n];
    const p = Number(k.split('|')[1]);
    const s = ensure(p);
    for (const mr of list) {
      const off = mr.room.z - oz.get(mr.m.cls!.id)!;
      if (off !== modal) {
        s.floorErrors++;
        if (floorIssues.length < 200)
          floorIssues.push(
            `${s.label} town ${k.split('|')[0]}: ${desc(mr)} is ${off - modal > 0 ? '+' : ''}${off - modal} floor(s) off`
          );
      }
    }
  }
}

// ---- exitsEver pollution: exits a room never had, granted by wrong
// assignments (touchRoom unions every assigned block's exits forever) ----
const polluted: string[] = [];
let pollutedRooms = 0;
for (const mr of mapped) {
  const c = mr.m.cls;
  if (!c || !mr.room.exitsEver) continue;
  const allowed = new Set(c.dirs);
  // same-text classes with other exit sets may be exit-STATE variants
  for (const x of byName.get(c.name) ?? [])
    if (x.canon === c.canon) x.dirs.forEach((d) => allowed.add(d));
  const extra = mr.room.exitsEver.filter((d) => !allowed.has(d));
  if (extra.length) {
    pollutedRooms++;
    if (polluted.length < 60)
      polluted.push(
        `t${mr.town} ${desc(mr)} exitsEver=[${mr.room.exitsEver}] true=[${c.dirs}] extra=[${extra}]`
      );
  }
}

// ---- glue ----
const glue: { town: number; name: string; rooms: number; places: Record<string, number> }[] = [];
/** Rooms of a minority place inside a glued town (the size of the glue) */
let misplaced = 0;
for (const t of towns) {
  const cnt: Record<string, number> = {};
  for (const r of t.rooms) {
    const p = placeOfRoom.get(roomKey(t.id, r.id))!;
    const l = placeLabel(p);
    cnt[l] = (cnt[l] ?? 0) + 1;
  }
  const real = Object.entries(cnt).filter(([l, n]) => l !== 'unplaced' && l !== 'MULTI' && n >= 2);
  if (real.length >= 2) {
    glue.push({ town: t.id, name: t.name, rooms: t.rooms.length, places: cnt });
    const maj = Math.max(...real.map(([, n]) => n));
    misplaced += real.reduce((a, [, n]) => a + n, 0) - maj;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const lines: string[] = [];
const log = (s = '') => lines.push(s);
const totalRooms = mapped.length;
log(`Towns file: ${townsFile}`);
log(
  `Mapped rooms: ${totalRooms} in ${towns.length} towns; class match: ${Object.entries(matchKinds)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')}`
);
const order = [...stats.entries()]
  .filter(([p]) => p >= 0)
  .sort((a, b) => b[1].mapped - a[1].mapped);
log('');
log('Per place (truth = DF-era distinct texts / rooms lower bound):');
log(
  '  place                       truth(texts/roomsLB)  mapped  dup  unmapped  links ok/contra/impossible/unverif  missing  floorErr  towns'
);
let tot = { dup: 0, dupFloor: 0, unm: 0, unm2: 0, ok: 0, con: 0, imp: 0, unv: 0, mis: 0, fl: 0 };
for (const [p, s] of order) {
  if (placeFilter && s.label !== placeFilter) continue;
  tot = {
    dup: tot.dup + s.duplicates,
    dupFloor: tot.dupFloor + s.dupFloorDistinct,
    unm: tot.unm + s.unmapped.length,
    unm2: tot.unm2 + s.unmapped.filter((u) => u.nD >= 2).length,
    ok: tot.ok + s.links.confirmed,
    con: tot.con + s.links.contradicted,
    imp: tot.imp + s.links.impossible,
    unv: tot.unv + s.links.unverified,
    mis: tot.mis + s.missing,
    fl: tot.fl + s.floorErrors,
  };
  if (s.mapped === 0 && s.trueTexts < 5) continue;
  log(
    `  [${p}] ${s.label.padEnd(24)} ${String(s.trueTexts).padStart(5)}/${String(s.trueRoomsLB).padEnd(5)}         ${String(s.mapped).padStart(5)}  ${String(s.duplicates).padStart(4)}  ${String(s.unmapped.length).padStart(7)}  ` +
      `${String(s.links.confirmed).padStart(5)}/${s.links.contradicted}/${s.links.impossible}/${s.links.unverified}`.padEnd(
        37
      ) +
      `${String(s.missing).padStart(6)}  ${String(s.floorErrors).padStart(8)}  ${Object.entries(
        s.towns
      )
        .map(([t, n]) => `t${t}:${n}`)
        .join(' ')}`
  );
}
const unplaced = stats.get(-1);
const multi = stats.get(-2);
log(
  `  unplaced rooms (class not in any DF place / unmatched): ${unplaced?.mapped ?? 0}; cross-place twins unresolved: ${multi?.mapped ?? 0}`
);
log(
  `  TOTAL: duplicates ${tot.dup} (of which ${tot.dupFloor} are copies on distinct floors = possible mirror twins), ` +
    `unmapped ${tot.unm} (${tot.unm2} seen 2+ times), links ${tot.ok} confirmed / ${tot.con} contradicted / ` +
    `${tot.imp} impossible / ${tot.unv} unverified, missing ${tot.mis}, floor errors ${tot.fl}, ` +
    `identity drift ${drifted.length}, exitsEver-polluted rooms ${pollutedRooms}`
);

log('');
log(`Glued towns (rooms of 2+ places): ${glue.length}`);
for (const g of glue)
  log(
    `  town ${g.town} "${g.name}" (${g.rooms} rooms): ${Object.entries(g.places)
      .sort((a, b) => b[1] - a[1])
      .map(([l, n]) => `${l}=${n}`)
      .join(', ')}`
  );

for (const [p, s] of order) {
  if (placeFilter && s.label !== placeFilter) continue;
  if (!s.dupClasses.length && !s.unmapped.length) continue;
  if (!details && !placeFilter && s.mapped < 20) continue;
  log('');
  log(`== ${s.label} [${p}] duplicates (${s.duplicates}):`);
  for (const d of s.dupClasses
    .sort((a, b) => b.mapped - b.mult - (a.mapped - a.mult))
    .slice(0, details ? 999 : exampleCap)) {
    log(`   ${d.cls} mapped ${d.mapped} vs ${d.mult} physical: ${d.rooms.join(' ')}`);
  }
  log(`   unmapped DF-era texts (${s.unmapped.length}):`);
  for (const u of s.unmapped.sort((a, b) => b.nD - a.nD).slice(0, details ? 999 : exampleCap))
    log(`   ${u.cls} seen ${u.nD}x in DF, e.g. ${u.ex}`);
}
log('');
log(`Contradicted links (${contradicted.length}):`);
for (const l of contradicted.slice(0, details ? 999 : exampleCap * 3))
  log(
    `   [${l.place}] t${l.town} ${l.from} -${l.dir}-> ${l.to}; walks say -${l.dir}-> ${l.expected}  (${l.evidence})`
  );
log(`Impossible links (${impossible.length}):`);
for (const l of impossible.slice(0, details ? 999 : exampleCap * 2))
  log(`   [${l.place}] t${l.town} ${l.from} -${l.dir}-> ${l.to}; ${l.expected}  (${l.evidence})`);
log(`Missing links (${missingLinks.length}):`);
for (const l of missingLinks.slice(0, details ? 999 : exampleCap * 2))
  log(`   [${l.place}] t${l.town} ${l.from} -${l.dir}-> ${l.to}: ${l.expected}  (${l.evidence})`);
log(`Floor errors (${floorIssues.length}):`);
for (const f of floorIssues.slice(0, details ? 999 : exampleCap * 2)) log(`   ${f}`);
log(
  `Identity drift (room text overwritten by another room's block; links fit a different class): ${drifted.length}`
);
for (const d of drifted.slice(0, details ? 999 : exampleCap * 2))
  log(
    `   t${d.room.town} ${desc(d.room)} text=${d.from.name}#c${d.from.id}[${d.from.dirs}] (${d.before}) -> links=${d.to.name}#c${d.to.id}[${d.to.dirs}] (${d.after})`
  );
log(`exitsEver pollution (exits the true room never lists): ${pollutedRooms} rooms`);
for (const p of polluted.slice(0, details ? 999 : exampleCap * 2)) log(`   ${p}`);

// One line for A/B comparisons (grep GT-SUMMARY)
const perPlaceDup = order
  .filter(([, s]) => s.duplicates > 0)
  .map(([, s]) => `${s.label}=${s.duplicates}`)
  .join(' ');
log('');
log(
  `GT-SUMMARY rooms=${totalRooms} dup=${tot.dup} (${perPlaceDup}) dupByOrigin=${JSON.stringify(dupByOrigin)} ` +
    `unmapped=${tot.unm} gluedTowns=${glue.length} misplacedRooms=${misplaced} ` +
    `links=${tot.ok}/${tot.con}/${tot.imp}/${tot.unv}(ok/contradicted/impossible/unverified) missing=${tot.mis} ` +
    `floorErr=${tot.fl} drift=${drifted.length} polluted=${pollutedRooms}`
);

console.log(lines.join('\n'));
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        townsFile,
        matchKinds,
        places: Object.fromEntries([...stats.entries()].map(([p, s]) => [p, s])),
        totals: tot,
        dupByOrigin,
        misplaced,
        glue,
        contradicted,
        impossible,
        missing: missingLinks,
        floorIssues,
        drift: drifted.map((d) => ({
          town: d.room.town,
          room: d.room.room.id,
          text: d.from.id,
          links: d.to.id,
          before: d.before,
          after: d.after,
        })),
        pollutedRooms,
        polluted,
      },
      null,
      1
    )
  );
  console.log(`\nJSON written to ${jsonOut}`);
}
