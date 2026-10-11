/**
 * Volatile-prose detection for the oracle.
 *
 * A description sentence is VOLATILE when it changes with world state
 * (time of day, weather, crowds, lit/unlit fires, portcullis up/down,
 * dust, portal glow...) while the room stays the same. Detection:
 *
 *  1. ALTERNATIONS: within one fingerprint group (name + exits), two
 *     description variants that differ by exactly one sentence (a
 *     substitution A<>B, or a toggle: present/absent) witness that the
 *     sentence pair may be volatile. Pairs connected through shared
 *     sentences form FAMILIES (the Eris market's six crowd sentences are
 *     one family; each keep-bedchamber window-light pair is another).
 *
 *  2. TEMPORAL WITNESSES (positive same-room evidence, the strong signal):
 *     a re-print of the room produced by a queued `look`, and the first
 *     block after a login vs the last block before it. A sentence that
 *     differs across such a pair is volatile by observation.
 *
 *  3. Classification of a family:
 *     - any member temporally witnessed            → volatile ('witnessed')
 *     - else if a member is ever a description's FIRST sentence
 *                                                  → stable ('headline';
 *       identity headlines like "A hallway on the second floor" never
 *       vary with world state — the engine's own lesson)
 *     - else if it alternates in >= 2 different groups and matches the
 *       time/weather/state lexicon                 → volatile ('lexical')
 *     - else if it alternates in >= 4 different groups
 *                                                  → volatile ('spread')
 *     - else                                       → stable ('distinguishing')
 *     A manual override table can force either verdict (documented in
 *     the report) for families where the evidence above is misleading.
 */
import { sentences, WORLD_RE, NOISE_RE } from './canon';

/**
 * Time-of-day / world-state vocabulary. Deliberately specific: generic
 * words that also distinguish rooms ("open", "closed", "fire", "day room")
 * are left out so twin-distinguishing prose cannot pass as volatile.
 */
export const LEXICON =
  /\b(?:daylight|daytime|sunlight|sunrise|sunset|setting sun|the sun|sun (?:begins|sets|shines)|dawn|dusk|night|nighttime|evening|morning|afternoon|mid-?day|noon|this hour|for the day|new day|starlight|moonlight|lanterns?|lamps?|candles?|chandeliers?|cressets?|unlit|is lit|are lit|crowd(?:s|ed)?|bustl\w*|deserted|traffic|shoppers|housewives|vendors|revelers|stragglers|early risers|portcullis|glowing|glows|climb|watching you|seems quiet|brightly lit|dimly lit|dark room|mistletoe|festive|decorations?|shrouded|darker|isn't open|for the night|tide)\b/i;
/** Viewer-relative sentences (perception/search results) */
export const VIEWER_RE = /^You (?:see|notice|sense|spot|feel)\b/;
const isLexical = (x: string) => LEXICON.test(x) || VIEWER_RE.test(x);
/** Position-in-a-chain prose (ropes, cliffs): distinct rooms, never state */
const POSITIONAL_RE = /\b(?:nearing the (?:top|bottom)|about halfway|halfway (?:up|down))\b/i;
/** Size words are relative to the VIEWER's race in DartMUD ("An extremely
 *  large archway" for a mohnkee is "very very large" for a spyder). */
const SIZE_RE =
  /\b(?:(?:very|extremely|somewhat|quite|fairly|rather|incredibly)\s+)*(?:large|small|big|tiny|huge|massive|enormous|little)\b/gi;
const sizeNorm = (x: string) => x.replace(SIZE_RE, 'SIZE').replace(/\b(?:a|an) SIZE/gi, 'A SIZE');

export interface FamilyInfo {
  id: number;
  members: string[];
  /** toggles: members that alternate with ABSENCE */
  toggles: string[];
  groups: string[];
  contexts: number;
  sightings: number;
  first: boolean;
  witnessed: number;
  lexical: boolean;
  structuralSame: number;
  structuralDistinct: number;
  verdict: 'volatile' | 'stable';
  reason: string;
}

export function baseSentences(desc: string): string[] {
  return sentences(desc).filter((s) => !WORLD_RE.test(s) && !NOISE_RE.test(s));
}

/** Exactly-one-sentence difference between two sentence lists. */
export function diff1(a: string[], b: string[]): [string, string] | null {
  if (a.length === b.length) {
    let idx = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (idx >= 0) return null;
        idx = i;
      }
    }
    return idx >= 0 ? [a[idx], b[idx]] : null;
  }
  if (Math.abs(a.length - b.length) !== 1) return null;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let i = 0;
  while (i < shorter.length && longer[i] === shorter[i]) i++;
  for (let j = i; j < shorter.length; j++) if (longer[j + 1] !== shorter[j]) return null;
  return a.length > b.length ? [longer[i], ''] : ['', longer[i]];
}

