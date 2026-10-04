/**
 * The timer seam of the plain classes the live app's hooks drive (the walk
 * executors' pacing, the map store session, the session log writer): the
 * app passes nothing and gets the real timers; the tests in
 * scripts/town-tests/ pass fake ones and run the clock themselves.
 */

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
