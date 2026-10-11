/**
 * Synthetic DartForge session logs for the town regression tests, written in
 * the format the replay engine reads (townReplay.ts), so a scenario runs
 * through exactly the wiring the corpus replay — and the live app — uses:
 * alias expansion, the server lines the town engine reads (portal and
 * teleport transits, forced moves, dark arrivals, "What ?"), login lines.
 *
 * Scenario text, one line per log line:
 *   `|text`   a server line; `|` alone is a blank line (the live feed keeps
 *             them — the OOC Entry Hall frames its notice with blank lines)
 *   `>> cmd`  logged input, one second after the previous input
 *   `@N`      N seconds pass (a long idle, an offline gap)
 * Server lines carry the second of the input before them, as real logs do.
 * Leading whitespace before the `|` is template indentation; after it, the
 * line's own (board names are indented on the wire).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class SessionFixture {
  private readonly dir: string;
  private files = 0;

  constructor(prefix: string) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  /** Write one session log (one app run, starting an hour after the previous
   *  one) and return its path */
  write(text: string): string {
    let t = Date.UTC(2026, 7, 1, 12, 0, 0) + this.files * 3_600_000;
    const out: string[] = [];
    for (const raw of text.split('\n')) {
      const wait = /^\s*@(\d+)\s*$/.exec(raw);
      if (wait) {
        t += Number(wait[1]) * 1000;
        continue;
      }
      if (raw.startsWith('>> ')) t += 1000;
      out.push(`${stamp(t)} ${raw.replace(/^\s*\|/, '')}`);
    }
    const file = path.join(this.dir, `session_test-${String(this.files++).padStart(3, '0')}.log`);
    fs.writeFileSync(file, out.join('\n') + '\n');
    return file;
  }

  remove(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** "[2026-08-01 12:00:05 PM]" — the session logger's stamp (UTC fields; the
 *  replay reads stamps as local time, which only shifts every line alike) */
function stamp(t: number): string {
  const d = new Date(t);
  const h = d.getUTCHours();
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `[${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ` +
    `${h % 12 || 12}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}]`
  );
}
