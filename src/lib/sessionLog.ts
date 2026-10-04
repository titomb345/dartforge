/**
 * Session log format — written by useSessionLogger (through the
 * SessionLogWriter below), read back by the replay tools
 * (scripts/lib/townReplay.ts), which rebuild from a log what the live
 * mapper saw and did. Every line is "[<time>] <text>":
 *
 *   [..] There are two exits: north and south.      server output
 *   [..]                                            a blank output line
 *   [..] >> door w                                  input as typed
 *   [..] >> [sent] unlock w door with key           a command actually sent
 *
 * Server output is cut into lines exactly as the OutputFilter cuts it for
 * the parsers (the shared isCompletePartial rule): a line split across two
 * TCP reads is logged once, whole, and blank lines are kept. The logger
 * used to split every chunk on its own and drop blank lines, so a replay
 * saw half-lines the live parsers never saw (a room name "marke" + "t.",
 * dropped room blocks, a portal line cut in two that glued a whole walk
 * into the portal hub) and missed the blank lines that frame the OOC Entry
 * Hall's notice.
 *
 * Typed input is logged as typed; the commands it really sent — after
 * aliases, speedwalks, the movement mode (Leading turns "n" into "lead n")
 * and the action blocker's hold — are logged with SENT_PREFIX at the moment
 * they go out, along with every send no one typed: the town walk's steps
 * and door sequences, triggers, timers, the login sync. Those are exactly
 * the commands the mapper tracks live; a log without them forced the replay
 * to re-expand typed input with today's aliases and to miss every walk
 * (192 room changes in the July sessions arrived with nothing queued).
 */

import { stripAnsi } from './ansiUtils';
import { isCompletePartial } from './partialLine';
import { realTimers, type Timers } from './timers';

/** Input as typed (the session logger's original command format) */
export const TYPED_PREFIX = '>> ';
/** A command as sent: what the live app tracked */
export const SENT_PREFIX = '>> [sent] ';

/** The clock a log is stamped in (the app's timestamp setting) */
export type LogStampFormat = '12h' | '24h';

/**
 * A log line's stamp, local time: "2026-10-03 2:05:09 PM" (12h) or
 * "2026-10-03 14:05:09" (24h). The replay tools read both
 * (scripts/lib/replayInput.ts parseStamp).
 */
export function formatLogStamp(d: Date, format: LogStampFormat): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  if (format === '12h') {
    const hr = d.getHours();
    const h12 = hr % 12 || 12;
    const ampm = hr < 12 ? 'AM' : 'PM';
    return `${y}-${mo}-${da} ${h12}:${mi}:${s} ${ampm}`;
  }
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

/**
 * Cuts ANSI-stripped output chunks into the lines the OutputFilter hands to
 * the parsers: a chunk's unterminated tail waits for the rest of its line
 * unless it is complete on its own (a prompt — see isCompletePartial).
 */
export class SessionLineSplitter {
  private tail = '';

  /**
   * The lines a chunk finishes: every complete line (blank ones included,
   * as the parsers get them), then a complete tail that shows text ("Name:",
   * the pager prompt — screen-only live, but the replay reads typed logins
   * off the "Name:" prompt). A blank complete tail (a lone CR, color codes)
   * is no line: the parsers never get one.
   */
  push(text: string): string[] {
    const lines = (this.tail + text).split(/\r?\n/);
    this.tail = lines.pop() ?? '';
    if (this.tail && isCompletePartial(this.tail)) {
      if (this.tail.trim() !== '') lines.push(this.tail);
      this.tail = '';
    }
    return lines;
  }

  /** The waiting tail as a line of its own (logging stops, the connection
   *  drops: nothing will complete it), or nothing */
  flush(): string[] {
    const tail = this.tail;
    this.tail = '';
    return tail ? [tail] : [];
  }
}

/** Should an output line be logged? Bare prompts are not ("> " ends every
 *  reply); every other line is, blank ones included. */
export function isLoggedOutputLine(line: string): boolean {
  return line.trim() !== '>';
}

/** Lines wait this long before they are written: one append per burst (ms) */
export const LOG_WRITE_DELAY_MS = 1_000;

export interface SessionLogIO {
  /** Append to a log file (the Tauri append_to_log command). False when it
   *  cannot write yet — the Tauri API is still loading: the lines wait for
   *  the next write */
  append(filename: string, content: string): boolean;
  /** A new log file's name */
  newFilename(): string;
  now?(): Date;
  timers?: Timers;
}

