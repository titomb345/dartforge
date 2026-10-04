/**
 * Hex walk executor — walks the player along a findPath route over the hex
 * map one confirmed hex at a time (click a hex on the map). Each step is
 * sent like a typed command and confirmed by the survey it prints, resolved
 * by the hex localizer; anything else (another hex, a failed move, a
 * building, a direction the player typed) stops the walk.
 *
 * A plain class, like the town walk's (townWalk.ts), so its rules can be
 * tested without React (scripts/town-tests/test-hex-walk.ts); useMapTracker
 * owns one and feeds it the survey resolutions and every tracked command.
 *
 *  - Moves are pipelined: two in flight ahead of confirmation, like a player
 *    spamming directions (the localizer's pending-move queue is built for
 *    it), which hides a server round trip per hex while capping the
 *    overshoot after a refused step to one hex.
 *  - A survey that moved nowhere (a manual survey mid-walk) is no step.
 *  - Pacing — the step timeout, and holding steps while the action blocker
 *    holds sends: walkPacing.ts.
 */

import type { SurveyResolution } from './hexLocalizer';
import { parseDirection, type Direction } from './hexUtils';
import type { Timers } from './timers';
import { WALK_PIPELINE, WalkPacer } from './walkPacing';

export interface HexWalkDeps {
  /** Send one move the way a typed one goes (movement mode, action blocker,
   *  tracking) */
  send(dir: Direction): Promise<void>;
  /** True while the client holds outgoing commands (the action blocker) */
  sendsHeld(): boolean;
  echo(message: string): void;
  /** The walk started, advanced or ended (route preview) */
  changed(): void;
  timers?: Timers;
}

interface HexWalk {
  path: Direction[];
  target: { q: number; r: number };
  /** Steps confirmed by surveys */
  confirmed: number;
  /** Steps sent to the MUD (sent - confirmed = in flight) */
  sent: number;
}

export class HexWalkExecutor {
  private walk: HexWalk | null = null;
  /** A step is going out (the walk's own send is not the player's) */
  private sending = false;
  private readonly pacer: WalkPacer;

  constructor(private readonly deps: HexWalkDeps) {
    this.pacer = new WalkPacer({
      awaitingReply: () => this.walk !== null && this.walk.sent > this.walk.confirmed,
      pump: () => this.pump(),
      expired: () => this.cancel('no response from the MUD'),
      timers: deps.timers,
    });
  }

  get active(): boolean {
    return this.walk !== null;
  }

  /** The walk's target and the moves still to confirm (the route preview) */
  get progress(): { target: { q: number; r: number }; remaining: Direction[] } | null {
    const walk = this.walk;
    if (!walk) return null;
    return { target: walk.target, remaining: walk.path.slice(walk.confirmed) };
  }

  /** Walk `path` — a findPath route from the player's hex — to `target` */
  start(path: Direction[], target: { q: number; r: number }): void {
    this.cancel();
    this.walk = { path, target, confirmed: 0, sent: 0 };
    this.deps.echo(
      `[Map] Walking ${path.length} hex${path.length === 1 ? '' : 'es'}...` +
        (this.deps.sendsHeld() ? ' (after the current action finishes)' : '')
    );
    this.deps.changed();
    this.pacer.restart();
    this.pump();
  }

  /** Stop the walk (with a reason: tell the player) */
  cancel(reason?: string): void {
    if (!this.walk) return;
    this.walk = null;
    this.pacer.stop();
    if (reason) this.deps.echo(`[Map] Walk stopped: ${reason}`);
    this.deps.changed();
  }

  /** An outgoing command: a direction the walk did not send is the player
   *  taking over */
  onCommand(command: string): void {
    if (!this.walk || this.sending) return;
    if (parseDirection(command.trim().toLowerCase()) !== null) this.cancel('manual movement');
  }

  /** A survey resolved */
  onResolution(res: SurveyResolution): void {
    const walk = this.walk;
    if (!walk) return;
    if (!res.pos || res.kind === 'lost') {
      this.cancel('position lost');
      return;
    }
    if (res.moved === null && res.kind === 'stationary') {
      // A manual survey mid-walk: the step in flight is still on its way
      this.pacer.restart();
      return;
    }
    if (res.moved !== walk.path[walk.confirmed]) {
      this.cancel('unexpected movement');
      return;
    }
    walk.confirmed += 1;
    if (walk.confirmed >= walk.path.length) {
      this.walk = null;
      this.pacer.stop();
      this.deps.echo('[Map] Arrived.');
      this.deps.changed();
      return;
    }
    this.pacer.restart();
    this.pump();
    this.deps.changed();
  }

  /** Send moves until WALK_PIPELINE are in flight, one at a time so they
   *  reach the MUD in path order */
  private pump(): void {
    const walk = this.walk;
    if (!walk || this.sending) return;
    if (walk.sent >= walk.path.length) return;
    if (walk.sent - walk.confirmed >= WALK_PIPELINE) return;
    if (this.deps.sendsHeld()) {
      this.pacer.retryWhenReleased();
      return;
    }
    // The oldest unanswered move: its answer is due from now
    if (walk.sent === walk.confirmed) this.pacer.restart();
    const dir = walk.path[walk.sent];
    walk.sent += 1;
    this.sending = true;
    void (async () => {
      await this.deps.send(dir);
    })()
      .catch(() => {
        if (this.walk === walk) this.cancel('send failed');
      })
      .finally(() => {
        this.sending = false;
        // Top up the pipeline (a no-op once the walk is over)
        this.pump();
      });
  }
}
