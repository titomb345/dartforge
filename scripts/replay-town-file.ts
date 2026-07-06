/** Verbose single-file town replay — pass session log path(s); prints every resolution.
 * Usage: npx tsx scripts/replay-town-file.ts "%APPDATA%/com.dartforge/emergency-data/sessions/<log>"
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
const townMap = new TownMapStore();
const townLoc = new TownLocalizer(townMap);
let clock = 1_000_000;
let lineNo = 0;

const anchor = () =>
  hexMap.pos && !hexLoc.lost ? hexAnchorKey(hexMap.pos.island, hexMap.pos.q, hexMap.pos.r) : null;

const townParser = new TownParser((block) => {
  const res = townLoc.onRoomBlock(block, anchor(), clock);
  const room = townMap.room(res.pos);
  console.log(
    `${String(lineNo).padStart(5)} [${res.kind.padEnd(11)}] #${room?.id} "${block.name}" [${block.exits.dirs.join(',')}] at(${room?.x},${room?.y},${room?.z}) town=${res.pos?.townId}${res.merged ? ' MERGED' : ''}`
  );
});
const hexParser = new RoomParser((event) => {
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

for (const f of files) {
  console.log(`\n=== ${f.split(/[\\/]/).pop()} ===`);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    lineNo = i + 1;
    let line = lines[i].replace(/\r$/, '');
    clock += 700;
    const m = line.match(/^\[[^\]]{5,40}\] (.*)$/);
    if (m) line = m[1];
    const cmd = line.match(/^>> (.+)$/);
    if (cmd) {
      for (const c of cmd[1].split(';')) {
        const t = c.trim();
        if (!t) continue;
        if (!townLoc.trackCommand(t, clock)) hexLoc.trackCommand(t, clock);
        console.log(`${String(lineNo).padStart(5)} >> ${t}`);
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
  clock += 60_000;
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
