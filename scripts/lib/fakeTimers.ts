/**
 * Timers the town tests advance by hand (scripts/town-tests/): the plain
 * classes the live app's hooks drive take a Timers seam (src/lib/timers.ts),
 * and a test runs the clock itself instead of waiting.
 */
import type { Timers } from '../../src/lib/timers';

export class FakeTimers implements Timers {
  private queue: { id: number; at: number; fn: () => void }[] = [];
  private next = 0;
  constructor(private readonly clock: () => number) {}
  set = (fn: () => void, ms: number): unknown => {
    const id = ++this.next;
    this.queue.push({ id, at: this.clock() + ms, fn });
    return id;
  };
  clear = (handle: unknown): void => {
    this.queue = this.queue.filter((t) => t.id !== handle);
  };
  /** Timers set and not yet run or cleared */
  get pending(): number {
    return this.queue.length;
  }
  /** Run every timer due by now, in time order */
  run(): void {
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const t = this.queue[0];
      if (!t || t.at > this.clock()) return;
      this.queue.shift();
      t.fn();
    }
  }
}
