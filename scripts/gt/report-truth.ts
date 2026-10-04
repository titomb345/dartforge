/**
 * Ground-truth room inventory per place / sub-area, from the oracle.
 *
 *   npx tsx scripts/gt/report-truth.ts [--oracle oracle.json] [--place Eris] [--names] [--edges]
 *
 * Oracle: --oracle, then GT_ORACLE, then scripts/gt/.cache/oracle.json.
 *
 * For every room NAME in a place: distinct texts seen in the DF era
 * (classes), physical rooms (sum of multiplicity lower bounds), word-
 * identical twin texts (classes proven to be 2+ rooms, with the proof), and
 * texts seen only in the 2021-2026 MUSH logs (older visits; "retired" when
 * last seen before the 2024-10 Eris rewrite).
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadOracle, type OracleClass as C } from './lib/oracle';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const O = loadOracle(
  argValue('--oracle') ?? process.env.GT_ORACLE ?? path.join(here, '.cache', 'oracle.json')
);
const placeFilter = argValue('--place');
const showEdges = args.includes('--edges');

const classes: C[] = O.classes;

/** Sub-areas inside the big places (name lists; the rest is "streets & shops"). */
const SUB: Record<string, [string, RegExp][]> = {
  Eris: [
    ['market plaza', /^Market$/],
    [
      "rangers' keep (bailey, keep, floors 2-5)",
      /^(?:Bailey|Gatehouse|Training Hall|Assembly Hall|Messhall|Day Room|Landing|Vestibule|Bedchamber|Keep Roof|Quarter Master's Office|Armory|Archery Range|Smithy|Byre|Stable|Stall|Carriage House|Farrier's Shop|Kitchen|Kitchen Garden|Postern Gate|Shore|Barracks|Guardroom|Commander's Office|Library|Cellar|Infirmary)$/,
    ],
    [
      'garrison road / plaza',
      /^(?:Garrison Road|Garrison Plaza|Intersection of Garrison Road and Ash Street)$/,
    ],
  ],
  Soriktos: [
    ['the Souk', /^The Souk$/],
    [
      'Blue Pearl Inn',
      /^(?:The Blue Pearl|Blue Pearl Hallway|Concierge Desk|Salon|Garden Courtyard|Pool|Landing|Balcony)$/,
    ],
    [
      'palace / Royal Stables',
      /^(?:Royal Stables|Stall|Parade Ground|Gatehouse|Gates of the Citadel|Stableyard|Gymnasium|Barracks|Entry Hall|Kitchen)$/,
    ],
    [
      'Cloister / Basilica',
      /^(?:Cloister Ambulatory|Cloister Garth|Basilica of the Holy Luminaris|Narthex|Nave|Nave Aisle|Transept Crossing|North Transept|South Transept|Chancel|Chancel Aisle|North Tower|South Tower|Chantry|Forecourt|Healer's Hall|Healer's Garden|Infirmary|Vestibule)$/,
    ],
  ],
};

const out: string[] = [];
for (const [pi, place] of O.places.entries()) {
  if (placeFilter && place.label !== placeFilter) continue;
  const members = classes.filter((c) => c.place === pi || (c.places ?? []).includes(pi));
  const df = members.filter((c) => c.nD > 0);
  const mushOnly = members.filter((c) => c.nD === 0);
  if (df.length < 5 && !placeFilter) continue;
  const mult = (c: C) =>
    c.multByPlace && c.multByPlace[pi] !== undefined ? c.multByPlace[pi] : c.multLB;
  const rooms = df.reduce((a, c) => a + mult(c), 0);
  out.push('');
  out.push(
    `=== [${pi}] ${place.label}: ${df.length} distinct texts seen 2026-06..10 (DF), ${rooms} physical rooms (lower bound), ` +
      `${df.filter((c) => mult(c) > 1).length} twin texts; +${mushOnly.length} texts seen only in MUSH logs ` +
      `(${mushOnly.filter((c) => c.last < '2024-10-01').length} last seen before 2024-10)`
  );
  const groups: [string, C[]][] = [];
  const subs = SUB[place.label] ?? [];
  const used = new Set<number>();
  for (const [sl, re] of subs) {
    const list = df.filter((c) => re.test(c.name) && !used.has(c.id));
    list.forEach((c) => used.add(c.id));
    groups.push([sl, list]);
  }
  groups.push([
    subs.length ? 'other (streets, shops, ...)' : 'all',
    df.filter((c) => !used.has(c.id)),
  ]);
  for (const [sl, list] of groups) {
    if (!list.length) continue;
    const r = list.reduce((a, c) => a + mult(c), 0);
    out.push(`  -- ${sl}: ${list.length} texts / ${r} rooms`);
    const byName = new Map<string, C[]>();
    for (const c of list) (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);
    for (const [name, cs] of [...byName.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    )) {
      const rr = cs.reduce((a, c) => a + mult(c), 0);
      const twins = cs.filter((c) => mult(c) > 1);
      const mo = mushOnly.filter((c) => c.name === name);
      out.push(
        `     ${name.padEnd(40)} texts ${String(cs.length).padStart(2)}  rooms ${String(rr).padStart(2)}` +
          (twins.length
            ? `  twins: ${twins.map((c) => `c${c.id}[${c.dirs}]x${mult(c)}`).join(' ')}`
            : '') +
          (mo.length ? `  (+${mo.length} MUSH-only text${mo.length > 1 ? 's' : ''})` : '')
      );
      if (args.includes('--names')) {
        for (const c of cs) {
          out.push(
            `         c${c.id} [${c.dirs}] x${mult(c)} D${c.nD} ${c.first}..${c.last} ${c.multWhy ? '(' + c.multWhy + ')' : ''}`
          );
          out.push(`            ${c.canon.slice(0, 150)}`);
          if (showEdges) {
            for (const e of O.edges) {
              if (e.from === c.id)
                out.push(`              -${e.move}-> ${classes[e.to].name}#c${e.to} (n=${e.n})`);
            }
          }
        }
      }
    }
  }
}
console.log(out.join('\n'));
