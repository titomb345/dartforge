/**
 * DoorRunner — response-aware door crossing (the "Option 2" upgrade over
 * the blind /door sequence). Sends one command at a time and reads the
 * MUD's reply to decide the next move, instead of firing every keyring
 * slot blind:
 *
 *   unlock w door with key      → "You fail."                (wrong key — next slot)
 *   unlock w door with key 2    → "You unlock the oak door." (remember slot 2)
 *   open w door                 → "You open the oak door."
 *   w                           → (room block — confirmed externally)
 *   close e door                → "You close the oak door."
 *   lock e door with key 2      → "You lock the oak door."   (only the key that worked)
 *
 * Message inventory (live-confirmed by Bill + corpus-mined, July 2026):
 *   "You unlock/lock/open/close the X."      success
 *   "You fail."                              wrong key for this lock
 *   "You don't have one of those."           keyring slot doesn't exist (stop higher slots)
 *   "The X has no lock!"                     no lock at all — skip straight to open
 *   "The X is open." / "is already open." / "It is already open!"   standing open
 *   "The X is locked." / "is locked!"        open attempt failed — need a key we don't have
 *   "The X is closed." / "It is closed."     move blocked by a closed door
 *   "The X is already closed."               close was unnecessary
 *
 * Leave-as-found policy (matches the auto-walk's door handling): a door
 * found standing open is walked through and left open; lock is only sent
 * when WE unlocked (with exactly the key that worked). Unrecognized
 * replies time out and fall back to blind-continue, so novel message
 * variants degrade to the old behavior instead of hanging.
 */

const PROMPT = /^(?:> )*/;
const strip = (line: string) => line.replace(PROMPT, '').trim();

type Reply =
  | 'unlocked'
  | 'locked-ok'
  | 'opened'
  | 'closed-ok'
  | 'fail'
  | 'no-key'
  | 'no-lock'
  | 'is-open'
  | 'is-locked'
  | 'is-closed'
  | 'already-closed'
  | 'moved'
  | 'timeout';

