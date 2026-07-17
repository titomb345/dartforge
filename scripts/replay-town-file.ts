/** Verbose single-file town replay — pass session log path(s); prints every resolution.
 * Usage: npx tsx scripts/replay-town-file.ts <log path> [<log path> ...]
 *
 * Live-faithful chaining: DartForge session logs carry wall-clock
 * timestamps ("[2026-07-07 1:22:30 AM] ..."), which drive the localizer
 * clock directly — continuity gaps and queue expiry behave exactly as they
 * did live (a fake per-line clock used to glue sessions together and mask
 * login/resume behavior). Between files the map store is round-tripped
 * through serialize/deserialize and the localizers are reset, mirroring an
 * app restart — including the load-time link cleanses.
 */
import * as fs from 'fs';
import { RoomParser } from '../src/lib/roomParser';
import { HexLocalizer } from '../src/lib/hexLocalizer';
import { HexMapStore } from '../src/lib/hexMap';
import { TownParser, PORTAL_TRANSIT_RE } from '../src/lib/townParser';
import { TownLocalizer } from '../src/lib/townLocalizer';
import { TownMapStore, hexAnchorKey } from '../src/lib/townMap';

const files = process.argv.slice(2);
const hexMap = new HexMapStore();
const hexLoc = new HexLocalizer(hexMap);
let townMap = new TownMapStore();
let townLoc = new TownLocalizer(townMap);
let clock = 1_000_000;
let lineNo = 0;

const TS_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)\] (.*)$/;

const anchor = () =>
  hexMap.pos && !hexLoc.lost ? hexAnchorKey(hexMap.pos.island, hexMap.pos.q, hexMap.pos.r) : null;

const makeTownParser = () =>
  new TownParser((block) => {
    const res = townLoc.onRoomBlock(block, anchor(), clock);
    const room = townMap.room(res.pos);
    console.log(
      `${String(lineNo).padStart(5)} [${res.kind.padEnd(11)}] #${room?.id} "${block.name}" [${block.exits.dirs.join(',')}] at(${room?.x},${room?.y},${room?.z}) town=${res.pos?.townId}${res.merged ? ' MERGED' : ''}`
    );
  });
const makeHexParser = () =>
  new RoomParser((event) => {
    switch (event.type) {
      case 'survey':
        townLoc.onWilderness();
        hexLoc.onSurvey({ art: event.art, description: event.description, now: clock });
        townLoc.noteOutdoorPosition(anchor());
        console.log(`${String(lineNo).padStart(5)} (wilderness survey)`);
        break;
      case 'move-failed':
        console.log(`${String(lineNo).padStart(5)} (move-failed)`);
        if (townLoc.active) townLoc.onMoveFailed();
        else hexLoc.onMoveFailed(event.hard);
        break;
      case 'forced-move':
        hexLoc.trackForcedMove(event.dir, clock);
        break;
      case 'town-room':
        hexLoc.onTownRoom(clock);
        break;
    }
  });

let first = true;
for (const f of files) {
  console.log(`\n=== ${f.split(/[\\/]/).pop()} ===`);
  if (!first) {
    // App restart between sessions: persist + reload the map (running the
    // deserialize cleanses exactly like live) and reset transient state.
    townMap = TownMapStore.deserialize(townMap.serialize());
    townLoc = new TownLocalizer(townMap);
    hexLoc.reset();
  }
  first = false;
  const townParser = makeTownParser();
  const hexParser = makeHexParser();
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    lineNo = i + 1;
    let line = lines[i].replace(/\r$/, '');
    const ts = line.match(TS_RE);
    if (ts) {
      let h = parseInt(ts[4], 10) % 12;
      if (ts[7] === 'PM') h += 12;
      const t = new Date(
        parseInt(ts[1], 10),
        parseInt(ts[2], 10) - 1,
        parseInt(ts[3], 10),
        h,
        parseInt(ts[5], 10),
        parseInt(ts[6], 10)
      ).getTime();
      if (t > clock) clock = t;
      line = ts[8];
    } else {
      const m = line.match(/^\[[^\]]{5,40}\] (.*)$/);
      if (m) line = m[1];
      else clock += 700;
    }
    const cmd = line.match(/^>> (.+)$/);
    if (cmd) {
      for (const c of cmd[1].split(';')) {
        let t = c.trim();
        if (!t) continue;
        // door built-in: logs record the raw input, but live the client
        // expands it to unlock/open/<dir>/close/lock and TRACKS the move —
        // replay the move or every door crossing becomes a floater.
        const door = /^\/?doorp?\s*(ne|se|nw|sw|n|s|e|w|d|u|in|out)\s*$/i.exec(t);
        if (door) t = door[1];
        if (!townLoc.trackCommand(t, clock)) hexLoc.trackCommand(t, clock);
        console.log(
          `${String(lineNo).padStart(5)} >> ${t === c.trim() ? t : `${c.trim()} → ${t}`}`
        );
      }
      continue;
    }
    const portal = PORTAL_TRANSIT_RE.exec(line);
    if (portal) {
      console.log(
        `${String(lineNo).padStart(5)} (portal transit${portal[1] ? `: ${portal[1]}` : ''})`
      );
      townLoc.onPortalTransit(portal[1] ?? null);
    }
    hexParser.feedLine(line);
    townParser.feedLine(line);
  }
  townParser.flushPending();
}

console.log('\n--- final towns ---');
for (const t of townMap.towns.values()) {
  console.log(`[${t.id}] "${t.name}" ${t.rooms.size} rooms`);
  for (const r of t.rooms.values()) {
    console.log(
      `   #${r.id} "${r.name}" [${r.exits.join(',')}] at(${r.x},${r.y},${r.z}) links=${JSON.stringify(r.links)} named=${JSON.stringify(r.namedLinks)}`
    );
  }
}
