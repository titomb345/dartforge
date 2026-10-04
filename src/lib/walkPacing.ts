/**
 * Walk pacing, shared by the two click-to-walk executors (the town walk,
 * townWalk.ts, and the hex walk, hexWalk.ts): when a walk gives up on an
 * unanswered move, and how it waits while the client holds outgoing
 * commands. One copy, because the two copies of these rules failed the same
 * way.
 *
 *  - While the client holds outgoing commands (the action blocker, during a
 *    cast), a walk sends nothing and looks again every HELD_RETRY_MS: queued
 *    behind the blocker, its steps counted as sent and were later released
 *    as the player's own "manual movement".
 *  - The step timeout ends a walk only when one of its moves has gone out
 *    and WALK_STEP_TIMEOUT passed without an answer, timed from the later
 *    of the walk's last progress (a step confirmed, a re-print) and the
 *    moment its oldest unanswered move went out. A step held behind the
 *    blocker is no move out — there is nothing to answer yet: its window
 *    starts when its move goes out. The window used to run from the click
 *    or the last confirmation even while the step waited behind the
 *    blocker: a cast ending in the window's last quarter second stopped the
 *    walk with "no response from the MUD" before the step had gone out (the
 *    timeout came round before the next retry), and one ending a little
 *    earlier stopped it before the step's reply could arrive. A move that
 *    went out before a cast began is answered before the cast: the MUD
 *    takes a player's commands in order, and it does not sit on commands
 *    during a channeled action (it lets them interrupt it, which is what
 *    the action blocker is for). So a cast does not stretch that move's
 *    window.
 */

import { realTimers, type Timers } from './timers';

/**
 * Steps a walk keeps in flight ahead of confirmation. Two hides a server
 * round trip per step (like a player typing ahead — the localizers' queues
 * are built for it) while capping the overshoot after a refused step to one
 * room or hex.
 */
export const WALK_PIPELINE = 2;
/** Max ms a walk waits for the answer to a move it sent before giving up */
export const WALK_STEP_TIMEOUT = 8_000;
/** How often a walk held behind the action blocker looks again (ms) */
export const HELD_RETRY_MS = 250;

export interface WalkPacerDeps {
  /** True while one of the walk's moves is out and unanswered */
  awaitingReply(): boolean;
  /** Send whatever is due (the executor's pump) */
  pump(): void;
  /** A move went WALK_STEP_TIMEOUT without an answer */
  expired(): void;
  timers?: Timers;
}

/** One walk executor's timers: the step timeout and the held-sends retry */
export class WalkPacer {
  private timeout: unknown = null;
  private retry: unknown = null;
  private readonly timers: Timers;

  constructor(private readonly deps: WalkPacerDeps) {
    this.timers = deps.timers ?? realTimers;
  }

  /**
   * The step window starts now: the walk started or made progress, or its
   * oldest unanswered move just went out.
   */
  restart(): void {
    if (this.timeout !== null) this.timers.clear(this.timeout);
    this.timeout = this.timers.set(() => {
      this.timeout = null;
      // A move out and unanswered all window long: give up. Nothing out
      // (the next step held back): look again later — the window starts
      // over when that step's move goes out anyway
      if (this.deps.awaitingReply()) this.deps.expired();
      else this.restart();
    }, WALK_STEP_TIMEOUT);
  }

  /** Sends are held: pump again shortly (one retry pending at a time) */
  retryWhenReleased(): void {
    if (this.retry !== null) return;
    this.retry = this.timers.set(() => {
      this.retry = null;
      this.deps.pump();
    }, HELD_RETRY_MS);
  }

  /** A send chain held mid-way waits this long before it looks again */
  pause(): Promise<void> {
    return new Promise((resolve) => {
      this.timers.set(resolve, HELD_RETRY_MS);
    });
  }

  /** The walk ended: none of its timers may fire */
  stop(): void {
    if (this.timeout !== null) this.timers.clear(this.timeout);
    if (this.retry !== null) this.timers.clear(this.retry);
    this.timeout = null;
    this.retry = null;
  }
}
