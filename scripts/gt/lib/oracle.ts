/**
 * The ground-truth oracle (built by scripts/gt/build-oracle.ts): its file
 * format, loading, and the mapping of a room TEXT (a parsed block or a
 * mapped room) to the oracle class it belongs to.
 */
import * as fs from 'fs';
import { groupKey, stableSentences } from './canon';

/** A genuinely distinct room text (volatile prose removed) — possibly
 *  several physical rooms (word-identical twins: multLB is a lower bound). */
export interface OracleClass {
  id: number;
  name: string;
  dirs: string[];
  named: string[];
  group: string;
  canon: string;
  sents: string[];
  n: number;
  nM: number;
  nD: number;
  first: string;
  last: string;
  variants: number;
  ex: string;
  exD: string | null;
  /** Place id; -1 unplaced, -2 a twin text spanning several places */
  place: number;
  places?: number[];
  multLB: number;
  multWhy: string;
  multByPlace?: Record<number, number>;
  fragments: number;
}

/** Walked class adjacency (DF command/block alignment) */
export interface OracleEdge {
  from: number;
  move: string;
  to: number;
  n: number;
  clean: number;
  files: number;
  ex: string[];
  /** lost-block artifact: C -d-> Z recorded while the real walk was C -d-> Y -> Z */
  skip?: boolean;
}

/** A physically continuous area (Eris incl. the keep, Soriktos, the OOC hall, ...) */
export interface OraclePlace {
  id: number;
  label: string;
  classes: number[];
  twins: number[];
  mushOnly: number[];
  sightingsD: number;
  topNames: string[];
}

export interface Oracle {
  meta: Record<string, unknown>;
  volatile: string[];
  classes: OracleClass[];
  edges: OracleEdge[];
  places: OraclePlace[];
}

export function loadOracle(file: string): Oracle {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Oracle;
}

/** The engine caps descriptions at 600 chars (townParser.ts) — the last
 *  sentence of a capped text may be cut */
const CAPPED = 595;

/**
 * The named exits the parser recognized before the Oct 2026 exits-list
 * grammar (it now also lists "path", "hole", "mudschool", a door "leading
 * backroom" ...). Oracles built before then key their classes by these
 * alone, so a text whose full named list finds no class is looked up again
 * by this subset — the same room either way, and the fixed oracle stays a
 * valid measuring stick across the parser change.
 */
const LEGACY_NAMED: ReadonlySet<string> = new Set(['back', 'out', 'exit']);
const legacyNamed = (named: readonly string[]) => named.filter((w) => LEGACY_NAMED.has(w));

/**
 * Class lookup for room TEXTS (a parsed block: name + exits + desc).
 * Exact canon first; a capped desc matches by its uncut sentences as a
 * unique prefix; a fragment-captured desc (a tail) by unique suffix.
 */
export class OracleIndex {
  readonly volatile: ReadonlySet<string>;
  private readonly byKey = new Map<string, OracleClass>();
  private readonly byGroup = new Map<string, OracleClass[]>();

  constructor(readonly oracle: Oracle) {
    this.volatile = new Set(oracle.volatile);
    for (const c of oracle.classes) {
      this.byKey.set(c.group + '#' + c.canon, c);
      const list = this.byGroup.get(c.group) ?? [];
      list.push(c);
      this.byGroup.set(c.group, list);
    }
  }

  classOf(
    name: string,
    dirs: readonly string[],
    named: readonly string[],
    desc: string
  ): OracleClass | undefined {
    const found = this.classOfGroup(groupKey(name, dirs, named), desc);
    const legacy = legacyNamed(named);
    if (found || legacy.length === named.length) return found;
    return this.classOfGroup(groupKey(name, dirs, legacy), desc);
  }

  private classOfGroup(group: string, desc: string): OracleClass | undefined {
    let sents = stableSentences(desc, this.volatile);
    const exact = this.byKey.get(group + '#' + sents.join(' '));
    if (exact) return exact;
    const cands = this.byGroup.get(group) ?? [];
    if (desc.length >= CAPPED && sents.length > 1) {
      sents = sents.slice(0, -1);
      const pre = cands.filter(
        (c) => c.sents.length >= sents.length && sents.every((s, i) => c.sents[i] === s)
      );
      if (pre.length === 1) return pre[0];
    }
    const key = sents.join(' ');
    if (key.length >= 20) {
      const suf = cands.filter((c) => c.canon.endsWith(key));
      if (suf.length === 1) return suf[0];
    }
    return undefined;
  }

