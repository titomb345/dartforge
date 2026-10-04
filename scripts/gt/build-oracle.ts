/**
 * Ground-truth oracle builder for the TOWN mapper.
 *
 *   npx tsx scripts/gt/cache-blocks.ts   # once (~60s): parse both corpora
 *   npx tsx scripts/gt/build-oracle.ts [--cache DIR] [--out oracle.json] [--report oracle-report.txt]
 *
 * DIR defaults to scripts/gt/.cache; --out / --report default into it. The
 * oracle is a frozen measuring stick: build it ONCE per corpus freeze and
 * keep the file — rebuilding from a grown corpus moves every number.
 * scripts/gt/overrides.json (optional) forces volatile/stable verdicts:
 * { "<sentence>": "volatile" | "stable" }.
 *
 * Output oracle.json:
 *   classes : genuinely distinct room TEXTS. Identity = name + exits dir-set
 *             + named exits + description minus lighting/weather (closed
 *             vocabularies), client noise, and DETECTED volatile prose
 *             (lib/volatile.ts: temporal witnesses → structural evidence →
 *             lexicon/spread rules). A class can stand for several physical
 *             rooms (word-identical twins): `multLB` is a lower bound.
 *   edges   : class-level adjacency mined from the DF session logs by FIFO
 *             command/block alignment with exits-line reciprocity checks
 *             (lib/align.ts); `skip` marks lost-block artifacts.
 *   places  : physically continuous areas — unions of the UNIQUE classes
 *             visited along single uninterrupted walks (twin texts are
 *             walked through but never bridge: the generic stable "Stall"
 *             text exists in Eris AND Soriktos). Twin classes are attached
 *             to the place(s) of their unique neighbours.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { groupKey, stableSentences } from './lib/canon';
import { alignFile, REV, type EdgeObs, type SamePair } from './lib/align';
import type {
  OracleClass as OClass,
  OracleEdge as OEdge,
  OraclePlace as OPlace,
} from './lib/oracle';
import {
  baseSentences,
  detectVolatile,
  diffSmall,
  type FamilyInfo,
  type StructuralEvidence,
  type VariantLite,
} from './lib/volatile';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const cacheDir = argValue('--cache') ?? path.join(here, '.cache');
const outFile = argValue('--out') ?? path.join(cacheDir, 'oracle.json');
const reportFile = argValue('--report') ?? path.join(cacheDir, 'oracle-report.txt');
const overridesFile = path.join(here, 'overrides.json');

interface Variant {
  i: number;
  name: string;
  dirs: string[];
  named: string[];
  doorDirs: string[];
  desc: string;
  descEngine: string;
  n: number;
  nM: number;
  nD: number;
  first: string;
  last: string;
  files: number;
  ex: string;
}
type Packed = (string | number | boolean | null | string[])[];

const V = JSON.parse(fs.readFileSync(path.join(cacheDir, 'variants.json'), 'utf8')) as Variant[];
const SEQ = JSON.parse(fs.readFileSync(path.join(cacheDir, 'seq.json'), 'utf8')) as {
  file: string;
  src: 'M' | 'D';
  ev: Packed[];
}[];
const overrides: Record<string, 'volatile' | 'stable'> = fs.existsSync(overridesFile)
  ? JSON.parse(fs.readFileSync(overridesFile, 'utf8'))
  : {};

const out: string[] = [];
const log = (s = '') => out.push(s);

// ---------------------------------------------------------------------------
// 1. Alignment: edge observations + same-room pairs
// ---------------------------------------------------------------------------
const groupOf = V.map((v) => groupKey(v.name, v.dirs, v.named));
const info = (i: number) => ({
  v: i,
  dirs: V[i].dirs,
  named: V[i].named,
  namedAll: (V[i] as Variant & { namedAll?: string[] }).namedAll ?? [],
  group: groupOf[i],
});
const edgeObs: EdgeObs[] = [];
const same: SamePair[] = [];
{
  let chainBase = 0;
  for (const src of ['M', 'D'] as const) {
    const carry = { prev: null as number | null, loginPending: false, chain: chainBase };
    for (const f of SEQ.filter((s) => s.src === src))
      alignFile(f.file, f.ev, info, edgeObs, same, carry);
    chainBase = carry.chain + 1;
  }
}
const lite: VariantLite[] = V.map((v) => ({
  i: v.i,
  group: groupOf[v.i],
  base: baseSentences(v.desc),
  n: v.n,
  first: v.first,
  last: v.last,
}));

// ---------------------------------------------------------------------------
// Class / edge construction (run twice: before and after structural refinement)
// ---------------------------------------------------------------------------
// (OClass / OEdge / OPlace: the oracle file format, lib/oracle.ts)
const isDir = (m: string) => !m.startsWith('named:');

function buildClasses(volatile: Set<string>) {
  const classes: OClass[] = [];
  const classByKey = new Map<string, OClass>();
  const classOfVariant = new Int32Array(V.length).fill(-1);
  const groupClasses = new Map<string, OClass[]>();
  let folded = 0;
  const order = [...V].sort((a, b) => b.nM - a.nM || b.n - a.n);
  for (const v of order) {
    const sents = stableSentences(v.desc, volatile);
    const canon = sents.join(' ');
    const g = groupOf[v.i];
    const key = g + '#' + canon;
    let c = classByKey.get(key);
    if (!c && v.nM === 0 && canon.length >= 20) {
      // DF-only text: a fragmented session-log line can make the name scan
      // capture only the TAIL of the description — fold a proper suffix.
      const cands = (groupClasses.get(g) ?? []).filter(
        (x) => x.canon.endsWith(canon) && x.canon !== canon
      );
      if (cands.length === 1) {
        c = cands[0];
        c.fragments++;
        folded++;
      }
    }
    if (!c) {
      c = {
        id: classes.length,
        name: v.name,
        dirs: v.dirs,
        named: v.named,
        group: g,
        canon,
        sents,
        n: 0,
        nM: 0,
        nD: 0,
        first: v.first,
        last: v.last,
        variants: 0,
        ex: v.ex,
        exD: null,
        place: -1,
        multLB: 1,
        multWhy: '',
        fragments: 0,
      };
      classes.push(c);
      classByKey.set(key, c);
      (groupClasses.get(g) ?? groupClasses.set(g, []).get(g)!).push(c);
    }
    classOfVariant[v.i] = c.id;
    c.n += v.n;
    c.nM += v.nM;
    c.nD += v.nD;
    c.variants++;
    if (v.first < c.first) c.first = v.first;
    if (v.last > c.last) c.last = v.last;
    if (v.nD > 0 && !c.exD) c.exD = v.ex;
  }

  const edgeMap = new Map<string, OEdge & { _files: Set<string> }>();
  for (const e of edgeObs) {
    const from = classOfVariant[e.from];
    const to = classOfVariant[e.to];
    const k = `${from}|${e.move}|${to}`;
    let x = edgeMap.get(k);
    if (!x)
      edgeMap.set(
        k,
        (x = { from, move: e.move, to, n: 0, clean: 0, files: 0, ex: [], _files: new Set() })
      );
    x.n++;
    if (e.conf !== 'repaired') x.clean++;
    x._files.add(e.file);
    if (x.ex.length < 3) x.ex.push(`${e.file}:${e.line}`);
  }
  const edges: OEdge[] = [...edgeMap.values()].map(({ _files, ...rest }) => ({
    ...rest,
    files: _files.size,
  }));
  const outEdges = new Map<number, OEdge[]>();
  const inEdges = new Map<number, OEdge[]>();
  for (const e of edges) {
    (outEdges.get(e.from) ?? outEdges.set(e.from, []).get(e.from)!).push(e);
    (inEdges.get(e.to) ?? inEdges.set(e.to, []).get(e.to)!).push(e);
  }
  // Lost-block skips: C -d-> Z recorded when the walk was C -d-> Y -d'-> Z
  // and Y's block died (session-log line fragmentation; it recurs at the
  // same spot because the server output — and so the chunk boundary — is
  // the same every time). Signature: a much better-supported C -d-> Y, and
  // Y continuing FORWARD to Z (d' != rev(d); a return to C is a twin row,
  // not a skip).
  const forward = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!isDir(e.move)) continue;
    const k = `${e.from}>${e.to}`;
    (forward.get(k) ?? forward.set(k, new Set()).get(k)!).add(e.move);
  }
  let skips = 0;
  for (const e of edges) {
    if (!isDir(e.move)) continue;
    for (const f of outEdges.get(e.from) ?? []) {
      if (f.move !== e.move || f.to === e.to || f.n < 4 * e.n) continue;
      const moves = forward.get(`${f.to}>${e.to}`);
      if (moves && [...moves].some((m) => m !== REV[e.move])) {
        e.skip = true;
        skips++;
        break;
      }
    }
  }
  return { classes, classOfVariant, edges, outEdges, inEdges, folded, skips, groupClasses };
}

/** Observed neighbours of a class per move (non-skip, dir moves). */
function neighbourMap(cid: number, outEdges: Map<number, OEdge[]>, inEdges: Map<number, OEdge[]>) {
  const m = new Map<string, Map<number, number>>();
  const add = (k: string, other: number, n: number) => {
    const mm = m.get(k) ?? m.set(k, new Map()).get(k)!;
    mm.set(other, (mm.get(other) ?? 0) + n);
  };
  for (const e of outEdges.get(cid) ?? [])
    if (isDir(e.move) && !e.skip && e.to !== cid) add('out ' + e.move, e.to, e.n);
  for (const e of inEdges.get(cid) ?? [])
    if (isDir(e.move) && !e.skip && e.from !== cid) add('in ' + e.move, e.from, e.n);
  return m;
}

