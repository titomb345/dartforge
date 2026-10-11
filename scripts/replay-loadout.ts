/**
 * Replay DartForge session logs through the Loadout tracker.
 *
 * Feeds `>> cmd` lines to onCommand and everything else to onLine, then
 * reports how many events fired and the final hands/worn state — a sanity
 * harness for regex false positives against real traffic. A log written
 * since Oct 2026 records every command as sent (`>> [sent] equip held`,
 * src/lib/sessionLog.ts): live, the tracker sees those, so its typed lines
 * are skipped. The pager's "--- Press <enter> for more. ---" never reaches
 * the tracker live (src/lib/partialLine.ts), so its logged line is dropped.
 *
 * Usage:
 *   npx tsx scripts/replay-loadout.ts <log file> [more files...]
 *   npx tsx scripts/replay-loadout.ts --all     (all Dropbox session logs)
 */
import * as fs from 'fs';
import * as path from 'path';
import { LoadoutTracker, isHandLimb } from '../src/lib/loadout';
import { isMarkedLog, loggedCommand, parserText } from './lib/replayCorpus';

const SESSIONS_DIR = 'C:/Users/titom/Dropbox/DM/Dartforge/sessions';

const args = process.argv.slice(2);
const files = args.includes('--all')
  ? fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => path.join(SESSIONS_DIR, f))
  : args;

if (files.length === 0) {
  console.error('Usage: npx tsx scripts/replay-loadout.ts <log file>|--all');
  process.exit(1);
}

const TS_PREFIX = /^\[[^\]]+\]\s/;
const totals = new Map<string, number>();

for (const file of files) {
  const tracker = new LoadoutTracker();
  const counts = new Map<string, number>();
  let t = 0;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).map((l) => l.replace(TS_PREFIX, ''));
  const marked = isMarkedLog(lines);
  for (const line of lines) {
    t += 100;
    const cmd = loggedCommand(line);
    if (cmd) {
      if (cmd.sent || !marked) tracker.onCommand(cmd.command, t);
      continue;
    }
    const output = parserText(line);
    if (output === null) continue;
    const change = tracker.onLine(output, t);
    if (change !== 'none') {
      counts.set(change, (counts.get(change) ?? 0) + 1);
      totals.set(change, (totals.get(change) ?? 0) + 1);
    }
  }

  const s = tracker.state;
  const hands = s.limbs.filter((l) => isHandLimb(l.limb));
  console.log(`\n=== ${path.basename(file)}`);
  console.log(
    `  events: ${[...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`
  );
  if (s.limbs.length > 0) {
    for (const h of hands) {
      console.log(
        `  ${h.limb.padEnd(18)} ${h.held.map((x) => (x.summoned ? '✦' : '') + x.name).join(' + ') || '(empty)'}`
      );
    }
    const worn = [...s.limbs.flatMap((l) => l.worn), ...s.wornLoose];
    console.log(`  worn: ${worn.length} items${s.handsStale ? '  [hands unverified]' : ''}`);
  } else {
    console.log('  (no loadout data in this session)');
  }
}

console.log(
  `\nTOTALS across ${files.length} logs: ${[...totals.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')}`
);