/**
 * Small difference between two sentence lists: at most 2 sentences removed
 * and 2 added (day/night variants often change TWO sentences at once — the
 * window light AND the lamps lit/unlit), with the rest shared. Returns the
 * differing sentences paired in order ('' = toggle: present on one side
 * only), or null when the lists differ more than that.
 */
export function diffSmall(a: string[], b: string[]): [string, string][] | null {
  const sa = new Set(a);
  const sb = new Set(b);
  const removed = a.filter((x) => !sb.has(x));
  const added = b.filter((x) => !sa.has(x));
  if (removed.length + added.length === 0) return null;
  if (removed.length > 2 || added.length > 2) return null;
  const shared = a.length - removed.length;
  if (shared < Math.max(1, Math.min(a.length, b.length) - 2)) return null;
  const out: [string, string][] = [];
  const k = Math.max(removed.length, added.length);
  for (let i = 0; i < k; i++) out.push([removed[i] ?? '', added[i] ?? '']);
  return out;
}

export interface VariantLite {
  i: number;
  group: string;
  base: string[];
  n: number;
  first: string;
  last: string;
}

/**
 * Structural evidence (second pass, from the class graph): two classes of
 * one fingerprint group whose texts differ by a single sentence pair, and
 * whose observed neighbours AGREE in every direction both have walked
 * (at least one), are one room seen in two world states → 'same'. A
 * direction where both have well-supported neighbours that DISAGREE → the
 * texts belong to two physical rooms → 'distinct'.
 */
export interface StructuralEvidence {
  /** sentence → number of 'same room' class pairs it differed in */
  same: Map<string, number>;
  /** sentence → number of 'distinct rooms' class pairs it differed in */
  distinct: Map<string, number>;
  /** the differing sentence pairs ('' = absent) */
  pairs: [string, string][];
}

