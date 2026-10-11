/**
 * Town walk executor — walks the player along a findPath route through the
 * town map one confirmed room at a time (right-click a room on the town
 * map). Each step is sent like a typed command and confirmed by the room
 * block it prints, resolved by the town localizer; anything else (a
 * different room, a transit, a forced move, a failure) stops the walk.
 *
 * A plain class so its rules can be tested against the real localizer
 * (scripts/town-tests/test-town-walk.ts); useMapTracker owns one and feeds
 * it the localizer's resolutions, the line events (townLineEvents.ts) and
 * every tracked command.
 *
 * Rules, each a way a walk used to fail live:
 *  - Steps are pipelined (two in flight, like a player typing ahead), but a
 *    door step waits until the room before it is confirmed — its commands
 *    are built from that room's fresh exits line — and so does the step
 *    after a door: a crossing that bounces ("The oak door is closed.")
 *    would otherwise send the next move from the wrong room (10 of 1,485
 *    corpus door sequences bounced).
 *  - A door is addressed by its own noun ("open u trapdoor", "open s gate"
 *    — "door" does not find either), and whether a step crosses a door at
 *    all is re-read at send time: a saved room keeps a stale exits line
 *    until it is seen again.
 *  - One step's commands go out at a time (a door sequence is up to 2N+3
 *    sends); a walk cancelled while they go out stops short of the move.
 *  - A look (typed, or a trigger's) is no manual movement, and its reply is
 *    a re-print, not a step: typing "l" mid-walk stopped 12 corpus walks.
 *  - A step is confirmed only in the walk's own town (room ids are per-town
 *    counters: every town has a room #0).
 *  - A merge cancels the walk only when the walk's own town was merged away
 *    (mergeTowns keeps the target town's room ids).
 *  - Nothing starts while a move sent under 3 s ago is still unanswered:
 *    the route is planned from where the map says the player stands, and
 *    that move's arrival would be taken for the first step (16% of corpus
 *    indoor sends went out with such a move pending). A click on another
 *    room during a walk stops it; once its steps in flight have landed, the
 *    next click walks. A click on the walk's own destination, or on a room
 *    with no known route, leaves the walk going.
 *  - While the client holds outgoing commands (the action blocker, during a
 *    cast), the walk holds its steps, and a door sequence that a block
 *    interrupts holds the rest of its commands: queued behind the blocker
 *    they were counted as sent, then released as the player's own "manual
 *    movement". Pacing (this hold, the step timeout): walkPacing.ts.
 *  - A step into an unlit room prints "It is pitch black." instead of a
 *    block: the localizer moves along the walked link (DarkArrival
 *    'advanced'), which confirms the step; a dark step it cannot follow
 *    ends the walk.
 */

import { buildDoorSequence, doorCommandNoun } from './doorSequence';
import type { TownLineEvent } from './townLineEvents';
import type { DarkArrival, TownLocalizer, TownResolution } from './townLocalizer';
import type { Town, TownMapStore, TownPos, TownWalkStep } from './townMap';
import { TOWN_DIR_ALIASES, TOWN_REVERSE } from './townParser';
import type { Timers } from './timers';
import { WALK_PIPELINE, WalkPacer } from './walkPacing';

/** A walk won't start while a move sent this recently is unanswered (ms) */
export const STILL_MOVING_MS = 3_000;

export interface TownWalkDeps {
  /** The live map and localizer — read on every use (a character switch
   *  replaces both) */
  map(): TownMapStore;
  localizer(): TownLocalizer;
  /** Send one command the way a typed one goes (movement mode, action
   *  blocker, tracking) */
  send(cmd: string): Promise<void>;
  /** Keyring slots a door sequence tries */
  doorKeys(): number;
  /** True while the client holds outgoing commands (the action blocker) */
  sendsHeld(): boolean;
  /** True while the player is inside (the hex engine saw an exits line) */
  indoors(): boolean;
  echo(message: string): void;
  /** The walk started, advanced or ended (route preview) */
  changed(): void;
  /** A walk passed its checks and is about to send its first step: stop
   *  whatever it replaces (the hex walk) */
  starting?(): void;
  now?(): number;
  timers?: Timers;
}

interface WalkStep extends TownWalkStep {
  /** Crosses a door per the room it leaves, when planned (banner count) */
  door: boolean;
  /** Went out as a door crossing: the next step waits for its arrival */
  crossedDoor?: boolean;
}

interface Walk {
  steps: WalkStep[];
  confirmed: number;
  /** Steps whose commands started going out */
  sent: number;
  /** Steps whose move has gone out (a door step's move follows its unlock
   *  and open commands, which a block can hold back) */
  out: number;
  townId: number;
  /** The room the walk started from */
  startRoomId: number;
}

export class TownWalkExecutor {
  private walk: Walk | null = null;
  /** A step's commands are going out (one step at a time; the walk's own
   *  sends are not the player's) */
  private sending = false;
  /** ... but that step's chain waits behind the action blocker: what is
   *  tracked meanwhile is not the walk's (the chain sends nothing) */
  private waiting = false;
  private readonly pacer: WalkPacer;

