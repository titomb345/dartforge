/**
 * Town localizer — decides which room the player is in after each town
 * room block.
 *
 * Strategy (mirrors the hex localizer's "correlate, don't trust the queue"):
 *  - A FIFO queue of pending movement commands predicts the next room.
 *  - When a room block arrives, the prediction is VERIFIED against the
 *    block's fingerprint (name; exits leniently). Silent move failures
 *    desync FIFO queues — corpus mining proved it — so a failed prediction
 *    falls back to correlating the block against the current room and all
 *    linked neighbors before going lost.
 *  - Lost-in-town relocalizes by a unique strict fingerprint match
 *    (name + exits dir-set) within the town.
 *  - Towns are keyed by the hex entered from. Entering from a new hex first
 *    tries to match the arrival room against known towns' entry rooms
 *    (towns often have several entrances) before creating a new town.
 *
 * Purely a town module: never touches the hex engine.
 */

import { TOWN_DIR_ALIASES, TOWN_DIR_VEC, type TownDir, type TownRoomBlock } from './townParser';
import { TownMapStore, type Town, type TownRoom, type TownPos } from './townMap';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Pending moves older than this are dropped (ms) */
const QUEUE_MAX_AGE = 20_000;
/** Max queued pending moves */
const QUEUE_MAX_LEN = 12;
/**
 * An unexplainable room block arriving this long after the previous one is
 * treated as a fresh town entry, not a jump within the current town. Guards
 * against boat rides gluing two port towns together: below deck there are
 * no wilderness surveys, so without this the arrival pier would be filed
 * into the departure town.
 */
const CONTINUITY_GAP_MS = 180_000;
/** Search radius (grid cells) for proximity-based room reuse */
const NEAR_RADIUS = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TownMove =
  | { kind: 'dir'; dir: TownDir; at: number }
  | { kind: 'named'; cmd: string; at: number }
  | { kind: 'look'; at: number };

export type TownResolutionKind =
  | 'entered' // first room after coming in from the wilderness
  | 'expected' // prediction verified
  | 'new-room' // moved into an unmapped room (frontier)
  | 'jumped' // unexplained room (hidden alias/forced move) — floating room created
  | 'stationary' // look / re-print of the current room
  | 'corrected' // prediction failed; a neighbor correlation won
  | 'relocalized' // was lost; unique fingerprint match
  | 'lost'; // could not resolve

export interface TownResolution {
  kind: TownResolutionKind;
  pos: TownPos | null;
  /** The move that was confirmed, if any */
  moved: TownMove | null;
  /** Towns fused during this resolution (structural merge probe) */
  merged?: { from: number; into: number };
}

/** Commands that lead through non-directional exits */
const NAMED_MOVE_WORDS = new Set(['enter', 'board', 'exit', 'out', 'leave', 'back', 'disembark']);

/** Classify an outgoing command as a town move (or not) */
export function classifyTownCommand(command: string, now: number): TownMove | null {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return null;
  if (cmd === 'l' || cmd === 'look' || cmd === 'lo') return { kind: 'look', at: now };
  const dir = TOWN_DIR_ALIASES[cmd];
  if (dir) return { kind: 'dir', dir, at: now };
  const space = cmd.indexOf(' ');
  const first = space > 0 ? cmd.slice(0, space) : cmd;
  if (space > 0 && (first === 'go' || first === 'sneak' || first === 'climb')) {
    const d = TOWN_DIR_ALIASES[cmd.slice(space + 1).trim()];
    if (d) return { kind: 'dir', dir: d, at: now };
  }
  if (NAMED_MOVE_WORDS.has(first)) return { kind: 'named', cmd, at: now };
  return null;
}

// ---------------------------------------------------------------------------
// Localizer
// ---------------------------------------------------------------------------

export class TownLocalizer {
  private queue: TownMove[] = [];
  /** True while the player is inside a town (activated by room blocks) */
  active = false;
  /** True when inside a town but position is unknown */
  lost = false;
  /** Diagnostic: a known link predicted a room the block didn't match */
  linkMisses = 0;
  /** Timestamp of the last resolved room block (continuity tracking) */
  private lastBlockAt = 0;