// ---------------------------------------------------------------------------
// 2. Volatile prose — pass 1 (temporal witnesses, lexicon, spread)
// ---------------------------------------------------------------------------
let vol = detectVolatile(lite, same, overrides);
let built = buildClasses(vol.volatile);

// ---------------------------------------------------------------------------
// 3. Structural refinement: classes of one group differing by ONE sentence
//    whose walked neighbourhoods agree are one room in two world states.
// ---------------------------------------------------------------------------
function structuralEvidence(b: ReturnType<typeof buildClasses>): StructuralEvidence {
  const ev: StructuralEvidence = { same: new Map(), distinct: new Map(), pairs: [] };
  for (const list of b.groupClasses.values()) {
    if (list.length < 2 || list.length > 200) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const ds = diffSmall(A.sents, B.sents);
        if (!ds) continue;
        const na = neighbourMap(A.id, b.outEdges, b.inEdges);
        const nb = neighbourMap(B.id, b.outEdges, b.inEdges);
        let agree = 0;
        let disagree = 0;
        for (const [k, ma] of na) {
          const mb = nb.get(k);
          if (!mb) continue;
          const shared = [...ma.keys()].some((x) => mb.has(x));
          if (shared) agree++;
          else {
            // disjoint — only trusted when both sides are well supported
            const sa = [...ma.values()].reduce((x, y) => x + y, 0);
            const sb = [...mb.values()].reduce((x, y) => x + y, 0);
            if (sa >= 2 && sb >= 2) disagree++;
          }
        }
        if (!agree && !disagree) continue;
        const bump = (m: Map<string, number>) => {
          for (const pr of ds) for (const s of pr) if (s) m.set(s, (m.get(s) ?? 0) + 1);
        };
        if (disagree) bump(ev.distinct);
        else bump(ev.same);
        for (const pr of ds) ev.pairs.push(pr);
      }
    }
  }
  return ev;
}
const structural = structuralEvidence(built);
vol = detectVolatile(lite, same, overrides, structural);
built = buildClasses(vol.volatile);
const { classes, classOfVariant, edges, outEdges, inEdges, folded, skips } = built;
const volatile = vol.volatile;
const families: FamilyInfo[] = vol.families;
const edgeKeySet = new Set(edges.map((e) => `${e.from}|${e.move}|${e.to}`));
const reciprocated = (e: OEdge) =>
  isDir(e.move) && edgeKeySet.has(`${e.to}|${REV[e.move]}|${e.from}`);