  constructor(private readonly deps: TownWalkDeps) {
    this.pacer = new WalkPacer({
      awaitingReply: () => this.walk !== null && this.walk.out > this.walk.confirmed,
      pump: () => this.pump(),
      expired: () => this.cancel('no response from the MUD'),
      timers: deps.timers,
    });
  }

  get active(): boolean {
    return this.walk !== null;
  }

  /** Steps left and the rooms they lead through (the route preview) */
  get progress(): { remaining: number; path: number[] } | null {
    const walk = this.walk;
    if (!walk) return null;
    return {
      remaining: walk.steps.length - walk.confirmed,
      path: walk.steps.slice(walk.confirmed).map((s) => s.toRoomId),
    };
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Walk to a room of the player's town. False (with a message) when the
   *  walk can't start. */
  start(roomId: number): boolean {
    const map = this.deps.map();
    const loc = this.deps.localizer();
    const pos = map.pos;
    if (!loc.active || !pos) {
      this.deps.echo(
        this.deps.indoors()
          ? "[Map] Waiting for a room description. Type 'look' and try again."
          : '[Map] You are outdoors. Enter the town to walk its rooms.'
      );
      return false;
    }
    if (loc.lost) {
      this.deps.echo('[Map] Cannot walk: room unknown.');
      return false;
    }
    const town = map.get(pos.townId);
    if (!town) return false;
    const current = this.walk;
    // The walk's own destination clicked again: it goes on
    if (
      current?.townId === town.id &&
      current.steps[current.steps.length - 1].toRoomId === roomId
    ) {
      return true;
    }
    const route = map.findPath(town, pos.roomId, roomId);
    if (!route) {
      // (A walk under way goes on)
      this.deps.echo('[Map] No known route there.');
      return false;
    }
    // A new destination replaces the walk under way — whose steps still in
    // flight then make the check below ask for one more click once they land
    this.cancel('new destination');
    const now = this.now();
    if (loc.pendingMoves.some((m) => m.kind !== 'look' && now - m.at < STILL_MOVING_MS)) {
      this.deps.echo('[Map] Still moving...');
      return false;
    }
    if (route.length === 0) {
      this.deps.echo('[Map] You are already there.');
      return false;
    }
    let doors = 0;
    const steps: WalkStep[] = route.map((s, i) => {
      const door = this.crossesDoor(town, i === 0 ? pos.roomId : route[i - 1].toRoomId, s.cmd);
      if (door) doors++;
      return { ...s, door };
    });
    this.deps.starting?.();
    this.walk = { steps, confirmed: 0, sent: 0, out: 0, townId: town.id, startRoomId: pos.roomId };
    const n = steps.length;
    this.deps.echo(
      `[Map] Walking ${n} room${n === 1 ? '' : 's'}${doors > 0 ? ` (${doors} door${doors === 1 ? '' : 's'})` : ''}...` +
        (this.deps.sendsHeld() ? ' (after the current action finishes)' : '')
    );
    this.deps.changed();
    this.pacer.restart();
    this.pump();
    return true;
  }

  /** Stop the walk (with a reason: tell the player) */
  cancel(reason?: string): void {
    if (!this.walk) return;
    this.walk = null;
    this.pacer.stop();
    if (reason) this.deps.echo(`[Map] Walk stopped: ${reason}`);
    this.deps.changed();
  }

  /**
   * An outgoing command, BEFORE the localizer tracks it: a move the walk
   * did not send is the player taking over. Looks are not moves.
   */
  onCommand(command: string, now: number): void {
    if (!this.walk || (this.sending && !this.waiting)) return;
    const move = this.deps.localizer().classifyCommand(command, now);
    if (move && move.kind !== 'look') this.cancel('manual movement');
  }

  /** A room block resolved */
  onResolution(res: TownResolution): void {
    const walk = this.walk;
    if (!walk) return;
    if (res.merged && res.merged.from === walk.townId) {
      // The walk's town was merged away: its room ids are gone
      this.cancel('map changed');
      return;
    }
    if (!res.pos || res.kind === 'lost') {
      this.cancel('position lost');
      return;
    }
    if (res.kind === 'stationary') {
      // A re-print or a look's reply: the step in flight is still on its way
      this.pacer.restart();
      return;
    }
    this.arrive(res.pos);
  }

  /** Lines the town engine read (dispatchTownLine) */
  onLineEvents(events: readonly TownLineEvent[]): void {
    for (const e of events) {
      const walk = this.walk;
      if (!walk) return;
      switch (e.kind) {
        case 'portal':
          this.cancel('stepped through a portal');
          break;
        case 'teleport':
          this.cancel('teleported');
          break;
        case 'forced-move':
          this.cancel('someone led you away');
          break;
        case 'dark':
          this.onDark(e.result);
          break;
        case 'unknown-command':
          // A failed step (a dynamic exit that is gone: Syphe's covered hole)
          // would otherwise wait out the step timeout
          if (e.failed && walk.out > walk.confirmed) {
            this.cancel(`the game didn't understand "${walk.steps[walk.confirmed].cmd}"`);
          }
          break;
      }
    }
  }

  /** A movement failure indoors ("The oak door is closed.") */
  onMoveFailed(): void {
    this.cancel('movement blocked');
  }

  /** A wilderness survey: the player is outside */
  onWilderness(): void {
    this.cancel('left the building');
  }

  // -------------------------------------------------------------------------

  /** The oldest step in flight landed at `pos` */
  private arrive(pos: TownPos): void {
    const walk = this.walk!;
    // (Only a step whose move went out can land)
    const expected = walk.confirmed < walk.out ? walk.steps[walk.confirmed] : undefined;
    if (!expected || pos.townId !== walk.townId || pos.roomId !== expected.toRoomId) {
      this.cancel('unexpected movement');
      return;
    }
    walk.confirmed += 1;
    if (walk.confirmed >= walk.steps.length) {
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

  /** "It is pitch black." — no block will confirm the step */
  private onDark(result: DarkArrival): void {
    switch (result) {
      case 'transit': // the transit line already ended the walk
        return;
      case 'none':
      case 'look': // nothing of the walk's moved
        this.pacer.restart();
        return;
      case 'advanced': {
        const pos = this.deps.map().pos;
        if (pos) this.arrive(pos);
        else this.cancel('lost track of you in the dark');
        return;
      }
      case 'unknown':
        this.cancel('lost track of you in the dark');
        return;
    }
  }

  /** Does leaving `fromId` by `cmd` cross a door, per that room's latest exits line? */
  private crossesDoor(town: Town, fromId: number, cmd: string): boolean {
    const dir = TOWN_DIR_ALIASES[cmd];
    return dir !== undefined && (town.rooms.get(fromId)?.doorDirs.includes(dir) ?? false);
  }

  /** Send steps until WALK_PIPELINE are in flight, one step's commands at a time */
  private pump(): void {
    const walk = this.walk;
    // A step's commands are still going out: their chain pumps when done
    if (!walk || this.sending) return;
    if (walk.sent >= walk.steps.length) return;
    if (walk.sent - walk.confirmed >= WALK_PIPELINE) return;
    if (this.deps.sendsHeld()) {
      this.pacer.retryWhenReleased();
      return;
    }
    const index = walk.sent;
    const step = walk.steps[index];
    const prev = index > 0 ? walk.steps[index - 1] : undefined;
    const town = this.deps.map().get(walk.townId);
    const fromId = prev ? prev.toRoomId : walk.startRoomId;
    const door = town ? this.crossesDoor(town, fromId, step.cmd) : false;
    // A door step waits for the room before it (fresh door state), and the
    // step after a door waits for the crossing. Every confirmation re-pumps,
    // so a held step releases itself.
    if ((door || prev?.crossedDoor) && walk.confirmed < walk.sent) return;
    let cmds = [step.cmd];
    const dir = TOWN_DIR_ALIASES[step.cmd];
    const from = town?.rooms.get(fromId);
    if (door && dir && from && !from.openDoorDirs.includes(dir)) {
      // Closed (or unknown) door: the full unlock/open/move/close/lock
      // sequence, each side by its own noun. A door found standing open is
      // left as found: walked straight through, never closed or locked.
      const back = TOWN_REVERSE[dir];
      const noun = from.doorNouns?.[dir];
      const farNoun = town?.rooms.get(step.toRoomId)?.doorNouns?.[back] ?? noun;
      cmds =
        buildDoorSequence(
          step.cmd,
          this.deps.doorKeys(),
          doorCommandNoun(noun),
          doorCommandNoun(farNoun)
        ) ?? cmds;
    }
    step.crossedDoor = door;
    walk.sent += 1;
    this.sending = true;
    const moveAt = Math.max(0, cmds.indexOf(step.cmd));
    void (async () => {
      for (let i = 0; i < cmds.length; i++) {
        // Cancelled while this step goes out: stop short of the move. Once
        // the move is out, the door behind is still closed and locked.
        const beforeMove = i <= moveAt;
        // A block that starts while the sequence goes out (an auto-cast's
        // cast, from a line read between two sends) holds the rest of it
        // here, not in the blocker's queue
        while (this.deps.sendsHeld() && !(beforeMove && this.walk !== walk)) {
          this.waiting = true;
          await this.pacer.pause();
          this.waiting = false;
        }
        if (beforeMove && this.walk !== walk) return;
        if (i === moveAt) {
          walk.out = index + 1;
          // The oldest unanswered move: its answer is due from now
          if (index === walk.confirmed) this.pacer.restart();
        }
        await this.deps.send(cmds[i]);
      }
    })()
      .catch(() => {
        if (this.walk === walk) this.cancel('send failed');
      })
      .finally(() => {
        this.sending = false;
        this.pump();
      });
  }
}