export function detectVolatile(
  variants: VariantLite[],
  samePairs: { a: number; b: number }[],
  overrides: Record<string, 'volatile' | 'stable'>,
  structural?: StructuralEvidence
): { volatile: Set<string>; families: FamilyInfo[]; witnessCount: Map<string, number> } {
  // Distinct base lists per group
  const groups = new Map<string, Map<string, { base: string[]; n: number }>>();
  for (const v of variants) {
    let m = groups.get(v.group);
    if (!m) groups.set(v.group, (m = new Map()));
    const k = v.base.join('\u0001');
    const e = m.get(k);
    if (e) e.n += v.n;
    else m.set(k, { base: v.base, n: v.n });
  }

  // Union-find over sentences (substitutions only; '' never joins)
  const parent = new Map<string, string>();
  const find = (s: string): string => {
    let r = s;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = s;
    while (parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const touch = (s: string) => {
    if (!parent.has(s)) parent.set(s, s);
  };
  const union = (a: string, b: string) => {
    touch(a);
    touch(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const sGroups = new Map<string, Set<string>>();
  const sContexts = new Map<string, Set<string>>();
  const sToggle = new Set<string>();
  const sSight = new Map<string, number>();
  const firstSentences = new Set<string>();
  for (const v of variants) if (v.base.length) firstSentences.add(v.base[0]);

  for (const [g, m] of groups) {
    const vs = [...m.values()];
    if (vs.length < 2 || vs.length > 1500) continue;
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const ds = diffSmall(vs[i].base, vs[j].base);
        if (!ds) continue;
        const changed = new Set(ds.flat());
        const ctx = g + '\u0002' + vs[i].base.filter((s) => !changed.has(s)).join('\u0001');
        for (const [x, y] of ds) {
          for (const s of [x, y]) {
            if (!s) continue;
            touch(s);
            let gs = sGroups.get(s);
            if (!gs) sGroups.set(s, (gs = new Set()));
            gs.add(g);
            let cs = sContexts.get(s);
            if (!cs) sContexts.set(s, (cs = new Set()));
            cs.add(ctx);
            sSight.set(s, (sSight.get(s) ?? 0) + Math.min(vs[i].n, vs[j].n));
          }
          if (x && y) union(x, y);
          else sToggle.add(x || y);
        }
      }
    }
  }

  // Temporal witnesses: sentences differing across same-room pairs
  const byIdx = new Map<number, VariantLite>();
  for (const v of variants) byIdx.set(v.i, v);
  const witnessCount = new Map<string, number>();
  for (const p of samePairs) {
    const a = byIdx.get(p.a)?.base;
    const b = byIdx.get(p.b)?.base;
    if (!a || !b) continue;
    const sa = new Set(a);
    const sb = new Set(b);
    const diff = [...a.filter((s) => !sb.has(s)), ...b.filter((s) => !sa.has(s))];
    if (diff.length === 0 || diff.length > 4) continue;
    for (const s of diff) {
      witnessCount.set(s, (witnessCount.get(s) ?? 0) + 1);
      touch(s);
    }
  }

  // Structural pairs join families too (a class-level single diff can come
  // from variants that also differ in already-known volatile prose).
  if (structural) {
    for (const [a, b] of structural.pairs) {
      if (a && b) union(a, b);
      else touch(a || b);
    }
  }

  // Per-sentence date ranges (world edits replace a sentence for good:
  // old and new texts never coexist in time, while twins and world-state
  // variants do)
  const sFirst = new Map<string, string>();
  const sLast = new Map<string, string>();
  const sCount = new Map<string, number>();
  for (const v of variants) {
    for (const x of v.base) {
      if (!parent.has(x)) continue;
      if (!sFirst.has(x) || v.first < sFirst.get(x)!) sFirst.set(x, v.first);
      if (!sLast.has(x) || v.last > sLast.get(x)!) sLast.set(x, v.last);
      sCount.set(x, (sCount.get(x) ?? 0) + v.n);
    }
  }

  // Families
  const fam = new Map<string, string[]>();
  for (const s of parent.keys()) {
    const r = find(s);
    let l = fam.get(r);
    if (!l) fam.set(r, (l = []));
    l.push(s);
  }
  const families: FamilyInfo[] = [];
  const volatile = new Set<string>();
  let id = 0;
  for (const members of fam.values()) {
    const groupsU = new Set<string>();
    const ctxU = new Set<string>();
    let sightings = 0;
    let witnessed = 0;
    for (const s of members) {
      for (const g of sGroups.get(s) ?? []) groupsU.add(g);
      for (const c of sContexts.get(s) ?? []) ctxU.add(c);
      sightings += sSight.get(s) ?? 0;
      witnessed += witnessCount.get(s) ?? 0;
    }
    let sameS = 0;
    let distinctS = 0;
    for (const s of members) {
      sameS += structural?.same.get(s) ?? 0;
      distinctS += structural?.distinct.get(s) ?? 0;
    }
    const first = members.some((s) => firstSentences.has(s));
    const lexical = members.some(isLexical);
    const allLexical = members.every(isLexical);
    const sizeOnly = members.length >= 2 && new Set(members.map(sizeNorm)).size === 1;
    // edit: members' date ranges are disjoint and ordered (each well seen)
    let edit = false;
    if (members.length >= 2 && members.every((x) => (sCount.get(x) ?? 0) >= 3 && sFirst.has(x))) {
      const sorted = [...members].sort((a, b) => sFirst.get(a)!.localeCompare(sFirst.get(b)!));
      edit = sorted.every((x, i) => i === 0 || sLast.get(sorted[i - 1])! < sFirst.get(x)!);
    }
    let verdict: 'volatile' | 'stable';
    let reason: string;
    const ov = members.map((s) => overrides[s]).find((x) => x);
    if (ov) {
      verdict = ov;
      reason = 'override';
    } else if (witnessed > 0) {
      verdict = 'volatile';
      reason = 'witnessed';
    } else if (distinctS > 0) {
      verdict = 'stable';
      reason = 'structural-distinct';
    } else if (edit) {
      // A world edit (typo fix, rewrite): the old text stopped before the
      // new one started — one room, two eras.
      verdict = 'volatile';
      reason = 'edit';
    } else if (first) {
      verdict = 'stable';
      reason = 'headline';
    } else if (sameS > 0) {
      verdict = 'volatile';
      reason = 'structural-same';
    } else if (sizeOnly) {
      verdict = 'volatile';
      reason = 'viewer-size';
    } else if (allLexical) {
      // Every alternative is time-of-day/state prose (a day/night pair, a
      // lit/unlit pair, a traffic cycle) — volatile even inside one group.
      verdict = 'volatile';
      reason = 'lexical';
    } else if (
      lexical &&
      groupsU.size <= 6 &&
      members.filter(isLexical).length * 2 >= members.length &&
      !members.some((x) => POSITIONAL_RE.test(x))
    ) {
      // Half the alternatives name the time of day / world state and
      // nothing says the texts belong to different rooms (busy vs quiet
      // harbour, fishing by day vs deserted at night, a traffic cycle).
      verdict = 'volatile';
      reason = 'lexical-partial';
    } else {
      verdict = 'stable';
      reason = 'distinguishing';
    }
    if (verdict === 'volatile') for (const s of members) volatile.add(s);
    families.push({
      id: id++,
      members,
      toggles: members.filter((s) => sToggle.has(s)),
      groups: [...groupsU],
      contexts: ctxU.size,
      sightings,
      first,
      witnessed,
      lexical,
      structuralSame: sameS,
      structuralDistinct: distinctS,
      verdict,
      reason,
    });
  }
  families.sort((a, b) => b.sightings - a.sightings);
  return { volatile, families, witnessCount };
}