/**
 * The session log of one app run: the logger's state and rules outside
 * React, so they can be tested (scripts/town-tests/test-session-writer.ts).
 * useSessionLogger is glue: it owns one writer and calls setEnabled,
 * connectionLost and close from its effects, and output, typed and sent
 * from the callbacks it hands to App.
 *
 * Lines are buffered and written LOG_WRITE_DELAY_MS after the first
 * unwritten one. A chunk that ends inside an ANSI escape sequence keeps the
 * sequence for the next chunk; output is cut into lines by the
 * SessionLineSplitter. Commands are not logged in password mode (the
 * password prompt), and an empty send (Enter at the pager) is no command.
 *
 * main.tsx renders the app in React.StrictMode, which in a development
 * build (`npm run tauri dev`) runs an effect's setup, its cleanup and its
 * setup again at mount, on the same refs: so close() — the unmount
 * cleanup — leaves the writer as good as new. The hook's cleanup used to
 * clear the pending write's timer but keep its handle, and a write is
 * scheduled only while no handle is held: the connection effect's write,
 * scheduled at mount (the app starts disconnected) and cancelled by the
 * simulated unmount, left every dev session's log unwritten until logging
 * was turned off or the app unmounted (closing the window does not unmount
 * it). The writer drops a timer's handle whenever it clears or runs the
 * timer, and a dropped connection schedules a write only when it logged
 * the waiting line.
 */
export class SessionLogWriter {
  /** Commands typed or sent are not logged (the password prompt) */
  passwordMode = false;
  stampFormat: LogStampFormat = '12h';
  /** The open log file (null: logging is off) */
  private filename: string | null = null;
  private buffer: string[] = [];
  private timer: unknown = null;
  /** An escape sequence the last chunk ended inside (\x1b, \x1b[, \x1b[1;35) */
  private partialAnsi = '';
  private readonly splitter = new SessionLineSplitter();
  private readonly timers: Timers;

  constructor(private readonly io: SessionLogIO) {
    this.timers = io.timers ?? realTimers;
  }

  /** Logging turned on (a new file, unless one is open) or off (what waits
   *  is written and the file closed) */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (!this.filename) this.filename = this.io.newFilename();
      return;
    }
    this.flushTail();
    this.write();
    this.filename = null;
  }

  /** The connection dropped: no line goes on across it, so a line still
   *  waiting for its newline is logged as it stands */
  connectionLost(): void {
    if (this.flushTail()) this.scheduleWrite();
  }

  /** The logger unmounts: everything waiting is written now (the writer
   *  stays usable — see the class comment) */
  close(): void {
    this.cancelWrite();
    this.flushTail();
    this.write();
  }

  /** A chunk of server output as it arrived, color codes and all */
  output(raw: string): void {
    if (!this.filename) return;
    const data = this.partialAnsi + raw;
    // (waiting for the sequence's final letter)
    const cut = /\x1b(\[[\d;]*)?$/.exec(data);
    this.partialAnsi = cut ? cut[0] : '';
    const text = cut ? data.slice(0, -cut[0].length) : data;
    this.pushLines(this.splitter.push(stripAnsi(text)));
    this.scheduleWrite();
  }

  /** Input as the player typed it */
  typed(input: string): void {
    if (!this.filename || this.passwordMode) return;
    this.buffer.push(`[${this.stamp()}] ${TYPED_PREFIX}${input}\n`);
    this.scheduleWrite();
  }

  /** A command as it went out to the MUD */
  sent(command: string): void {
    if (!this.filename || this.passwordMode || !command.trim()) return;
    this.buffer.push(`[${this.stamp()}] ${SENT_PREFIX}${command}\n`);
    this.scheduleWrite();
  }

  /** Log the line waiting for its newline as it stands; true when that
   *  added a line to the log */
  private flushTail(): boolean {
    this.partialAnsi = '';
    const tail = this.splitter.flush();
    return this.filename !== null && this.pushLines(tail) > 0;
  }

  private pushLines(lines: string[]): number {
    let logged = 0;
    for (const line of lines) {
      if (!isLoggedOutputLine(line)) continue;
      this.buffer.push(`[${this.stamp()}] ${line}\n`);
      logged++;
    }
    return logged;
  }

  private stamp(): string {
    return formatLogStamp(this.io.now?.() ?? new Date(), this.stampFormat);
  }

  private scheduleWrite(): void {
    if (this.timer !== null) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.write();
    }, LOG_WRITE_DELAY_MS);
  }

  private cancelWrite(): void {
    if (this.timer === null) return;
    this.timers.clear(this.timer);
    this.timer = null;
  }

  private write(): void {
    if (!this.filename || this.buffer.length === 0) return;
    if (!this.io.append(this.filename, this.buffer.join(''))) return;
    this.buffer = [];
  }
}