// ---------------------------------------------------------------------------
// 4. Multiplicity lower bounds (word-identical twins)
// ---------------------------------------------------------------------------
// (a) one exit per direction: k distinct well-supported (n>=2, non-skip)
//     classes reached by `d` from C (or arriving into C by `d`) mean C
//     stands for >= k physical rooms;
// (b) same-class runs: d,d,d through C,C,C on a grid visits distinct rooms.
for (const c of classes) {
  let best = 1;
  let why = '';
  for (const [k, m] of neighbourMap(c.id, outEdges, inEdges)) {
    const strong = [...m.entries()].filter(([, n]) => n >= 2);
    if (strong.length > best) {
      best = strong.length;
      why = `${strong.length} distinct neighbours ${k}: ${strong.map(([x]) => `${classes[x].name}#${x}`).join(', ')}`;
    }
  }
  c.multLB = best;
  c.multWhy = why;
}
{
  const runs = new Map<number, number>();
  let prev: EdgeObs | null = null;
  let run = 0;
  for (const e of edgeObs) {
    const from = classOfVariant[e.from];
    const to = classOfVariant[e.to];
    const lateral = isDir(e.move) && e.move !== 'u' && e.move !== 'd';
    const cont =
      prev !== null &&
      prev.chain === e.chain &&
      prev.to === e.from &&
      prev.move === e.move &&
      classOfVariant[prev.to] === from &&
      classOfVariant[prev.from] === from;
    if (lateral && from === to) run = cont ? run + 1 : 1;
    else run = 0;
    if (run > 0) runs.set(from, Math.max(runs.get(from) ?? 0, run));
    prev = e;
  }
  // A self-loop seen once is usually a lost-block artifact (the block
  // between two same-text rooms died to line fragmentation) — require the
  // class-to-itself move to be observed at least twice.
  const selfSupport = new Map<number, number>();
  for (const e of edges) {
    if (e.from === e.to && isDir(e.move) && e.move !== 'u' && e.move !== 'd') {
      selfSupport.set(e.from, (selfSupport.get(e.from) ?? 0) + e.n);
    }
  }
  for (const [cid, r] of runs) {
    const c = classes[cid];
    if ((selfSupport.get(cid) ?? 0) < 2) continue;
    if (r + 1 > c.multLB) {
      c.multLB = r + 1;
      c.multWhy = `same-class run of ${r} lateral step(s)`;
    }
  }
  // (c) head-runs: entering C by d from a non-C class P and continuing d
  //     through k more C's visits k+1 distinct rooms; runs hanging off
  //     DIFFERENT predecessor classes are disjoint (a room has one rev(d)
  //     neighbour), so m(C) >= sum over P of (1 + longest run after P).
  //     The Blue Pearl Inn: 3 floors x (stair hallway -s-> twin -s-> twin)
  //     = 6 copies of the same hallway text.
  const strongEdge = new Set(
    edges.filter((e) => e.n >= 2 && !e.skip).map((e) => `${e.from}|${e.move}|${e.to}`)
  );
  const heads = new Map<string, Map<number, number>>();
  for (let i = 0; i < edgeObs.length; i++) {
    const e = edgeObs[i];
    const P = classOfVariant[e.from];
    const Cc = classOfVariant[e.to];
    const lateral = isDir(e.move) && e.move !== 'u' && e.move !== 'd';
    if (!lateral || P === Cc || !strongEdge.has(`${P}|${e.move}|${Cc}`)) continue;
    let run = 0;
    for (let j = i + 1; j < edgeObs.length; j++) {
      const f = edgeObs[j];
      if (f.chain !== e.chain || f.move !== e.move || f.from !== edgeObs[j - 1].to) break;
      if (classOfVariant[f.from] !== Cc || classOfVariant[f.to] !== Cc) break;
      run++;
    }
    if ((selfSupport.get(Cc) ?? 0) < 2) run = 0;
    const k = `${Cc}|${e.move}`;
    const m = heads.get(k) ?? heads.set(k, new Map()).get(k)!;
    m.set(P, Math.max(m.get(P) ?? 0, run));
  }
  for (const [k, m] of heads) {
    const [cid, d] = k.split('|');
    const c = classes[Number(cid)];
    if (![...m.values()].some((r) => r > 0)) continue;
    let total = 0;
    for (const r of m.values()) total += 1 + r;
    if (total > c.multLB) {
      c.multLB = total;
      c.multWhy = `${m.size} head(s) entered by ${d}, runs ${[...m.values()].map((r) => 1 + r).join('+')}`;
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Places
// ---------------------------------------------------------------------------
const vehicle = new Set<number>();
{
  const namedTargets = new Map<string, Set<number>>();
  for (const e of edges) {
    if (isDir(e.move) || e.n < 2) continue; // a single sighting proves no vehicle
    const k = `${e.from}|${e.move}`;
    (namedTargets.get(k) ?? namedTargets.set(k, new Set()).get(k)!).add(e.to);
  }
  for (const [k, s] of namedTargets) if (s.size >= 2) vehicle.add(Number(k.split('|')[0]));
}
const parent = classes.map((c) => c.id);
const find = (x: number): number => {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
};
const unite = (a: number, b: number) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};
const unique = (cid: number) => classes[cid].multLB <= 1;
// Walk-level union (chains cut at vehicle hops and >3 min gaps — a boat ride
// below deck shows no wilderness survey).
{
  let curChain = -1;
  let lastT = 0;
  let anchor = -1;
  for (const o of edgeObs) {
    const from = classOfVariant[o.from];
    const to = classOfVariant[o.to];
    const vehicleHop = !isDir(o.move) && (vehicle.has(from) || vehicle.has(to));
    if (o.chain !== curChain || o.t - lastT > 180_000 || vehicleHop) {
      curChain = o.chain;
      anchor = -1;
    }
    lastT = o.t;
    if (vehicleHop) continue;
    for (const c of [from, to]) {
      if (!unique(c)) continue;
      if (anchor >= 0) unite(anchor, c);
      anchor = c;
    }
  }
}
const compMembers = new Map<number, number[]>();
for (const c of classes) {
  if (c.nD === 0 || !unique(c.id)) continue;
  const r = find(c.id);
  (compMembers.get(r) ?? compMembers.set(r, []).get(r)!).push(c.id);
}
const SIGNATURES: [RegExp, string][] = [
  [
    /^(?:Eris Road|Garrison Road|Garrison Plaza|Intersection of Garrison Road and Ash Street|Ash Street|Ferry Landing|Eris Post Office)$/,
    'Eris',
  ],
  [
    /^(?:The Souk|Onyx Street|Chalcedony Street|Jacinth Street|The Blue Pearl|Royal Stables|Cloister Ambulatory|Western Foregate)$/,
    'Soriktos',
  ],
  [/^(?:Portal Chamber|Chapter Hall)$/, "Knights' commandery"],
  [/^(?:Waterfront street|Waterfront Way|Tobermore manor|South end of town)$/, 'Tobermore'],
  [/^(?:OOC Area|OOC Entry Hall)$/, 'OOC'],
  [/^(?:Bone Pit)$/, 'Bone Pit'],
  [/^(?:Weathered Gate)$/, 'Weathered Gate'],
];
const places: OPlace[] = [];
for (const members of [...compMembers.values()].sort((a, b) => b.length - a.length)) {
  const id = places.length;
  const nameCount = new Map<string, number>();
  let sightingsD = 0;
  for (const cid of members) {
    const c = classes[cid];
    c.place = id;
    nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + c.nD);
    sightingsD += c.nD;
  }
  const topNames = [...nameCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  let label = '';
  for (const [re, l] of SIGNATURES) {
    if (members.some((cid) => re.test(classes[cid].name))) {
      label = l;
      break;
    }
  }
  if (!label) label = `~${topNames[0]}`;
  places.push({
    id,
    label,
    classes: members,
    twins: [],
    mushOnly: [],
    sightingsD,
    topNames: topNames.slice(0, 8),
  });
}
// Twins: attach to the places of their UNIQUE neighbours (direct, or through
// a chain of twins along one walk).
{
  const twinPlaces = new Map<number, Set<number>>();
  let curChain = -1;
  let lastPlace = -1;
  const pendingTwins: number[] = [];
  const flush = (p: number) => {
    if (p < 0) return;
    for (const t of pendingTwins)
      (twinPlaces.get(t) ?? twinPlaces.set(t, new Set()).get(t)!).add(p);
  };
  for (const o of edgeObs) {
    if (o.chain !== curChain) {
      curChain = o.chain;
      flush(lastPlace);
      pendingTwins.length = 0;
      lastPlace = -1;
    }
    for (const cid of [classOfVariant[o.from], classOfVariant[o.to]]) {
      const c = classes[cid];
      if (unique(cid)) {
        if (c.place >= 0) {
          flush(c.place);
          pendingTwins.length = 0;
          lastPlace = c.place;
        }
      } else {
        if (lastPlace >= 0)
          (twinPlaces.get(cid) ?? twinPlaces.set(cid, new Set()).get(cid)!).add(lastPlace);
        else pendingTwins.push(cid);
      }
    }
  }
  flush(lastPlace);
  for (const [cid, ps] of twinPlaces) {
    const c = classes[cid];
    const list = [...ps];
    c.places = list;
    c.place = list.length === 1 ? list[0] : -2;
    for (const p of list) places[p].twins.push(cid);
  }
}
// MUSH-only classes: bidirectional consecutive transitions (each >= 2x) with
// a placed unique class — one-way transitions are excluded on purpose (recall
// scrolls teleport from everywhere to the same home room).
{
  const trans = new Map<string, number>();
  for (const f of SEQ) {
    if (f.src !== 'M') continue;
    let prev = -1;
    let prevLine = 0;
    for (const e of f.ev) {
      const k = e[0];
      if (k === 'b') {
        const cid = classOfVariant[e[1] as number];
        const line = e[3] as number;
        if (prev >= 0 && cid !== prev && line - prevLine <= 40) {
          const key = `${prev}>${cid}`;
          trans.set(key, (trans.get(key) ?? 0) + 1);
        }
        prev = cid;
        prevLine = line;
      } else if (k === 's' || k === 'p' || k === 'L' || k === 'O' || k === 'F') {
        prev = -1;
      }
    }
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const [key, n] of trans) {
      if (n < 2) continue;
      const [a, b] = key.split('>').map(Number);
      if ((trans.get(`${b}>${a}`) ?? 0) < 2) continue;
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const cx = classes[x];
        const cy = classes[y];
        if (cx.place !== -1 || cx.nD > 0) continue;
        if (cy.place < 0 || cy.multLB > 1) continue;
        cx.place = cy.place;
        places[cy.place].mushOnly.push(x);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// 5b. Multiplicity propagation (ONE level) + per-place split
// ---------------------------------------------------------------------------
// Each physical copy of C has its OWN d-neighbour (that neighbour's rev(d)
// exit leads back to exactly one room), so m(X) >= sum of m(C) over the
// classes C that reach X by d. This turns "the Royal Stables row is two
// identical segments + an end" into "the north-side Stall text exists 3x in
// Soriktos". Deliberately ONE pass from the DIRECT bounds, over reciprocated
// (both directions walked), well-supported edges only: iterating to a
// fixpoint lets a single bad edge amplify around every loop of the graph.
{
  const direct = classes.map((c) => c.multLB);
  const strongDir = (e: OEdge) =>
    isDir(e.move) && !e.skip && e.n >= 2 && e.from !== e.to && reciprocated(e);
  // How many copies of `c` provably use their `move` exit toward `target`:
  // all of them when `target` is c's ONLY neighbour class that way (each
  // copy has exactly one such exit), otherwise just one.
  const copiesToward = (c: number, key: 'out' | 'in', move: string, target: number) => {
    const list = (key === 'out' ? outEdges.get(c) : inEdges.get(c)) ?? [];
    const others = new Set<number>();
    for (const e of list) {
      // every plausible neighbour counts here, self-loops included (a twin
      // row's copies lead to EACH OTHER), so the "only neighbour" test is
      // never fooled by a filter
      if (!isDir(e.move) || e.skip || e.move !== move) continue;
      others.add(key === 'out' ? e.to : e.from);
    }
    // Reciprocal evidence counts too: "c -rev(move)-> X" walked means the
    // copy reached that way has X as its `move` neighbour. Without it, a
    // twin run walked in ONE direction only (the OOC hall: c229 -n-> c229
    // ...) looked like "every c229 copy has the Entry Hall to its north"
    // and inflated the Entry Hall to 5 physical rooms.
    const rev = REV[move];
    const back = (key === 'out' ? inEdges.get(c) : outEdges.get(c)) ?? [];
    for (const e of back) {
      if (!isDir(e.move) || e.skip || e.move !== rev) continue;
      others.add(key === 'out' ? e.from : e.to);
    }
    return others.size === 1 && others.has(target) ? direct[c] : 1;
  };
  const sumsFor = (c: OClass, place?: number) => {
    const sums = new Map<string, number>();
    for (const e of inEdges.get(c.id) ?? []) {
      if (!strongDir(e)) continue;
      if (place !== undefined && classes[e.from].place !== place) continue;
      const k = 'in ' + e.move;
      sums.set(k, (sums.get(k) ?? 0) + copiesToward(e.from, 'out', e.move, c.id));
    }
    for (const e of outEdges.get(c.id) ?? []) {
      if (!strongDir(e)) continue;
      if (place !== undefined && classes[e.to].place !== place) continue;
      const k = 'out ' + e.move;
      sums.set(k, (sums.get(k) ?? 0) + copiesToward(e.to, 'in', e.move, c.id));
    }
    return sums;
  };
  for (const c of classes) {
    for (const [k, s] of sumsFor(c)) {
      if (s > c.multLB) {
        c.multLB = s;
        c.multWhy = `neighbours ${k} sum to ${s} rooms (one-level propagation)`;
      }
    }
  }
  for (const c of classes) {
    if (!c.places || c.places.length < 2) continue;
    const by: Record<number, number> = {};
    for (const p of c.places) by[p] = Math.max(1, ...sumsFor(c, p).values());
    c.multByPlace = by;
  }
}

// ---------------------------------------------------------------------------
// 6. Write + report
// ---------------------------------------------------------------------------
const corpusFile = path.join(cacheDir, 'corpus.json');
const oracle = {
  meta: {
    built: new Date().toISOString(),
    corpus: fs.existsSync(corpusFile) ? JSON.parse(fs.readFileSync(corpusFile, 'utf8')) : null,
    variants: V.length,
    edgeObservations: edgeObs.length,
    samePairs: same.length,
    volatileSentences: volatile.size,
    foldedFragments: folded,
    skipEdges: skips,
  },
  volatile: [...volatile],
  families: families.map((f) => ({
    verdict: f.verdict,
    reason: f.reason,
    groups: f.groups.length,
    witnessed: f.witnessed,
    structuralSame: f.structuralSame,
    structuralDistinct: f.structuralDistinct,
    sightings: f.sightings,
    members: f.members,
    exampleGroups: f.groups.slice(0, 4),
  })),
  classes,
  edges,
  places,
};
fs.writeFileSync(outFile, JSON.stringify(oracle));

const reasons = new Map<string, number>();
for (const f of families)
  reasons.set(`${f.verdict}/${f.reason}`, (reasons.get(`${f.verdict}/${f.reason}`) ?? 0) + 1);
log(`Oracle: ${V.length} variants -> ${classes.length} classes (${folded} DF fragments folded)`);
log(
  `Edges: ${edgeObs.length} observations -> ${edges.length} class edges (${skips} lost-block skips); ` +
    `same-room pairs ${same.length} (look ${same.filter((s) => s.kind === 'look').length}, resume ${same.filter((s) => s.kind === 'resume').length})`
);
log(
  `Volatile: ${volatile.size} sentences; families by verdict: ${[...reasons].map(([k, v]) => `${k}=${v}`).join(' ')}`
);
log(`Vehicles: ${[...vehicle].map((i) => classes[i].name).join(', ')}`);
log(`Places: ${places.length}`);
for (const p of places.slice(0, 30)) {
  log(
    `  [${p.id}] ${p.label.padEnd(26)} unique=${String(p.classes.length).padStart(4)} twins=${String(p.twins.length).padStart(3)} ` +
      `mushOnly=${String(p.mushOnly.length).padStart(3)} sightingsD=${p.sightingsD}  ${p.topNames.slice(0, 6).join(', ')}`
  );
}
fs.writeFileSync(reportFile, out.join('\n') + '\n');
console.log(out.join('\n'));
console.log(`\nWrote ${outFile} and ${reportFile}`);
