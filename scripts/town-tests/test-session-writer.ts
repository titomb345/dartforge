/**
 * Regression test: the session log writer (src/lib/sessionLog.ts
 * SessionLogWriter), the state and rules of useSessionLogger (Oct 2026 deep
 * dive, app-wiring stage).
 *
 *  A. The app renders in React.StrictMode, which in a development build
 *     runs the logger's effects at mount, their cleanup (the unmount flush)
 *     and the effects again, on the same refs. The connection effect
 *     scheduled a write at mount (the app starts disconnected); the cleanup
 *     cleared that timer but kept its handle; a write is scheduled only
 *     while no handle is held — so a dev session's log was never written
 *     until logging was turned off (the real hook under StrictMode: 0
 *     appends in 2.5 s; closing the window does not unmount it). The writer
 *     drops the handle of every timer it clears or runs, and a dropped
 *     connection with no waiting line schedules nothing.
 *  B. What a log holds: output cut into the parser feed's lines (a line cut
 *     by a TCP read logged once, whole; blank lines kept; bare prompts left
 *     out; an escape sequence cut between two chunks rejoined, then
 *     stripped); typed input; every send but an empty one; no command in
 *     password mode. The stamp, 12-hour or 24-hour (the app setting), reads
 *     back through the replay's parseStamp — which used to read 12-hour
 *     stamps only, so a 24-hour log replayed on a fake clock.
 *  C. When it is written: one append per burst, LOG_WRITE_DELAY_MS after
 *     the first unwritten line; a line still waiting for its newline is
 *     logged as it stands when the connection drops, logging stops or the
 *     app unmounts; logging off writes what waits and closes the file, on
 *     again opens a new one; lines wait while the backend cannot write yet.
 *  D. The hook keeps no timer of its own: the timers live in the writer,
 *     where they are tested. React hooks have no test harness here, so the
 *     source is the only place the hook can be checked.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  LOG_WRITE_DELAY_MS,
  SENT_PREFIX,
  SessionLogWriter,
  TYPED_PREFIX,
  formatLogStamp,
  type LogStampFormat,
} from '../../src/lib/sessionLog';
import { FakeTimers } from '../lib/fakeTimers';
import { parseStamp } from '../lib/replayInput';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const T0 = new Date(2026, 9, 3, 14, 5, 9).getTime();

/** A writer on fake timers; `appends` collects what reached the backend */
function harness(opts: { ready?: () => boolean } = {}) {
  const h = {
    now: T0,
    appends: [] as { file: string; content: string }[],
    files: 0,
    timers: null as unknown as FakeTimers,
    writer: null as unknown as SessionLogWriter,
    /** Let `ms` pass, running the timers due */
    advance(ms: number) {
      h.now += ms;
      h.timers.run();
    },
    /** Everything written, stamps removed */
    lines(): string[] {
      return h.appends
        .map((a) => a.content)
        .join('')
        .split('\n')
        .slice(0, -1)
        .map((l) => l.replace(/^\[[^\]]+\] /, ''));
    },
  };
  h.timers = new FakeTimers(() => h.now);
  h.writer = new SessionLogWriter({
    append: (file, content) => {
      if (opts.ready && !opts.ready()) return false;
      h.appends.push({ file, content });
      return true;
    },
    newFilename: () => `session_${++h.files}.log`,
    now: () => new Date(h.now),
    timers: h.timers,
  });
  return h;
}

/** useSessionLogger's effects as React runs them at mount, in order */
function mountEffects(w: SessionLogWriter, enabled: boolean, connected: boolean) {
  w.setEnabled(enabled);
  if (!connected) w.connectionLost();
}

// --- A: React.StrictMode at mount --------------------------------------------------------------
{
  const h = harness();
  // App start: logging on, the MUD not connected yet. StrictMode: setup,
  // cleanup (the unmount effect's close), setup again
  mountEffects(h.writer, true, false);
  h.writer.close();
  mountEffects(h.writer, true, false);
  h.advance(300);
  h.writer.output('There are two exits: north and south.\r\n> ');
  h.writer.typed('n');
  h.writer.sent('n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.appends.length === 1 &&
      h.lines().join('|') ===
        `There are two exits: north and south.|${TYPED_PREFIX}n|${SENT_PREFIX}n`,
    `A: under StrictMode the log is written ${LOG_WRITE_DELAY_MS} ms after the first line (${JSON.stringify(h.appends)})`
  );
  h.advance(5_000);
  h.writer.output('You are in the market.\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.appends.length === 2 && h.lines().at(-1) === 'You are in the market.',
    `A: ... and goes on being written (${h.appends.length} appends)`
  );
}
{
  // The cleanup clears a write that was due: the writer must still write
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('one\r\n');
  h.writer.close(); // StrictMode's cleanup, with a write pending
  check(
    h.appends.length === 1 && h.timers.pending === 0,
    'A: the cleanup writes now and leaves no timer'
  );
  mountEffects(h.writer, true, true);
  h.writer.output('two\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.lines().join('|') === 'one|two',
    `A: a write cleared by the cleanup does not stop the next one (${JSON.stringify(h.lines())})`
  );
}
{
  const h = harness();
  mountEffects(h.writer, true, false);
  check(
    h.timers.pending === 0,
    'A: a dropped connection with no line waiting schedules no write (the app starts disconnected)'
  );
}

