/**
 * Regression test: ONE dispatcher for the server lines the town engine reads
 * directly (src/lib/townLineEvents.ts), shared by the live app and the replay
 * (Oct 2026 deep dive, app-wiring stage).
 *
 * The replay engine handed teleport, forced-move, pitch-black and "What ?"
 * lines to the town localizer for three stages while the live
 * useMapTracker.feedLine forwarded only portal transits: every measured fix
 * for those lines was a fix nobody's client ran.
 *
 *  A. Each line reaches its handler with its argument, and the event says
 *     what the engine did (forced move queued or not, the dark line's
 *     DarkArrival, the reply that failed a queued move).
 *  B. Through a real localizer: a walk's dark step advances to the linked
 *     room ('advanced'), a look in the dark stays ('look'), a step with no
 *     walked link leaves the position unknown ('unknown'), a dark line
 *     right after a transit is the transit's own ('transit'), outdoors
 *     nothing ('none').
 *  C. Drift guard: the live hook and the replay engine both dispatch through
 *     dispatchTownLine, BEFORE the hex parser and the town parser, and
 *     neither handles one of these lines itself (the regexes and the
 *     handlers appear in neither file). React hooks have no test harness
 *     here, so the source is the only place the live wiring can be checked.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dispatchTownLine, type TownLineEvent } from '../../src/lib/townLineEvents';
import { TownLocalizer } from '../../src/lib/townLocalizer';
import { TownMapStore } from '../../src/lib/townMap';
import { parseTownExits, type TownRoomBlock } from '../../src/lib/townParser';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

// --- A: each line, its handler, its event -----------------------------------

class Recorder extends TownLocalizer {
  calls: string[] = [];
  forcedResult = true;
  unknownResult = false;
  constructor() {
    super(new TownMapStore());
  }
  override onPortalTransit(dirWord: string | null = null): void {
    this.calls.push(`portal:${dirWord}`);
  }
  override onTeleport(): void {
    this.calls.push('teleport');
  }
  override onForcedMove(text: string, now: number): boolean {
    this.calls.push(`forced:${text}@${now}`);
    return this.forcedResult;
  }
  override onDarkArrival(now: number) {
    this.calls.push(`dark@${now}`);
    return 'look' as const;
  }
  override onUnknownCommand(verb: string | null = null): boolean {
    this.calls.push(`unknown:${verb}`);
    return this.unknownResult;
  }
}

const cases: [string, string[], TownLineEvent[]][] = [
  ['You step into the north portal.', ['portal:north'], [{ kind: 'portal', dirWord: 'north' }]],
  ['> You step into the portal.', ['portal:null'], [{ kind: 'portal', dirWord: null }]],
  [
    'Your body becomes insubstantial.  Red and green lights swirl around you as',
    ['teleport'],
    [{ kind: 'teleport' }],
  ],
  ['Esira leads you up.', ['forced:up@5000'], [{ kind: 'forced-move', move: 'up', queued: true }]],
  [
    'It is pitch black.  You smell damp, stagnant air.',
    ['dark@5000'],
    [{ kind: 'dark', wasActive: false, result: 'look' }],
  ],
  ['What ?', ['unknown:null'], [{ kind: 'unknown-command', verb: null, failed: false }]],
  ['> Enter what?', ['unknown:Enter'], [{ kind: 'unknown-command', verb: 'Enter', failed: false }]],
  ['There are two exits: north and south.', [], []],
  ['The guard leads you north.', [], []],
];
for (const [line, calls, events] of cases) {
  const rec = new Recorder();
  const got = dispatchTownLine(line, rec, 5000);
  check(
    JSON.stringify(rec.calls) === JSON.stringify(calls),
    `A: "${line}" calls ${JSON.stringify(calls)} (got ${JSON.stringify(rec.calls)})`
  );
  check(
    JSON.stringify(got) === JSON.stringify(events),
    `A: "${line}" events ${JSON.stringify(events)} (got ${JSON.stringify(got)})`
  );
}
{
  const rec = new Recorder();
  rec.forcedResult = false;
  rec.unknownResult = true;
  const forced = dispatchTownLine('Rikter leads you off to the west', rec, 1);
  check(
    JSON.stringify(forced) === '[{"kind":"forced-move","move":"west","queued":false}]',
    `A: an unqueued forced move says so (${JSON.stringify(forced)})`
  );
  const what = dispatchTownLine('What ?', rec, 1);
  check(what[0]?.kind === 'unknown-command' && what[0].failed, 'A: a failing reply says so');
}

// --- B: dark lines through a real localizer --------------------------------------

const block = (name: string, exits: string): TownRoomBlock => ({
  name,
  descFirst: `${name} is a room described at enough length to be usable.`,
  desc: `${name} is a room described at enough length to be usable.  It is dark.`,
  exits: parseTownExits(`There are two exits: ${exits}.`),
});
{
  const map = new TownMapStore();
  const loc = new TownLocalizer(map);
  loc.onRoomBlock(block('Vestibule', 'east and west'), null, 1_000);
  loc.trackCommand('e', 1_100);
  loc.onRoomBlock(block('Dark Street', 'east and west'), null, 1_200);
  loc.trackCommand('w', 1_300);
  loc.onRoomBlock(block('Vestibule', 'east and west'), null, 1_400);
  const town = map.get(map.pos!.townId)!;
  const street = [...town.rooms.values()].find((r) => r.name === 'Dark Street')!;

  loc.trackCommand('e', 2_000);
  const [stepped] = dispatchTownLine('It is pitch black.', loc, 2_100);
  check(
    stepped?.kind === 'dark' && stepped.wasActive && stepped.result === 'advanced',
    `B: a step along a walked link in the dark is 'advanced' (${JSON.stringify(stepped)})`
  );
  check(map.pos?.roomId === street.id, 'B: ... and the position follows the link');

  loc.trackCommand('l', 2_200);
  const [looked] = dispatchTownLine('It is pitch black.', loc, 2_300);
  check(looked?.kind === 'dark' && looked.result === 'look', "B: a look in the dark is 'look'");
  check(map.pos?.roomId === street.id, 'B: ... and nobody moved');

  loc.trackCommand('n', 2_400); // no walked link north of the street
  const [unknown] = dispatchTownLine('It is pitch black.', loc, 2_500);
  check(
    unknown?.kind === 'dark' && unknown.result === 'unknown',
    `B: a step with no walked link is 'unknown' (${JSON.stringify(unknown)})`
  );

  const [idle] = dispatchTownLine('It is pitch black.', loc, 2_600);
  check(idle?.kind === 'dark' && idle.result === 'none', "B: nothing queued: 'none'");

  dispatchTownLine('You step into the portal.', loc, 2_700);
  const [transit] = dispatchTownLine('It is pitch black.', loc, 2_800);
  check(
    transit?.kind === 'dark' && transit.result === 'transit',
    "B: right after a transit line the dark line is the transit's own"
  );

  const outdoors = new TownLocalizer(new TownMapStore());
  const [out] = dispatchTownLine('It is pitch black.', outdoors, 1);
  check(
    out?.kind === 'dark' && !out.wasActive && out.result === 'none',
    "B: outdoors a dark line is 'none'"
  );
}

// --- C: the live hook and the replay engine share the dispatcher ------------------

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');
const HANDLED_HERE = [
  'PORTAL_TRANSIT_RE',
  'TELEPORT_TRANSIT_RE',
  'TOWN_FORCED_MOVE_RE',
  'TOWN_DARK_RE',
  'UNKNOWN_COMMAND_RE',
  '.onPortalTransit(',
  '.onTeleport(',
  '.onForcedMove(',
  '.onDarkArrival(',
  '.onUnknownCommand(',
];
for (const [rel, hexFeed, townFeed] of [
  [
    'src/hooks/useMapTracker.ts',
    'parserRef.current?.feedLine(line',
    'townParserRef.current?.feedLine(',
  ],
  ['scripts/lib/townReplay.ts', 'hexParser.feedLine(text)', 'townParser.feedLine(text)'],
] as const) {
  // Comments may name the lines; code may not handle them
  const code = source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const dispatch = code.indexOf('dispatchTownLine(');
  check(dispatch >= 0, `C: ${rel} calls dispatchTownLine`);
  for (const name of HANDLED_HERE) {
    check(!code.includes(name), `C: ${rel} handles none of the lines itself (found ${name})`);
  }
  const hex = code.indexOf(hexFeed);
  const town = code.indexOf(townFeed);
  check(
    dispatch >= 0 && hex > dispatch && town > hex,
    `C: ${rel} dispatches each line before the hex parser, then the town parser`
  );
  check(
    code.split(hexFeed).length === 2 && code.split(townFeed).length === 2,
    `C: ${rel} feeds each parser in one place`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — town line events (one dispatcher, live and replay)');