  /** The single place of a class: -1 unplaced, -2 several places */
  static placeOf(c: OracleClass | undefined): number {
    if (!c) return -1;
    if (c.places && c.places.length > 1) return -2;
    return c.place;
  }
}

/** The parts of a MAPPED room (TownMapStore.serialize() room) matching reads */
export interface MappedRoomText {
  name: string;
  desc: string;
  exits: string[];
  exitsEver?: string[];
  namedExits?: string[];
}

export type MatchKind = 'exact' | 'prefix' | 'suffix' | 'subset' | 'fuzzy' | 'none';
export interface RoomMatch {
  cls: OracleClass | null;
  kind: MatchKind;
  /** Other same-named classes that scored as well as `cls` */
  ambiguous: number;
}

/**
 * Class lookup for MAPPED rooms (check-towns.ts, inspect-room.ts). A mapped
 * room carries the text of the last block assigned to it, exits that may
 * show another door state (exitsEver: every exit it ever showed) and a
 * possibly capped desc, so the same-named classes are SCORED rather than
 * keyed: text exact > prefix > suffix > subset > fuzzy (sentence Jaccard ≥
 * 0.5), then exits (same dirs + named > same dirs > dirs all seen ever),
 * then how often the class was seen. OracleIndex.classOf is the strict
 * variant for parsed blocks.
 */
export class RoomMatcher {
  /** Oracle classes by room name */
  readonly byName = new Map<string, OracleClass[]>();
  private readonly volatile: ReadonlySet<string>;

  constructor(oracle: Oracle) {
    this.volatile = new Set(oracle.volatile);
    for (const c of oracle.classes) {
      const list = this.byName.get(c.name) ?? [];
      list.push(c);
      this.byName.set(c.name, list);
    }
  }

  match(r: MappedRoomText): RoomMatch {
    const cands = this.byName.get(r.name) ?? [];
    if (!cands.length) return { cls: null, kind: 'none', ambiguous: 0 };
    let sents = stableSentences(r.desc ?? '', this.volatile);
    // the engine caps desc at 600 chars — the last sentence may be cut
    const truncated = (r.desc ?? '').length >= CAPPED;
    if (truncated && sents.length > 1) sents = sents.slice(0, -1);
    const ever = new Set([...(r.exitsEver ?? []), ...r.exits]);
    const exitsKey = r.exits.join(',');
    const named = r.namedExits ?? [];
    const namedKeys = [named.join(','), legacyNamed(named).join(',')];
    const score = (c: OracleClass): [number, MatchKind] => {
      let exitScore = 0;
      if (c.dirs.join(',') === exitsKey && namedKeys.includes(c.named.join(','))) exitScore = 3;
      else if (c.dirs.join(',') === exitsKey) exitScore = 2;
      else if (c.dirs.every((d) => ever.has(d))) exitScore = 1;
      else return [-1, 'none'];
      const cs = c.sents;
      const key = sents.join(' ');
      let kind: MatchKind = 'none';
      let s = 0;
      if (c.canon === key) {
        kind = 'exact';
        s = 100;
      } else if (sents.length && cs.length >= sents.length && sents.every((x, i) => cs[i] === x)) {
        kind = 'prefix';
        s = 80;
      } else if (sents.length && c.canon.endsWith(key) && key.length >= 20) {
        kind = 'suffix';
        s = 70;
      } else if (sents.length && sents.every((x) => cs.includes(x))) {
        kind = 'subset';
        s = 50;
      } else {
        const set = new Set(cs);
        const inter = sents.filter((x) => set.has(x)).length;
        const jac = inter / Math.max(1, new Set([...cs, ...sents]).size);
        if (jac >= 0.5) {
          kind = 'fuzzy';
          s = 20 + jac * 20;
        } else return [-1, 'none'];
      }
      return [s + exitScore + Math.min(1, c.nD / 1000), kind];
    };
    let best: OracleClass | null = null;
    let bestS = -1;
    let bestK: MatchKind = 'none';
    let ties = 0;
    for (const c of cands) {
      const [s, k] = score(c);
      if (s < 0) continue;
      if (s > bestS + 1e-9) {
        best = c;
        bestS = s;
        bestK = k;
        ties = 0;
      } else if (Math.abs(s - bestS) < 1e-9) ties++;
    }
    return { cls: best, kind: bestK, ambiguous: ties };
  }
}