  constructor(private map: TownMapStore) {}

  get pendingMoves(): readonly TownMove[] {
    return this.queue;
  }

  /** Track an outgoing command. Only queues while indoors. */
  trackCommand(command: string, now: number): boolean {
    if (!this.active) return false;
    const move = classifyTownCommand(command, now);
    if (!move) return false;
    this.queue.push(move);
    if (this.queue.length > QUEUE_MAX_LEN) this.queue.shift();
    return true;
  }

  /** A movement failure arrived — the oldest pending move never happened. */
  onMoveFailed(): void {
    this.queue.shift();
  }

  /**
   * A wilderness survey arrived — the player is outside. Deactivate; the
   * map keeps the last position so re-entering resumes instantly. The room
   * we just left is remembered so the hex we emerge onto can be recorded
   * as an anchor (via noteOutdoorPosition once the survey resolves).
   */
  onWilderness(): void {
    if (this.active && this.map.pos) this.pendingExit = this.map.pos;
    this.active = false;
    this.lost = false;
    this.queue = [];
  }

  /**
   * Call after the hex position resolves following an exit from a town —
   * learns "leaving room R puts you on hex H", so entering from H later
   * localizes instantly.
   */
  noteOutdoorPosition(anchor: string | null): void {
    const exit = this.pendingExit;
    this.pendingExit = null;
    if (!exit || !anchor) return;
    const town = this.map.get(exit.townId);
    if (!town || !town.rooms.has(exit.roomId)) return;
    this.map.setAnchor(town, anchor, exit.roomId);
  }

  private pendingExit: TownPos | null = null;

  /** Reset transient state (reconnect). Map data untouched. */
  reset(): void {
    this.active = false;
    this.lost = false;
    this.queue = [];
    this.pendingExit = null;
  }

  /**
   * Resolve a town room block. `anchor` is the hex the player is parked on
   * ("island:q,r"), used to pick/create the town when entering.
   */
  onRoomBlock(block: TownRoomBlock, anchor: string | null, now: number): TownResolution {
    const res = this.resolveBlock(block, anchor, now);
    if (res.pos && res.kind !== 'lost') {
      const merged = this.tryMergeProbe();
      if (merged) {
        res.merged = merged;
        res.pos = this.map.pos;
      }
    }
    return res;
  }

  /**
   * While fragments exist (same physical town entered from hexes that
   * weren't yet anchored), probe whether the current room + its linked
   * neighborhood uniquely matches a room in another town — if so the two
   * fragments physically overlap and are fused (the hex engine's island
   * merge, ported to room graphs).
   */
  private tryMergeProbe(): { from: number; into: number } | undefined {
    const pos = this.map.pos;
    if (!pos) return undefined;
    const town = this.map.get(pos.townId);
    const room = town?.rooms.get(pos.roomId);
    if (!town || !room) return undefined;
    const cand = this.map.findMergeCandidate(town, room, 2);
    if (!cand) return undefined;
    if (town.rooms.size <= cand.town.rooms.size) {
      this.map.mergeTowns(town, room.id, cand.town, cand.room.id);
      return { from: town.id, into: cand.town.id };
    }
    this.map.mergeTowns(cand.town, cand.room.id, town, room.id);
    return { from: cand.town.id, into: town.id };
  }

