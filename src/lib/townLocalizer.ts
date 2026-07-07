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

import {
  TOWN_DIR_ALIASES,
  TOWN_DIR_VEC,
  TOWN_REVERSE,
  type TownDir,
  type TownRoomBlock,
} from './townParser';
import { TownMapStore, descUsable, type Town, type TownRoom, type TownPos } from './townMap';

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
  /** Diagnostic: mispredicting links replaced by a confident destination */
  linkHeals = 0;
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
   * A portal transit line arrived ("You step into the north portal.").
   * Portals bridge distant towns — the NEXT room block must resolve as a
   * fresh town entry instead of being filed into the current town.
   * `dirWord` is the portal named by the transit line ("north"), which
   * identifies WHICH of a room's portals was taken (the hub chamber has
   * seven); departure room + dirWord keys the portal destination memory.
   */
  onPortalTransit(dirWord: string | null = null): void {
    // The room we're leaving through the portal is a portal room
    if (this.active) {
      const room = this.map.room(this.map.pos);
      if (room) room.portal = true;
    }
    this.pendingPortalFrom =
      this.active && this.map.pos && !this.lost
        ? { pos: this.map.pos, dir: dirWord?.toLowerCase() ?? null }
        : null;
    this.queue = [];
    this.portalJump = true;
  }

  private portalJump = false;
  private pendingPortalFrom: { pos: TownPos; dir: string | null } | null = null;

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
    this.portalJump = false;
    this.pendingPortalFrom = null;
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
    this.portalJump = false;
    this.pendingPortalFrom = null;
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

    // Portal transit ("You step into the north portal.") — we teleported.
    // The arrival room is a fresh entry into whatever town it belongs to:
    // no resume-in-place (identical Portal Chambers would false-match), no
    // link back, and no hex anchor (the hex position is stale indoors).
    if (this.portalJump) {
      this.portalJump = false;
      const from = this.pendingPortalFrom;
      this.pendingPortalFrom = null;
      // Destination memory first: this exact portal has been taken before,
      // so land where it landed then. Entry matching cannot do this — every
      // temple Forecourt is a same-fingerprint twin of the others, so the
      // global match is ambiguous and each trip used to spawn a fresh
      // fragment town that later merge-scarred the real one.
      if (from) {
        const dest = this.map.getPortalDest(from.pos, from.dir);
        if (dest) {
          const destRoom = this.map.get(dest.townId)?.rooms.get(dest.roomId);
          if (destRoom && this.map.matches(destRoom, block)) {
            this.active = true;
            this.lost = false;
            destRoom.portal = true;
            this.map.touchRoom(destRoom, block, now);
            this.map.pos = { townId: dest.townId, roomId: destRoom.id };
            return { kind: 'entered', pos: this.map.pos, moved: null };
          }
        }
      }
      this.active = false;
      const res = this.enterTown(block, null, now, false);
      const arrival = this.map.room(res.pos);
      if (arrival) arrival.portal = true; // ... and so is the arrival room
      // Learn (or relearn) where this portal leads for next time.
      if (from && res.pos) this.map.setPortalDest(from.pos, from.dir, res.pos);
      return res;
    }

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
        this.map.touchRoom(current, block, now, true);
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
        let missedLink = false;
        if (linked !== undefined) {
          const dest = town.rooms.get(linked);
          if (dest && this.map.matches(dest, block)) {
            this.queue.shift();
            this.map.touchRoom(dest, block, now, true);
            this.map.pos = { townId: town.id, roomId: dest.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          this.linkMisses++;
          missedLink = true;
          // Known link disagrees. Fall into the guarded reuse below — a
          // confident different destination RE-LINKS this exit (healing a
          // stale/wrong link that would misroute walks forever); if nothing
          // confident is found, correlation decides.
        }
        {
          // Frontier: an unmapped exit (or a mispredicting one — see
          // above). Check the grid target first — walking a loop back
          // into mapped territory must reuse the existing room.
          const target = this.map.placementTarget(current, move.dir);
          const gridVec = TOWN_DIR_VEC[move.dir];
          const occupantId = town.grid.get(`${target.x},${target.y},${target.z}`);
          const occupant = occupantId !== undefined ? town.rooms.get(occupantId) : undefined;
          // Reciprocity guards: only reuse a room as the destination of
          // `dir` if its reverse link agrees.
          //  - EXACT-CELL occupants (real loop closure) use the relaxed
          //    rule: reverse link unset, pointing at us, or pointing at a
          //    room with OUR fingerprint (we're standing on a duplicate of
          //    its true neighbor — reusing heals the dup).
          //  - NEAR-CELL candidates use the STRICT rule (unset or us).
          //    Mirror-symmetric buildings (the keep's twin bedroom wings:
          //    identical Vestibules, identical Bedchambers) defeat the
          //    relaxed rule at near range — the other wing's bedroom
          //    points back at a Vestibule that looks exactly like ours.
          const strictReciprocal = (r: TownRoom) => {
            const backId = r.links[TOWN_REVERSE[move.dir]];
            return backId === undefined || backId === current.id;
          };
          // Ground truth from the exits line: we cannot have arrived
          // going `dir` into a room whose own exits don't include the way
          // back. This is what separates two same-named streets whose
          // routes collide on one grid cell (Eris: e,e,e vs s,e,e,e,n end
          // on the same coordinate but in different rooms) — without it
          // they merge and grow exits that don't exist. A recorded link in
          // the return direction also counts: exit sets vary with world
          // state (portcullises, darkness) but a walked link is proof.
          const backDir = TOWN_REVERSE[move.dir];
          const hasReturnExit = (r: TownRoom) =>
            r.exitsEver.length === 0 ||
            r.exitsEver.includes(backDir) ||
            r.links[backDir] !== undefined ||
            r.namedExits.length > 0;
          // The duplicate-healing exception: the candidate's recorded
          // neighbor has OUR fingerprint, i.e. we may be standing on a
          // duplicate of it. Mirror TWINS (the keep's symmetric bedroom
          // wings) also look like that — but twins betray themselves by
          // attaching the SAME physical neighbor on DIFFERENT sides (the
          // north vestibule has the Landing to its south, the south one
          // to its north). A true duplicate's neighbors are duplicate ids,
          // never shared ones.
          const sharedNeighborConflict = (a: TownRoom, b: TownRoom) => {
            for (const [d1, n1] of Object.entries(a.links)) {
              for (const [d2, n2] of Object.entries(b.links)) {
                if (n1 === n2 && d1 !== d2) return true;
              }
            }
            return false;
          };
          const relaxedReciprocal = (r: TownRoom) => {
            if (strictReciprocal(r)) return true;
            const back = town.rooms.get(r.links[TOWN_REVERSE[move.dir]]!);
            return (
              !!back &&
              back.name === current.name &&
              back.exits.join(',') === current.exits.join(',') &&
              !sharedNeighborConflict(current, back)
            );
          };
          if (
            gridVec &&
            occupant &&
            occupant.id !== current.id &&
            // Name-lenient on purpose: rooms change their exit sets with
            // world state (the Gatehouse loses exits when the portcullis
            // drops) and exact-cell occupancy is already strong evidence.
            this.map.matches(occupant, block) &&
            hasReturnExit(occupant) &&
            relaxedReciprocal(occupant)
          ) {
            // Loop closed — (re)link and move there
            this.queue.shift();
            if (missedLink) this.linkHeals++;
            this.map.link(town, current, move.dir, occupant);
            this.map.touchRoom(occupant, block, now);
            this.map.pos = { townId: town.id, roomId: occupant.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          // Loop closure across nudged terrain / diagonal shortcuts: reuse a
          // strictly-matching room near the target before creating. (Grid
          // occupancy alone breaks down after a nudge, and rooms would then
          // duplicate on every lap of a loop.) A room current already links
          // to in a DIFFERENT direction can never be this move's
          // destination (the Landing knows the north wing's vestibule is
          // north — it cannot also be south), and vice versa.
          const alreadyNeighborElsewhere = (r: TownRoom) => {
            for (const [d, id] of Object.entries(current.links)) {
              if (id === r.id && d !== move.dir) return true;
            }
            for (const [d, id] of Object.entries(r.links)) {
              if (id === current.id && d !== TOWN_REVERSE[move.dir]) return true;
            }
            return false;
          };
          // Near-reuse covers DISPLACED candidates — for CARDINAL moves the
          // exact-cell occupant already got the strictest treatment above,
          // and must not be resurrected here without its return-exit proof.
          // For DIAGONAL moves no occupant judgement ran (diagonals are
          // placement hints, not grid constraints), so the hint-cell
          // occupant is a legitimate candidate here — excluding it meant a
          // diagonal leading back into mapped territory ALWAYS duplicated
          // its destination (Eris market plaza: se from the NW corner
          // re-enters the already-mapped center).
          const cands = this.map
            .findMatchesNear(town, block, target.x, target.y, target.z, NEAR_RADIUS, 4)
            .filter((r) => r.id !== current.id && (gridVec === undefined || r.id !== occupantId));
          const guarded = cands.filter((r) => relaxedReciprocal(r) && !alreadyNeighborElsewhere(r));
          let reuse: TownRoom | null = null;
          if (cands.length <= 1) {
            reuse = guarded.length === 1 ? guarded[0] : null;
          } else {
            // Uniform-fingerprint neighborhood (hall of mirrors): several
            // nearby rooms share the block's full fingerprint. Positive
            // identification wins outright: a reverse link pointing at us,
            // or unique description agreement (plaza twins differ mid-desc
            // even when name+exits are identical). Without it, fall back to
            // guard-elimination uniqueness (what stops street-run loops
            // duplicating rooms every lap) — UNLESS descriptions were
            // readable on both sides and the lone survivor's disagrees
            // with the block. An unset reverse link is no proof when the
            // true destination may simply be unmapped: trusting the lone
            // guard-survivor against a disagreeing desc is exactly how the
            // Eris market plaza snapped onto wrong twins and grew false
            // links. Ambiguous → create (duplicates heal; false links
            // cascade).
            const positive = guarded.filter((r) => r.links[backDir] === current.id);
            const byDesc = guarded.filter((r) => this.map.descAgrees(r, block));
            if (positive.length === 1) {
              reuse = positive[0];
            } else if (byDesc.length === 1) {
              reuse = byDesc[0];
            } else if (guarded.length === 1) {
              const veto =
                descUsable(block.desc) &&
                descUsable(guarded[0].desc) &&
                !this.map.descAgrees(guarded[0], block);
              if (!veto) reuse = guarded[0];
            }
          }
          if (reuse) {
            this.queue.shift();
            if (missedLink) this.linkHeals++;
            this.map.link(town, current, move.dir, reuse);
            this.map.touchRoom(reuse, block, now);
            this.map.pos = { townId: town.id, roomId: reuse.id };
            return { kind: 'expected', pos: this.map.pos, moved: move };
          }
          if (!missedLink) {
            this.queue.shift();
            const room = this.map.addRoom(town, block, target.x, target.y, target.z, now, move.dir);
            this.map.link(town, current, move.dir, room);
            this.map.pos = { townId: town.id, roomId: room.id };
            return { kind: 'new-room', pos: this.map.pos, moved: move };
          }
          // Mispredicting link with no confident replacement — leave the
          // queue intact and let correlation decide below.
        }
      }
    } else if (move?.kind === 'named') {
      const linked = current.namedLinks[move.cmd];
      if (linked !== undefined) {
        const dest = town.rooms.get(linked);
        if (dest && this.map.matches(dest, block)) {
          this.queue.shift();
          this.map.touchRoom(dest, block, now, true);
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
    // Hidden moves along twin-fingerprint streets can masquerade as
    // re-prints: the block matches current by name, but its DESCRIPTION
    // belongs to a linked neighbor. Desc disagreeing with current while
    // agreeing with exactly one strict-matching neighbor means we MOVED
    // (two adjacent "Garrison Road" segments: swallowing the second block
    // as stationary left the position one room behind, and the next link
    // heal then rewired a good link from the wrong room).
    if (
      this.map.matches(current, block) &&
      descUsable(block.desc) &&
      descUsable(current.desc) &&
      !this.map.descAgrees(current, block)
    ) {
      const stepped = this.neighborsOf(town, current).filter(
        (r) => this.map.matchesStrict(r, block) && this.map.descAgrees(r, block)
      );
      if (stepped.length === 1) {
        if (move) this.queue.shift();
        this.map.touchRoom(stepped[0], block, now);
        this.map.pos = { townId: town.id, roomId: stepped[0].id };
        return { kind: 'corrected', pos: this.map.pos, moved: null };
      }
      // No agreeing neighbor — a hidden hop can reach past them. A unique
      // strict + desc-agreeing room NEARBY is still positive identification
      // (in a clone plaza the twins tie on fingerprint but not on desc).
      if (stepped.length === 0) {
        const nearStrict = this.map
          .findMatchesNear(town, block, current.x, current.y, current.z, NEAR_RADIUS, 8)
          .filter((r) => r.id !== current.id);
        const nearDesc = nearStrict.filter((r) => this.map.descAgrees(r, block));
        if (nearDesc.length === 1) {
          if (move) this.queue.shift();
          this.map.touchRoom(nearDesc[0], block, now);
          this.map.pos = { townId: town.id, roomId: nearDesc[0].id };
          return { kind: 'relocalized', pos: this.map.pos, moved: null };
        }
        // Nothing desc-positive anywhere near. In a clone neighborhood
        // (same-fingerprint twins around, none agreeing) "probably still
        // here" is the documented disaster — plant an honest floater
        // instead of keeping a position the desc just contradicted. Only
        // when the block's EXITS disagree with current too: a re-print
        // whose desc merely embeds dynamic content keeps current's exits,
        // and must still fall through to the stationary swallow.
        if (
          nearDesc.length === 0 &&
          nearStrict.length > 0 &&
          !this.map.matchesStrict(current, block)
        ) {
          if (move) this.queue.shift();
          const floater = this.map.addRoom(town, block, current.x, current.y, current.z, now);
          this.map.pos = { townId: town.id, roomId: floater.id };
          return { kind: 'jumped', pos: this.map.pos, moved: null };
        }
      }
    }
    // Identity next: unsolicited re-prints and stale queues are common.
    if (this.map.matches(current, block)) {
      // Consume a stale dir move whose prediction failed (silent failure)
      if (move && move.kind !== 'look') this.queue.shift();
      this.map.touchRoom(current, block, now);
      return { kind: 'stationary', pos: this.map.pos, moved: null };
    }

    // Any linked neighbor matching? (forced moves, desynced queue)
    const matching = this.neighborsOf(town, current).filter((r) => this.map.matches(r, block));
    if (matching.length === 1) {
      if (move) this.queue.shift(); // whatever was queued, this is what happened
      this.map.touchRoom(matching[0], block, now);
      this.map.pos = { townId: town.id, roomId: matching[0].id };
      return { kind: 'corrected', pos: this.map.pos, moved: null };
    }
    if (matching.length > 1) {
      // Several neighbors share the block's name (clone plazas) — a unique
      // strict + description agreement still identifies the destination.
      const byDesc = matching.filter(
        (r) => this.map.matchesStrict(r, block) && this.map.descAgrees(r, block)
      );
      if (byDesc.length === 1) {
        if (move) this.queue.shift();
        this.map.touchRoom(byDesc[0], block, now);
        this.map.pos = { townId: town.id, roomId: byDesc[0].id };
        return { kind: 'corrected', pos: this.map.pos, moved: null };
      }
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
      // Description tiebreak first: same-fingerprint twins usually differ
      // mid-desc (Eris market plaza) — a unique desc agreement identifies
      // the room outright, regardless of which twin sits closer.
      const byDesc = nearMatches.filter((r) => this.map.descAgrees(r, block));
      if (byDesc.length === 1) nearPick = byDesc[0];
    }
    if (!nearPick && nearMatches.length > 1) {
      const dist = (r: TownRoom) =>
        Math.max(Math.abs(r.x - current.x), Math.abs(r.y - current.y)) +
        Math.abs(r.z - current.z) * 2;
      nearMatches.sort((a, b) => dist(a) - dist(b));
      // Closest-pick is a guess — acceptable when descriptions could not
      // decide, but when both the block's and the winner's descs are
      // readable and DISAGREE, the block itself is saying "not this one"
      // (an unmapped twin in a clone plaza) — snapping anyway is how
      // positions corrupted and false links cascaded in the market plaza.
      const winner = nearMatches[0];
      const veto =
        descUsable(block.desc) && descUsable(winner.desc) && !this.map.descAgrees(winner, block);
      if (!veto && dist(winner) <= 2 && dist(winner) < dist(nearMatches[1])) {
        nearPick = winner;
      }
    }
    if (nearPick) {
      if (move) this.queue.shift();
      this.map.touchRoom(nearPick, block, now);
      this.map.pos = { townId: town.id, roomId: nearPick.id };
      return { kind: 'relocalized', pos: this.map.pos, moved: null };
    }
    // ... or a unique strict match anywhere in town? (Desc agreement breaks
    // fingerprint ties here too — same rule as lost-relocalization.)
    const strict = this.map.findMatches(town, block, 8);
    let strictPick: TownRoom | null = strict.length === 1 ? strict[0] : null;
    if (!strictPick && strict.length > 1) {
      const byDesc = strict.filter((r) => this.map.descAgrees(r, block));
      if (byDesc.length === 1) strictPick = byDesc[0];
    }
    if (strictPick) {
      if (move) this.queue.shift();
      this.map.touchRoom(strictPick, block, now);
      this.map.pos = { townId: town.id, roomId: strictPick.id };
      return { kind: 'relocalized', pos: this.map.pos, moved: null };
    }

    // Generic teleport heuristic (recall spells, mage portals with unknown
    // messages): an unexplainable arrival — nothing pending, nothing
    // matching here — that uniquely entry-grade matches a room in ANOTHER
    // town means we were teleported there. Recall marks are places the
    // player knows well, so the destination is almost always mapped.
    if (!move) {
      const global = this.map.findEntryMatchGlobal(block);
      if (global && global.town.id !== town.id) {
        this.active = false;
        return this.enterTown(block, null, now, false);
      }
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

  private enterTown(
    block: TownRoomBlock,
    anchor: string | null,
    now: number,
    allowResume = true
  ): TownResolution {
    this.active = true;
    this.lost = false;
    this.queue = [];

    // 0. Resume: DartMUD logs you back in exactly where you logged out, so
    //    the persisted position matching the block means we're still there.
    //    (This is what stops every login from spawning a duplicate town.)
    //    Skipped after a portal transit — the departure and arrival rooms
    //    can be identical twins (Portal Chambers), and we KNOW we moved.
    if (allowResume) {
      const last = this.map.room(this.map.pos);
      if (last && this.map.pos && this.map.matches(last, block)) {
        this.map.touchRoom(last, block, now);
        return { kind: 'entered', pos: this.map.pos, moved: null };
      }
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

  /** Distinct rooms current links to (directional + named). */
  private neighborsOf(town: Town, current: TownRoom): TownRoom[] {
    const ids = new Set<number>();
    for (const id of Object.values(current.links)) {
      if (id !== undefined) ids.add(id);
    }
    for (const id of Object.values(current.namedLinks)) ids.add(id);
    const out: TownRoom[] = [];
    for (const id of ids) {
      const r = town.rooms.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  private relocalize(
    block: TownRoomBlock,
    town: Town | null,
    anchor: string | null,
    now: number
  ): TownResolution {
    this.queue = [];
    if (town) {
      const matches = this.map.findMatches(town, block, 8);
      let hit = matches.length === 1 ? matches[0] : null;
      if (!hit && matches.length > 1) {
        // Duplicate fingerprints town-wide — a unique description
        // agreement still identifies the room (recovers inside clone
        // plazas instead of staying lost).
        const byDesc = matches.filter((r) => this.map.descAgrees(r, block));
        if (byDesc.length === 1) hit = byDesc[0];
      }
      if (hit) {
        this.lost = false;
        this.map.touchRoom(hit, block, now);
        this.map.pos = { townId: town.id, roomId: hit.id };
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