const REPLY_RES: [Reply, RegExp][] = [
  ['unlocked', /^You unlock the .{1,70}\.$/],
  ['locked-ok', /^You lock the .{1,70}\.$/],
  ['opened', /^You open the .{1,70}\.$/],
  ['closed-ok', /^You close the .{1,70}\.$/],
  ['fail', /^You fail\.$/],
  ['no-key', /^You don't have one of those\.$/],
  ['no-lock', /^(?:The .{1,70}|It) has no lock!$/],
  ['is-open', /^(?:The .{1,70} is (?:already )?open[.!]|It(?:'s| is) (?:already )?open[.!])$/],
  ['is-locked', /^(?:The .{1,70} is locked[.!]|It(?:'s| is) locked[.!])$/],
  ['already-closed', /^(?:The .{1,70} is already closed[.!]|It is already closed[.!])$/],
  ['is-closed', /^(?:The .{1,70} is closed[.!]|It(?:'s| is) closed[.!])$/],
];

/** Replies each phase reacts to (all others are ignored as unrelated spam) */
const UNLOCK_EXPECT: Reply[] = ['unlocked', 'fail', 'no-key', 'no-lock', 'is-open'];
const OPEN_EXPECT: Reply[] = ['opened', 'is-open', 'is-locked', 'no-lock'];
const MOVE_EXPECT: Reply[] = ['is-closed', 'is-locked'];
const CLOSE_EXPECT: Reply[] = ['closed-ok', 'already-closed', 'is-locked'];
// 'is-locked' counts as done: the door is locked, however that came about
// (some doors self-lock on close) — without it the reply times out and the
// old retry loop would spray every other key at an already-locked door.
const LOCK_EXPECT: Reply[] = ['locked-ok', 'fail', 'no-key', 'no-lock', 'is-open', 'is-locked'];

/**
 * A failed move's reply is the FIRST line the server sends back. Once other
 * output has streamed past (the arrival room's name/description — which can
 * itself contain full-line "It is closed."-style prose), a late match is a
 * false positive, so after this many unmatched non-empty lines the move is
 * treated as succeeded.
 */
const MOVE_REPLY_LINE_WINDOW = 2;

export interface DoorCrossingOptions {
  /** Short direction word ('w', 'ne', 'in', ...) */
  dir: string;
  /** Opposite direction (for close/lock on the far side) */
  opp: string;
  /** Keyring slots available ("key" .. "key N") */
  keys: number;
  /** Slot that worked on this door before — tried first */
  preferredKey?: number;
  /** The exits line said the door is standing open — walk straight through */
  knownOpen?: boolean;
  send: (cmd: string) => Promise<void>;
  /** Ms to wait for a recognizable reply before continuing blind */
  responseTimeoutMs?: number;
}

export interface DoorCrossingResult {
  /** False = we are still on the near side (locked out / door closed) */
  ok: boolean;
  reason?: string;
  /** Keyring slot that unlocked the door (for per-door key memory) */
  unlockedWithKey?: number;
  /** Door was found standing open and left that way */
  wasOpen: boolean;
}

const keyName = (i: number) => (i === 1 ? 'key' : `key ${i}`);

export class DoorRunner {
  private pending: {
    expect: Reply[];
    resolve: (r: Reply) => void;
    timer: ReturnType<typeof setTimeout>;
    isMove: boolean;
    /** Non-empty lines seen without a match (move false-positive guard) */
    unmatched: number;
  } | null = null;
  private cancelled = false;
  /** Keyring slots, defensively clamped (a corrupt persisted setting must
   *  never mean "try zero keys") */
  private readonly keys: number;

  constructor(private opts: DoorCrossingOptions) {
    this.keys = Math.max(1, Math.min(10, Math.floor(opts.keys) || 1));
  }

  /** Feed every output line (ANSI-stripped). Unrelated lines are ignored. */
  feedLine(line: string): void {
    const p = this.pending;
    if (!p) return;
    const t = strip(line);
    if (!t) return;
    for (const [reply, re] of REPLY_RES) {
      if (!p.expect.includes(reply)) continue;
      if (re.test(t)) {
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(reply);
        return;
      }
    }
    // A move's failure reply arrives immediately; once the arrival room's
    // block starts streaming, stop matching (descriptions can contain
    // "It is closed."-style lines) and count the move as succeeded.
    if (p.isMove && ++p.unmatched >= MOVE_REPLY_LINE_WINDOW) {
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve('moved');
    }
  }

  /** The walk executor confirmed arrival (room block) — ends the move wait. */
  notifyMoved(): void {
    const p = this.pending;
    if (p?.isMove) {
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve('moved');
    }
  }

  /** Stop sending further commands (walk cancelled). */
  cancel(): void {
    this.cancelled = true;
    const p = this.pending;
    if (p) {
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve('timeout');
    }
  }

  private async step(cmd: string, expect: Reply[], isMove = false): Promise<Reply> {
    if (this.cancelled) return 'timeout';
    await this.opts.send(cmd);
    if (this.cancelled) return 'timeout';
    return new Promise<Reply>((resolve) => {
      this.pending = {
        expect,
        resolve,
        isMove,
        unmatched: 0,
        timer: setTimeout(() => {
          this.pending = null;
          resolve('timeout');
        }, this.opts.responseTimeoutMs ?? 1200),
      };
    });
  }

  /**
   * Unlock (trying keys until one works) and open. Returns the slot that
   * unlocked (if any), whether the door turned out to be standing open,
   * and ok=false when it is locked and no key fits.
   */
  private async unlockAndOpen(): Promise<{
    ok: boolean;
    wasOpen: boolean;
    unlockedWith?: number;
  }> {
    const { dir } = this.opts;
    let unlockedWith: number | undefined;
    // Try the remembered key first, then the rest in order. "You don't
    // have one of those." means slots that high don't exist, so everything
    // above it is skipped too.
    const order: number[] = [];
    const preferred = this.opts.preferredKey;
    if (preferred && preferred >= 1 && preferred <= this.keys) order.push(preferred);
    for (let i = 1; i <= this.keys; i++) if (i !== preferred) order.push(i);
    let maxSlot = this.keys;
    for (const slot of order) {
      if (slot > maxSlot) continue;
      const reply = await this.step(`unlock ${dir} door with ${keyName(slot)}`, UNLOCK_EXPECT);
      if (reply === 'unlocked') {
        unlockedWith = slot;
        break;
      }
      if (reply === 'no-lock') break;
      if (reply === 'is-open') return { ok: true, wasOpen: true };
      if (reply === 'no-key') maxSlot = Math.min(maxSlot, slot - 1);
      // 'fail' / 'timeout' → next slot
    }
    if (this.cancelled) return { ok: true, wasOpen: false, unlockedWith };
    const reply = await this.step(`open ${dir} door`, OPEN_EXPECT);
    if (reply === 'is-locked') return { ok: false, wasOpen: false };
    if (reply === 'is-open') return { ok: true, wasOpen: true, unlockedWith };
    // 'opened' / 'no-lock' / 'timeout' → proceed
    return { ok: true, wasOpen: false, unlockedWith };
  }

  /**
   * Execute the crossing. Resolves once the far-side close/lock is done
   * (or immediately on a near-side failure). The move itself is verified
   * by the walk executor's own room-block confirmation — a 'timeout' on
   * the move step just means "no failure line printed".
   */
  async run(): Promise<DoorCrossingResult> {
    const { dir, opp } = this.opts;
    let wasOpen = this.opts.knownOpen ?? false;
    let unlockedWith: number | undefined;
    const lockedOut = (): DoorCrossingResult => ({
      ok: false,
      wasOpen: false,
      reason: 'the door is locked and no key on the ring fits',
    });

    if (!wasOpen) {
      const phase = await this.unlockAndOpen();
      if (!phase.ok) return lockedOut();
      wasOpen = phase.wasOpen;
      unlockedWith = phase.unlockedWith;
    }

    if (this.cancelled) return { ok: false, wasOpen, reason: 'cancelled' };

    // --- MOVE. Success is the room block (notifyMoved) or simply no
    // failure line in the immediate replies.
    let moveReply = await this.step(dir, MOVE_EXPECT, true);
    if ((moveReply === 'is-closed' || moveReply === 'is-locked') && wasOpen && !this.cancelled) {
      // Believed open but actually closed (state went stale between the
      // sighting and the step) — fall back to the closed-door sequence
      // once instead of aborting the whole walk.
      wasOpen = false;
      const phase = await this.unlockAndOpen();
      if (!phase.ok) return lockedOut();
      wasOpen = phase.wasOpen;
      unlockedWith = phase.unlockedWith;
      moveReply = await this.step(dir, MOVE_EXPECT, true);
    }
    if (moveReply === 'is-closed' || moveReply === 'is-locked') {
      return { ok: false, wasOpen, unlockedWithKey: unlockedWith, reason: 'the door is closed' };
    }

    // --- CLOSE + LOCK behind us — only for doors we found closed, and
    // lock only with the key that actually unlocked (leave-as-found).
    if (!wasOpen && !this.cancelled) {
      await this.step(`close ${opp} door`, CLOSE_EXPECT);
      if (unlockedWith !== undefined && !this.cancelled) {
        const reply = await this.step(
          `lock ${opp} door with ${keyName(unlockedWith)}`,
          LOCK_EXPECT
        );
        // Same physical lock — the same key should work. Only an explicit
        // "You fail." warrants trying the other slots once; an unrecognized
        // reply (timeout) means continue blind, never retry-storm.
        if (reply === 'fail') {
          for (let slot = 1; slot <= this.keys && !this.cancelled; slot++) {
            if (slot === unlockedWith) continue;
            const r = await this.step(`lock ${opp} door with ${keyName(slot)}`, LOCK_EXPECT);
            if (r !== 'fail') break;
          }
        }
      }
    }

    return { ok: true, wasOpen, unlockedWithKey: unlockedWith };
  }
}

// ---------------------------------------------------------------------------
// Active-runner registry — a single output tap (useMapTracker.feedLine sees
// every ANSI-stripped line) feeds whichever runner is currently crossing.
// ---------------------------------------------------------------------------

let activeRunner: DoorRunner | null = null;

export function setActiveDoorRunner(runner: DoorRunner | null): void {
  activeRunner = runner;
}

export function getActiveDoorRunner(): DoorRunner | null {
  return activeRunner;
}

export function feedActiveDoorRunner(line: string): void {
  activeRunner?.feedLine(line);
}