// --- B: what a log holds -------------------------------------------------------------------------
{
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('Market\r\nThis is the mar');
  h.writer.output('ket.\r\n\r\n> ');
  h.writer.output('\x1b[1;3');
  h.writer.output('5mThe guard shouts.\x1b[0m\r\n> ');
  h.writer.typed('door w');
  h.writer.sent('unlock w door with key');
  h.writer.sent('');
  h.writer.sent('   ');
  h.writer.passwordMode = true;
  h.writer.typed('hunter2');
  h.writer.sent('hunter2');
  h.writer.output('Welcome back.\r\n');
  h.writer.passwordMode = false;
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    JSON.stringify(h.lines()) ===
      JSON.stringify([
        'Market',
        'This is the market.',
        '',
        'The guard shouts.',
        `${TYPED_PREFIX}door w`,
        `${SENT_PREFIX}unlock w door with key`,
        'Welcome back.',
      ]),
    `B: whole lines, blanks kept, prompts and empty sends left out, nothing typed or sent in password mode (${JSON.stringify(h.lines())})`
  );
  check(
    h.appends[0].content.startsWith('[2026-10-03 2:05:09 PM] Market\n'),
    `B: each line carries its stamp (${JSON.stringify(h.appends[0].content.slice(0, 40))})`
  );
  check(!h.lines().some((l) => l.includes('hunter2')), 'B: the password is in no line');
}
{
  const at = (h: number, m: number, s: number) => new Date(2026, 9, 3, h, m, s);
  check(formatLogStamp(at(14, 5, 9), '12h') === '2026-10-03 2:05:09 PM', 'B: a 12-hour stamp');
  check(formatLogStamp(at(14, 5, 9), '24h') === '2026-10-03 14:05:09', 'B: a 24-hour stamp');
  check(formatLogStamp(at(0, 0, 0), '12h') === '2026-10-03 12:00:00 AM', 'B: midnight (12-hour)');
  check(formatLogStamp(at(12, 0, 0), '12h') === '2026-10-03 12:00:00 PM', 'B: noon (12-hour)');
  let unread = 0;
  for (const format of ['12h', '24h'] as LogStampFormat[]) {
    for (const hour of [0, 1, 9, 11, 12, 13, 23]) {
      const d = at(hour, 7, 30);
      const back = parseStamp(`[${formatLogStamp(d, format)}] It is bright.`);
      if (!back || back.t !== d.getTime() || back.text !== 'It is bright.') {
        if (unread++ === 0)
          console.error(`  ${format} ${hour}h read back as ${JSON.stringify(back)}`);
      }
    }
  }
  check(
    unread === 0,
    `B: both clocks' stamps read back through parseStamp (${unread} of 14 do not)`
  );
}

// --- C: when it is written -------------------------------------------------------------------
{
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('a\r\n');
  h.advance(400);
  h.writer.output('b\r\n');
  h.advance(500);
  h.writer.typed('c');
  check(h.appends.length === 0, 'C: nothing is written before the delay');
  check(h.timers.pending === 1, `C: one write is due for the burst (${h.timers.pending} timers)`);
  h.advance(100);
  check(
    h.appends.length === 1 && h.lines().join('|') === `a|b|${TYPED_PREFIX}c`,
    'C: one append for the burst, at the delay'
  );
  h.advance(2_000);
  check(h.appends.length === 1, 'C: no write without new lines');
}
{
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('Market\r\nhalf a li');
  h.advance(LOG_WRITE_DELAY_MS);
  check(h.lines().join('|') === 'Market', 'C: a line cut by the read waits for its newline');
  h.writer.connectionLost();
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.lines().join('|') === 'Market|half a li',
    `C: a dropped connection logs the waiting line as it stands (${JSON.stringify(h.lines())})`
  );
  h.writer.output('ne\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(h.lines().at(-1) === 'ne', 'C: ... and the next session is not glued onto it');
}
{
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('one\r\ntw');
  h.writer.setEnabled(false);
  check(
    h.appends.length === 1 && h.lines().join('|') === 'one|tw',
    'C: logging off writes what waits, the waiting line as it stands, at once'
  );
  h.writer.output('lost\r\n');
  h.writer.typed('lost');
  h.advance(LOG_WRITE_DELAY_MS);
  check(h.appends.length === 1, 'C: nothing is logged while logging is off');
  h.writer.setEnabled(true);
  h.writer.output('three\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.appends.length === 2 &&
      h.appends[0].file === 'session_1.log' &&
      h.appends[1].file === 'session_2.log',
    `C: logging on again opens a new file (${h.appends.map((a) => a.file)})`
  );
  h.writer.setEnabled(true);
  h.writer.output('four\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(h.appends[2]?.file === 'session_2.log', 'C: ... once (a re-render keeps it)');
}
{
  const h = harness();
  mountEffects(h.writer, true, true);
  h.writer.output('Bailey\r\nIt is brig');
  h.writer.close();
  check(
    h.lines().join('|') === 'Bailey|It is brig' && h.timers.pending === 0,
    'C: the unmount writes everything at once, the waiting line as it stands'
  );
}
{
  let ready = false;
  const h = harness({ ready: () => ready });
  mountEffects(h.writer, true, true);
  h.writer.output('early\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(h.appends.length === 0, 'C: nothing is written while the backend cannot write');
  ready = true;
  h.writer.output('later\r\n');
  h.advance(LOG_WRITE_DELAY_MS);
  check(
    h.lines().join('|') === 'early|later',
    `C: ... and the lines wait for the next write (${JSON.stringify(h.lines())})`
  );
}

// --- D: the hook keeps no timer -----------------------------------------------------------------
{
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const hook = fs
    .readFileSync(path.join(repo, 'src/hooks/useSessionLogger.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  check(
    !/\b(setTimeout|clearTimeout|setInterval)\b/.test(hook),
    'D: useSessionLogger keeps no timer of its own (they live in SessionLogWriter)'
  );
  check(hook.includes('new SessionLogWriter('), 'D: useSessionLogger drives a SessionLogWriter');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — session log writer (StrictMode, contents, timing)');