  private resolveBlock(block: TownRoomBlock, anchor: string | null, now: number): TownResolution {
    this.expireQueue(now);
    const gap = now - this.lastBlockAt;
    this.lastBlockAt = now;

    if (!this.active) {
      return this.enterTown(block, anchor, now);
    }

    const town = this.map.pos ? this.map.get(this.map.pos.townId) : undefined;
    if (!town || this.lost || !this.map.pos) {
      return this.relocalize(block, town ?? null, anchor, now);
    }
    const current = town.rooms.get(this.map.pos.roomId);
    if (!current) {
      return this.relocalize(block, town, anchor, now);
    }

    // --- Try the queue prediction first ---
    const move = this.queue[0];

    if (move?.kind === 'look') {
      this.queue.shift();
      if (this.map.matches(current, block)) {
        this.map.touchRoom(current, block, now);
        return { kind: 'stationary', pos: this.map.pos, moved: move };
      }
      // Look shows a different room?! Fall through to correlation.
    } else if (move?.kind === 'dir') {
      // Exits sanity: the room's own exits line is ground truth. A queued
      // move through a nonexistent exit is a silent failure (its "you
      // can't go that way" line was missed/mangled) — drop it instead of
      // spawning a phantom room. (A real desync case: a stray "d" at a
      // street corner created a duplicate street on a phantom floor.)
      if (
        current.exits.length > 0 &&
        !current.exits.includes(move.dir) &&
        current.links[move.dir] === undefined
      ) {
        this.queue.shift();
        if (this.map.matches(current, block)) {
          this.map.touchRoom(current, block, now);
          return { kind: 'stationary', pos: this.map.pos, moved: null };
        }
        // Block shows a different room — correlation decides below.
      } else {
        const linked = current.links[move.dir];
        if (linked !== undefined) {
          const dest = town.rooms.get(linked);
          if (dest && this.map.matches(dest, block)) {
            this.queue.shift();
            this.map.touchRoom(dest, block, now);
            this.map.pos = { townId: town.id, roomId: dest.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          this.linkMisses++;
          // Known link disagrees — correlation decides below.
        } else {
          // Frontier: an unmapped exit. Check the grid target first — walking
          // a loop back into mapped territory must reuse the existing room.
          const target = this.map.placementTarget(current, move.dir);
          const gridVec = TOWN_DIR_VEC[move.dir];
          const occupantId = town.grid.get(`${target.x},${target.y},${target.z}`);
          const occupant = occupantId !== undefined ? town.rooms.get(occupantId) : undefined;
          this.queue.shift();
          if (gridVec && occupant && this.map.matches(occupant, block)) {
            // Loop closed — link and move there
            this.map.link(town, current, move.dir, occupant);
            this.map.touchRoom(occupant, block, now);
            this.map.pos = { townId: town.id, roomId: occupant.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          // Loop closure across nudged terrain / diagonal shortcuts: reuse a
          // strictly-matching room near the target before creating. (Grid
          // occupancy alone breaks down after a nudge, and rooms would then
          // duplicate on every lap of a loop.)
          const near = this.map.findMatchesNear(
            town,
            block,
            target.x,
            target.y,
            target.z,
            NEAR_RADIUS,
            2
          );
          const reuse = near.length === 1 ? near[0] : null;
          if (reuse && reuse.id !== current.id) {
            this.map.link(town, current, move.dir, reuse);
            this.map.touchRoom(reuse, block, now);
            this.map.pos = { townId: town.id, roomId: reuse.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          const room = this.map.addRoom(town, block, target.x, target.y, target.z, now);
          this.map.link(town, current, move.dir, room);
          this.map.pos = { townId: town.id, roomId: room.id };
          return { kind: 'new-room', pos: this.map.pos, moved: move };
        }
      }
    } else if (move?.kind === 'named') {
      const linked = current.namedLinks[move.cmd];
      if (linked !== undefined) {
        const dest = town.rooms.get(linked);
        if (dest && this.map.matches(dest, block)) {
          this.queue.shift();
          this.map.touchRoom(dest, block, now);
          this.map.pos = { townId: town.id, roomId: dest.id };
          return { kind: 'expected', pos: this.map.pos, moved: move };
        }
        this.linkMisses++;
        // Known named link disagrees (boats move!) — correlation decides below.
      } else {
        this.queue.shift();
        // First use of this named exit: reuse a matching known room
        // (proximity first), else create — unless continuity is broken
        // (a boat/portal carried us away → this is a fresh town entry).
        const nearNamed = this.map.findMatchesNear(
          town,
          block,
          current.x,
          current.y,
          current.z,
          NEAR_RADIUS,
          2
        );
        const target =
          nearNamed.length === 1
            ? nearNamed[0]
            : (() => {
                const s = this.map.findMatches(town, block, 2);
                return s.length === 1 ? s[0] : null;
              })();
        if (target) {
          this.map.linkNamed(current, move.cmd, target);
          this.map.touchRoom(target, block, now);
          this.map.pos = { townId: town.id, roomId: target.id };
          return { kind: 'expected', pos: this.map.pos, moved: move };
        }
        if (gap > CONTINUITY_GAP_MS) {
          this.active = false;
          return this.enterTown(block, anchor, now);
        }
        const created = this.map.addRoom(town, block, current.x, current.y, current.z, now);
        this.map.linkNamed(current, move.cmd, created);
        this.map.pos = { townId: town.id, roomId: created.id };
        return { kind: 'new-room', pos: this.map.pos, moved: move };
      }
    }

    // --- Correlation fallback (no pending move, or prediction failed) ---
    // Identity first: unsolicited re-prints and stale queues are common.
    if (this.map.matches(current, block)) {
      // Consume a stale dir move whose prediction failed (silent failure)
      if (move && move.kind !== 'look') this.queue.shift();
      this.map.touchRoom(current, block, now);
      return { kind: 'stationary', pos: this.map.pos, moved: null };
    }

    // Any linked neighbor matching? (forced moves, desynced queue)
    const neighborIds = new Set<number>();
    for (const id of Object.values(current.links)) {
      if (id !== undefined) neighborIds.add(id);
    }
    for (const id of Object.values(current.namedLinks)) neighborIds.add(id);
    const matching: TownRoom[] = [];
    for (const id of neighborIds) {
      const r = town.rooms.get(id);
      if (r && this.map.matches(r, block)) matching.push(r);
    }
    if (matching.length === 1) {
      if (move) this.queue.shift(); // whatever was queued, this is what happened
      this.map.touchRoom(matching[0], block, now);
      this.map.pos = { townId: town.id, roomId: matching[0].id };
      return { kind: 'corrected', pos: this.map.pos, moved: null };
    }

    // A strict match near the current room? (hidden alias walked us a few
    // rooms; proximity disambiguates duplicate fingerprints like street
    // runs). With several candidates, a clearly-closest one still wins —
    // snapping near beats spawning yet another duplicate.
    const nearMatches = this.map.findMatchesNear(
      town,
      block,
      current.x,
      current.y,
      current.z,
      NEAR_RADIUS,
      8
    );
    let nearPick: TownRoom | null = nearMatches.length === 1 ? nearMatches[0] : null;
    if (!nearPick && nearMatches.length > 1) {
      const dist = (r: TownRoom) =>
        Math.max(Math.abs(r.x - current.x), Math.abs(r.y - current.y)) +
        Math.abs(r.z - current.z) * 2;
      nearMatches.sort((a, b) => dist(a) - dist(b));
      if (dist(nearMatches[0]) <= 2 && dist(nearMatches[0]) < dist(nearMatches[1])) {
        nearPick = nearMatches[0];
      }
    }
    if (nearPick) {
      if (move) this.queue.shift();
      this.map.touchRoom(nearPick, block, now);
      this.map.pos = { townId: town.id, roomId: nearPick.id };
      return { kind: 'relocalized', pos: this.map.pos, moved: null };
    }
    // ... or a unique strict match anywhere in town?
    const strict = this.map.findMatches(town, block, 2);
    if (strict.length === 1) {
      if (move) this.queue.shift();
      this.map.touchRoom(strict[0], block, now);
      this.map.pos = { townId: town.id, roomId: strict[0].id };
      return { kind: 'relocalized', pos: this.map.pos, moved: null };
    }

    // Continuity gap: an unexplainable room long after the last one means
    // the player TRAVELLED (boat, portal, long idle) — re-enter instead of
    // gluing a foreign room into this town.
    if (gap > CONTINUITY_GAP_MS) {
      this.active = false;
      return this.enterTown(block, anchor, now);
    }

    // Unknown room reached by an unseen move (user alias expanding to
    // movement, forced follow, etc). Create it as a FLOATING room near the
    // current one — no link (we don't know the direction), but the map
    // keeps growing and future sessions relocalize onto it.
    if (move) this.queue.shift();
    const floater = this.map.addRoom(town, block, current.x, current.y, current.z, now);
    this.map.pos = { townId: town.id, roomId: floater.id };
    return { kind: 'jumped', pos: this.map.pos, moved: null };
  }

  // -------------------------------------------------------------------------
  // Entry & relocalization
  // -------------------------------------------------------------------------

  private enterTown(block: TownRoomBlock, anchor: string | null, now: number): TownResolution {
    this.active = true;
    this.lost = false;
    this.queue = [];

    // 0. Resume: DartMUD logs you back in exactly where you logged out, so
    //    the persisted position matching the block means we're still there.
    //    (This is what stops every login from spawning a duplicate town.)
    const last = this.map.room(this.map.pos);
    if (last && this.map.pos && this.map.matches(last, block)) {
      this.map.touchRoom(last, block, now);
      return { kind: 'entered', pos: this.map.pos, moved: null };
    }

    // 1. Anchor memory: entering from a known hex lands in a known room.
    if (anchor) {
      const hit = this.map.findTownByAnchor(anchor);
      if (hit) {
        const room = hit.town.rooms.get(hit.roomId);
        if (room && this.map.matches(room, block)) {
          this.map.touchRoom(room, block, now);
          this.map.pos = { townId: hit.town.id, roomId: room.id };
          return { kind: 'entered', pos: this.map.pos, moved: null };
        }
        // Same hex, different doorway (gates vs buildings share a hex):
        // a strict match near the remembered room wins.
        if (room) {
          const near = this.map.findMatchesNear(hit.town, block, room.x, room.y, room.z, 4, 2);
          if (near.length === 1) {
            this.map.setAnchor(hit.town, anchor, near[0].id);
            this.map.touchRoom(near[0], block, now);
            this.map.pos = { townId: hit.town.id, roomId: near[0].id };
            return { kind: 'entered', pos: this.map.pos, moved: null };
          }
        }
      }
    }

    // 2. Entry-grade fingerprint (name + exits + description), unique
    //    across all towns — handles new entrances and lost anchors.
    const global = this.map.findEntryMatchGlobal(block);
    if (global) {
      if (anchor) this.map.setAnchor(global.town, anchor, global.room.id);
      this.map.touchRoom(global.room, block, now);
      this.map.pos = { townId: global.town.id, roomId: global.room.id };
      return { kind: 'entered', pos: this.map.pos, moved: null };
    }

    // 3. Unknown entrance — start a fresh town. If it is actually part of
    //    an existing town, the structural merge probe will fuse them once
    //    a couple of rooms are walked.
    const town = this.map.createTown(block.name);
    const room = this.map.addRoom(town, block, 0, 0, 0, now);
    town.entryRoomId = room.id;
    if (anchor) this.map.setAnchor(town, anchor, room.id);
    this.map.pos = { townId: town.id, roomId: room.id };
    return { kind: 'entered', pos: this.map.pos, moved: null };
  }

  private relocalize(
    block: TownRoomBlock,
    town: Town | null,
    anchor: string | null,
    now: number
  ): TownResolution {
    this.queue = [];
    if (town) {
      const matches = this.map.findMatches(town, block, 2);
      if (matches.length === 1) {
        this.lost = false;
        this.map.touchRoom(matches[0], block, now);
        this.map.pos = { townId: town.id, roomId: matches[0].id };
        return { kind: 'relocalized', pos: this.map.pos, moved: null };
      }
      this.lost = true;
      return { kind: 'lost', pos: null, moved: null };
    }
    // No town context at all — treat as an entry
    this.active = false;
    return this.enterTown(block, anchor, now);
  }

  private expireQueue(now: number): void {
    while (this.queue.length > 0 && now - this.queue[0].at > QUEUE_MAX_AGE) {
      this.queue.shift();
    }
  }
}
