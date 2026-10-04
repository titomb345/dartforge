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
  LISTED_NAMED_EXITS,
  TOWN_DIR_ALIASES,
  TOWN_DIR_VEC,
  TOWN_REVERSE,
  type TownDir,
  type TownRoomBlock,
} from './townParser';
import {
  TownMapStore,
  descUsable,
  isPortalCommand,
  linkContradicted,
  type Town,
  type TownMergeResult,
  type TownRoom,
  type TownPos,
} from './townMap';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Pending moves older than this are dropped (ms) */
const QUEUE_MAX_AGE = 20_000;
/**
 * Max queued pending moves. When full, the NEWEST move is dropped: the
 * server still runs every command in order, so the head stays aligned and
 * only the dropped move's block falls back to correlation. Dropping the
 * OLDEST shifted every later block onto the wrong move (a lag spike:
 * session_2026-09-28T14-32-22-078.log:7175, fourteen moves typed into 4 s
 * of lag lost `w` and the portal command, so the transit kept nothing and
 * six blocks resolved by correlation). 30 holds any typed burst; the 20 s
 * expiry bounds staleness.
 */
const QUEUE_MAX_LEN = 30;
/**
 * Named moves sent within this window of each other came from ONE alias
 * expansion (the app awaits each send, a few ms apart; typing takes far
 * longer): Bill's "ep" = enter path + enter pool, "eg" = enter glade /
 * enter graveyard / enter grave — mutually exclusive tries, at most one of
 * which can be the move that printed the next block.
 */
const NAMED_BURST_MS = 50;
/** Max same-fingerprint candidates a first-use named exit judges between */
const NAMED_REUSE_MAX = 8;
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

type TownMoveKind =
  /** `verb`: the movement verb the direction was sent with ("lead e").
   *  `forced`: a group leader moved the player (onForcedMove) — nobody sent
   *  it. */
  | { kind: 'dir'; dir: TownDir; at: number; verb?: string; forced?: true }
  /** `verb`: a movement-mode verb put in front of the exit ("lead out") */
  | { kind: 'named'; cmd: string; at: number; verb?: string; forced?: true }
  | { kind: 'look'; at: number };

export type TownMove = TownMoveKind & {
  /** Doors closed right behind this move (see noteDoorClose): they run in
   *  the room it lands in, and are recorded shut there once it does */
  closeAfter?: TownDir[];
};

type NamedMove = Extract<TownMove, { kind: 'named' }>;

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
  /** Rooms fused during this resolution (structural merge probe): the
   *  moved component's town and the town it joined (equal for a duplicate
   *  component inside one town) */
  merged?: { from: number; into: number } & TownMergeResult;
}

/**
 * What an "It is pitch black." line did (see onDarkArrival) — the live walk
 * executor gets no room block for a dark step, so this is its only word on
 * whether the step landed where the route said:
 *  - 'transit':  the dark arrival of a portal/teleport transit (no move spent)
 *  - 'none':     outdoors, or nothing queued — no move of the player's spent
 *  - 'look':     a queued look was answered with darkness; nobody moved
 *  - 'advanced': a move spent along a walked link; map.pos is its room
 *  - 'unknown':  a move spent with no walked link (an unmapped dark room), or
 *                while the position was already unknown
 */
export type DarkArrival = 'transit' | 'none' | 'look' | 'advanced' | 'unknown';

/**
 * Commands that lead through non-directional exits. "in" is an exit word
 * (643 corpus exits lines list it; movementMode.ts prefixes it like a
 * direction). "leave" is NOT a move: it is DartMUD's party command ("You
 * leave the party." x213 in the MUSH corpus) — queued as one, a typo'd
 * "leave aprty" claimed the next real move's block as a named exit.
 */
const NAMED_MOVE_WORDS = new Set(['enter', 'board', 'exit', 'out', 'back', 'disembark', 'in']);
/**
 * Verbs that move the player in the direction that follows. App.tsx applies
 * the movement mode AFTER logging and BEFORE tracking, so in Leading mode
 * every bare direction (and bare named exit) reaches the tracker as
 * "lead n" / "lead out" — the town engine used to drop all of them (18
 * indoor moves in session_2026-09-17T02-43-52-553.log). "leap east" is the
 * Sepulcher chasm crossing, "swim n" the Blue Pearl pool. NOT "row": rowing
 * moves the BOAT across hexes (each stroke prints a wilderness survey and
 * then the boat's own room) — the hex localizer tracks "row <dir>".
 */
const DIR_MOVE_VERBS = new Set(['go', 'sneak', 'climb', 'lead', 'swim', 'leap']);

/**
 * Commands the app sends on its own that never draw "What ?" (App.tsx
 * LOGIN_COMMANDS; the alignment / who / held-equipment timers of
 * useTimerEngines.ts resend three of them). They pass through trackCommand
 * like every send but are never logged, so counting them as possible
 * "What ?" sources (see onUnknownCommand) would make the live app absorb a
 * dead named move's reply that the replay pops: the 07-16 `port` that
 * corrupted Bill's market plaza came right after an alignment / who / equip
 * sync. Keep in step with LOGIN_COMMANDS — though a sync missing here only
 * costs pops (its reply is waited for in vain), never a wrong one.
 */
const APP_SYNC_COMMANDS: ReadonlySet<string> = new Set([
  'hp',
  'score',
  'show combat allocation:all',
  'show magic allocation',
  'show alignment',
  'who',
  'equip held',
]);

/**
 * Classify an outgoing command as a town move (or not). DartMUD commands
 * are case-sensitive: all 7 upper-case commands in the corpus ("W", "S",
 * "U", "L", "OUT") were answered "What ?" — lower-casing queued them as
 * moves, and the dead "OUT" / "U" filed the Bone Pit one floor up. So the
 * command is only whitespace-normalized, and a capitalized verb is no move.
 */
export function classifyTownCommand(command: string, now: number): TownMove | null {
  const cmd = command.trim().replace(/\s+/g, ' ');
  if (!cmd) return null;
  if (cmd === 'l' || cmd === 'look' || cmd === 'lo') return { kind: 'look', at: now };
  const dir = TOWN_DIR_ALIASES[cmd];
  if (dir) return { kind: 'dir', dir, at: now };
  const space = cmd.indexOf(' ');
  const first = space > 0 ? cmd.slice(0, space) : cmd;
  if (space > 0 && DIR_MOVE_VERBS.has(first)) {
    const rest = cmd.slice(space + 1);
    const d = TOWN_DIR_ALIASES[rest];
    if (d) return { kind: 'dir', dir: d, at: now, verb: first };
    // "climb branch": climbing an object is an exit of its own (Shady
    // Islet -> Terrace), recorded with its verb
    if (first === 'climb') return { kind: 'named', cmd, at: now };
    // A movement verb on a named exit ("lead out") walks that exit; it is
    // recorded bare, the way a walk sends it (the mode prefixes it again)
    if (NAMED_MOVE_WORDS.has(rest.split(' ')[0])) {
      return { kind: 'named', cmd: rest, at: now, verb: first };
    }
  }
  if (NAMED_MOVE_WORDS.has(first)) return { kind: 'named', cmd, at: now };
  return null;
}

/** The verb a "<Verb> what?" reply to this move would name (a forced move
 *  was never sent: no reply names it) */
function replyVerb(m: TownMove): string | undefined {
  if (m.kind === 'look' || m.forced) return undefined;
  if (m.verb) return m.verb;
  return m.kind === 'named' ? m.cmd.split(' ')[0] : undefined;
}

/**
 * Can this move be answered "What ?"? A bare direction always parses
 * indoors ("There is no exit in that direction." is its failure); a named
 * move whose exit or object isn't here does not ("enter portal", "out"),
 * nor does a movement verb the server rejects ("lead e" with nobody to
 * lead: session_2026-09-17T02-43-52-553.log:26292). A forced move is the
 * server's own doing: never answered.
 */
function canDrawWhat(m: TownMove): boolean {
  if (m.kind === 'look' || m.forced) return false;
  return m.kind === 'named' || m.verb !== undefined;
}

/**
 * Commands that set off a messaged teleport (TELEPORT_TRANSIT_RE): the OOC
 * realm's "plane shift" — no move, so the localizer notes where it was sent
 * among the moves — and the temple pools' "enter pool", a named move like
 * any other ("enter pool" is also the Blue Pearl Inn's swimming pool, a
 * plain exit: only the transit line makes it a teleport).
 */
const PLANE_SHIFT = 'plane shift';
function isTeleportCommand(cmd: string): boolean {
  return cmd === PLANE_SHIFT || cmd === 'enter pool';
}

/** "close e door", "close u trapdoor", "close trapdoor", "close s" — see
 *  noteDoorClose */
const DOOR_CLOSE_RE = /^close (?:([a-z]+) )?([a-z]+)$/;

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

  /**
   * Reply bookkeeping (see onUnknownCommand): `sends` counts the non-move
   * commands sent while indoors (app syncs excluded), `answered` how many of
   * them are known to have been answered; each queued move remembers how
   * many non-move sends preceded it.
   */
  private sends = 0;
  private answered = 0;
  private sendsBefore = new WeakMap<TownMove, number>();
  /** Moves queued when a "What ?" the head could have drawn was credited to
   *  an earlier command instead — their replies may be one off (see the
   *  named branch) */
  private doubtful = new WeakSet<TownMove>();
  /** The non-move send count at the latest "plane shift" (see onTeleport) */
  private teleportSend: number | null = null;
  /**
   * A messaged teleport is under way (onTeleport): the next room block is
   * its arrival. `from`: the room it left, when known — remembered as the
   * way back (TownMapStore.teleportReturn) once the arrival resolves.
   */
  private pendingTeleport: { from: TownPos | null } | null = null;
  /**
   * The player stepped into an unmapped room in the dark (onDarkArrival):
   * map.pos is the room they left, no longer where they stand. One-shot —
   * the next block resolves by correlation alone.
   */
  private darkUnanchored = false;
  /**
   * ... and they got there by a transit (a portal or teleport whose arrival
   * room was unlit — see onDarkArrival): somewhere the departure's town says
   * nothing about, so the next block is a fresh entry. Set only with
   * darkUnanchored, and cleared with it.
   */
  private darkTransit = false;
  /**
   * No wilderness survey since the last login: the hex position the owner
   * passes as the anchor is the hex localizer's position from its LAST
   * survey, which after a login can belong to another session altogether
   * (the player traveled with another client, or logged out in a town the
   * portal network delivered them to). 8 of the 17 hex-anchor collisions the
   * corpus replay learned were seeded that way — Tobermore's Servants
   * Quarters learned for the Eris hex 0:7,5 at a login
   * (session_2026-07-31T06-20-22-318.log:9), the Eris Assembly Hall for the
   * Cove hex 0:-9,25 (07-04T13-54-29-349.log:12) — so until a survey places
   * the player again, town entries neither use nor learn anchors.
   */
  private anchorStale = false;

  constructor(private map: TownMapStore) {}

  get pendingMoves(): readonly TownMove[] {
    return this.queue;
  }

  /** Where the player stands, when the localizer knows: inside a town, not
   *  lost, not in an unmapped dark room */
  private where(): TownPos | null {
    return this.active && !this.lost && !this.darkUnanchored ? this.map.pos : null;
  }

  /**
   * What trackCommand would queue for this command right now — a move, a
   * look, or nothing — without queueing it: the live walk executor tells
   * the player's own moves from its steps by it. Exit words count only
   * where the map has them (see exitWordMove), as when tracked.
   */
  classifyCommand(command: string, now: number): TownMove | null {
    if (!this.active) return null;
    return classifyTownCommand(command, now) ?? this.exitWordMove(command, now);
  }

  /** Track an outgoing command. Only queues while indoors. */
  trackCommand(command: string, now: number): boolean {
    if (!this.active) return false;
    const move = this.classifyCommand(command, now);
    if (!move) {
      // A bare Enter reaches here as '' (the input's raw-send fallback) and
      // draws no reply at all — counting it would leave a reply owed forever
      const cmd = command.trim();
      if (cmd && !APP_SYNC_COMMANDS.has(cmd)) this.sends++;
      const norm = cmd.replace(/\s+/g, ' ');
      if (norm === PLANE_SHIFT) this.teleportSend = this.sends;
      this.noteDoorClose(norm);
      return false;
    }
    if (this.queue.length >= QUEUE_MAX_LEN) return true; // full: drop the newest (see QUEUE_MAX_LEN)
    this.sendsBefore.set(move, this.sends);
    this.queue.push(move);
    return true;
  }

  /**
   * Door state after a crossing. A door crossing (the /door built-in, a
   * walk's door step) fires unlock / open / MOVE / close / lock blind, so
   * the arrival block prints BEFORE the close runs and lists the door just
   * crossed as open — and touchRoom recorded it so: of 1,440 corpus door
   * opens sent after an exits line, 112 found the door the line called open
   * closed, 104 of them the door the player had just come through and
   * closed (none the other way round). A walk leaving by that door sent a
   * bare move into it ("The gate is closed." — walk stopped at step one;
   * session_2026-07-04T20-38-50-676.log:1317-1344). Commands run in order,
   * so a close sent while moves are queued runs in the room the LAST of
   * them lands in: it rides on that move (closeAfter) and the door is
   * recorded shut — both sides — once the move lands (the /door sequence's
   * "close <reverse> door" is the door just crossed). With nothing queued it
   * is the current room's door, shut now. A close without a direction
   * ("close trapdoor": 5 DF sends, all with nothing queued) names the
   * room's one door with that noun. Only closes are trusted (see
   * TownMapStore.markDoorClosed).
   */
  private noteDoorClose(cmd: string): void {
    const m = DOOR_CLOSE_RE.exec(cmd);
    if (!m) return;
    const [, first, last] = m;
    const dir: TownDir | undefined = TOWN_DIR_ALIASES[first ?? last];
    if (dir) {
      const queued = this.queue[this.queue.length - 1];
      if (queued) {
        (queued.closeAfter ??= []).push(dir);
        return;
      }
      const pos = this.where();
      if (pos) this.map.markDoorClosed(pos, dir);
      return;
    }
    const pos = this.queue.length === 0 ? this.where() : null;
    const room = this.map.room(pos);
    if (!pos || !room?.doorNouns) return;
    const doors = (Object.entries(room.doorNouns) as [TownDir, string][]).filter(
      ([, noun]) => noun === last
    );
    if (doors.length === 1) this.map.markDoorClosed(pos, doors[0][0]);
  }

  /**
   * A bare exit word ("hole", "path", "mudschool", "backroom") moves the
   * player where the room's exits line lists it — and is no move anywhere
   * else, so only the map can classify it. It counts as a move when a room
   * the command may run in offers the word: the current room, or ANY room
   * the moves still queued lead to over known links. Which one it runs in
   * depends on which queued moves succeed (a walk pipelines its next step
   * before the previous one is confirmed, Bill types ahead, and a queued
   * move may yet fail and leave the player where they are), so every room
   * on that path counts. A room offers the words its latest exits line
   * lists and the ones it has been walked through: some exits come and go
   * with the room's state (Syphe's Gem Shop lists "hole" only after "move
   * mat", and not when you come back up through it —
   * session_2026-07-25T20-28-24-529.log:2138-2149 /
   * session_2026-07-05T15-39-35-835.log:3187-3191), and findPath routes a
   * walk through the walked link either way. A movement verb may lead the
   * word ("lead path"), as on "out". Tracking a word that then fails costs
   * nothing — DartMUD answers "What ?" and onUnknownCommand pops it — while
   * an untracked move leaves its room block unexplained: "hole" out of the
   * Gem Shop made Main Entrance a "jumped" floater with no route from the
   * shop down the hole, and the way back up was a relocalization
   * (session_2026-07-05T15-39-35-835.log:2954-3191). A word no room on the
   * path offers is left alone.
   */
  private exitWordMove(command: string, now: number): TownMove | null {
    const pos = this.where();
    const town = pos ? this.map.get(pos.townId) : undefined;
    const here = pos ? town?.rooms.get(pos.roomId) : undefined;
    if (!town || !here) return null;
    const cmd = command.trim().replace(/\s+/g, ' ');
    const space = cmd.indexOf(' ');
    const verb = space > 0 && DIR_MOVE_VERBS.has(cmd.slice(0, space)) ? cmd.slice(0, space) : null;
    const word = verb ? cmd.slice(space + 1) : cmd;
    if (!/^[a-z]+$/.test(word)) return null;
    const offers = (r: TownRoom) =>
      r.namedExits.includes(word) || typeof r.namedLinks[word] === 'number';
    let room: TownRoom = here;
    for (let i = 0; !offers(room); i++) {
      const m = this.queue[i];
      if (!m) return null;
      if (m.kind === 'look') continue;
      const next: number | undefined =
        m.kind === 'dir' ? room.links[m.dir] : room.namedLinks[m.cmd];
      const nextRoom = next !== undefined ? town.rooms.get(next) : undefined;
      if (!nextRoom) return null;
      room = nextRoom;
    }
    return verb
      ? { kind: 'named', cmd: word, at: now, verb }
      : { kind: 'named', cmd: word, at: now };
  }

  /** A movement failure arrived — the oldest pending move never happened. */
  onMoveFailed(): void {
    this.shiftMove();
  }

  /**
   * A group leader moved the player (TOWN_FORCED_MOVE_RE: "Esira leads you
   * up.", "Arthur leads you enter clearing."); `text` is the move as a
   * command ("up", "enter clearing", "path"). The arrival block comes next,
   * ahead of anything the player has queued, so the move goes to the FRONT
   * of the queue and the block resolves — and links — like a typed move.
   * Unrecognized, every led step was a block nothing explained: the 18 led
   * town moves of the DF corpus only resolved because their rooms were
   * already linked (session_2026-09-17T02-43-52-553.log:12325 "Esira leads
   * you up." -> Landing, "corrected" with an empty queue); into an unmapped
   * room it made a floater with no link, and with moves of the player's own
   * queued, the led room was filed under the player's move. The forced
   * move draws no reply of its own (see canDrawWhat). Returns true when
   * queued.
   */
  onForcedMove(text: string, now: number): boolean {
    if (!this.active) return false;
    const cmd = text.trim().replace(/\s+/g, ' ');
    // A bare word the leader walked is an exit word ("path", "beach") —
    // proven by the move itself, so no room has to list it first
    const move: TownMove | null =
      classifyTownCommand(cmd, now) ??
      (/^[a-z]+$/.test(cmd) ? { kind: 'named', cmd, at: now } : null);
    if (!move || move.kind === 'look') return false;
    move.forced = true;
    this.queue.unshift(move);
    if (this.queue.length > QUEUE_MAX_LEN) this.queue.pop(); // drop the newest (see QUEUE_MAX_LEN)
    return true;
  }

  /**
   * An unlit room: "It is pitch black." printed INSTEAD of the room block
   * (TOWN_DARK_RE). The head move happened — it just shows nothing — so it
   * is consumed here: a look stays put, a move along a walked link advances
   * blindly to that room. Unconsumed, it claimed the next lit block and every
   * later block lined up one move late (Soriktos at night,
   * session_2026-08-17T16-59-49-147.log:1654-1808: three relocalizations,
   * seven stale moves queued at the citadel gates, and the Parade Ground
   * filed one room behind).
   *
   * A step with no walked link enters a room no block will ever describe,
   * and the localizer no longer knows where the player stands. Going "lost"
   * there stalled mapping for good (relocalization only ever recognizes
   * mapped rooms, so a walk on into unmapped streets — or out of town into a
   * dark wilderness, which prints no survey — stayed lost room after room).
   * Instead the next block resolves once, by correlation alone (see
   * resolveBlock): a known room is recognized, an unknown one becomes an
   * honest floater, a room in another town takes the entry path.
   *
   * Right after a transit line (portal, teleport) the dark line is the
   * transit's own arrival: the command that moved the player was consumed
   * by the transit line, so no queued move is spent. The arrival room is
   * unknown and so is the town — the next lit block enters fresh, and
   * nothing is learned about the transit. Read as an ordinary dark step,
   * the line spent a typed-ahead move, the dark steps after it
   * blind-advanced along the DEPARTURE room's walked links, and the lit
   * block, still taken for the transit's arrival, was marked a portal room
   * and learned as the portal's destination, overwriting the real one
   * (dm-2025-12-26.txt:13748, the hub's north portal at night: ten
   * pitch-black steps to a lit Gatehouse; the next daylight trip would have
   * missed the remembered Forecourt and entered a fragment among its twins).
   * The way back of a teleport is still its departure (teleportReturn).
   *
   * Returns what the line did (see DarkArrival) — the replay ignores it; the
   * live walk executor confirms or abandons the walk's dark step by it.
   */
  onDarkArrival(now: number): DarkArrival {
    if (this.portalJump || this.pendingTeleport) {
      if (this.pendingTeleport) this.map.teleportReturn = this.pendingTeleport.from;
      this.portalJump = false;
      this.pendingPortalFrom = null;
      this.pendingTeleport = null;
      this.darkUnanchored = true;
      this.darkTransit = true;
      return 'transit';
    }
    if (!this.active) return 'none';
    this.expireQueue(now);
    // (The continuity gap keeps running: unlit steps can be travel no survey
    // reports, like a boat ride — out of a gate into a dark wilderness)
    const move = this.shiftMove();
    if (!move) return 'none';
    if (move.kind === 'look') return 'look';
    const pos = this.where();
    const town = pos ? this.map.get(pos.townId) : undefined;
    const current = pos ? town?.rooms.get(pos.roomId) : undefined;
    if (!town || !current) return 'unknown'; // lost / already unanchored: stays so
    const linked = move.kind === 'dir' ? current.links[move.dir] : current.namedLinks[move.cmd];
    if (linked !== undefined && town.rooms.has(linked)) {
      this.map.pos = { townId: town.id, roomId: linked };
      return 'advanced';
    }
    this.darkUnanchored = true;
    return 'unknown';
  }

  /**
   * A messaged teleport (TELEPORT_TRANSIT_RE: plane shift, temple pool) —
   * like a portal transit, the next room block is the arrival, somewhere
   * the current room says nothing about. Unlike portals there is no portal
   * room to mark and no destination memory per room: these teleports are
   * two-way, so the arrival lands on the room the previous teleport left
   * when it matches (TownMapStore.teleportReturn), and otherwise is a fresh
   * town entry. Moves typed after the teleport command run at the
   * destination and stay queued (session_2026-08-28T16-24-18-048.log:9175:
   * "plane shift", then "s" before the transit line — the s walks from the
   * Eris OOC Entrance to the Post Office): every move sent before the
   * command has been answered by the time this line arrives, and the
   * command itself is the last queued "enter pool", or the last "plane
   * shift" sent (no move, so its place among the moves was noted). With
   * neither, nothing queued is attributable.
   */
  onTeleport(): void {
    this.pendingTeleport = { from: this.where() };
    this.portalJump = false; // the newest transit line wins
    this.pendingPortalFrom = null;
    let cut = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const m = this.queue[i];
      if (m.kind === 'named' && isTeleportCommand(m.cmd)) cut = i;
    }
    const sent = this.teleportSend;
    this.teleportSend = null;
    if (cut < 0 && sent !== null) {
      // The shift is non-move send number `sent`: queued moves sent before
      // it (fewer non-move sends ahead of them) were answered already
      while (
        cut + 1 < this.queue.length &&
        (this.sendsBefore.get(this.queue[cut + 1]) ?? 0) < sent
      ) {
        cut++;
      }
      if (sent > this.answered) this.answered = sent; // the transit is its reply
    }
    if (cut >= 0) this.consumeMoves(cut + 1);
    else if (sent === null) this.queue = [];
  }

  /**
   * DartMUD answered a command with "What ?" or "<Verb> what?"
   * (UNKNOWN_COMMAND_RE; `verb` is the captured verb, null for "What ?").
   * Replies arrive in command order, so the reply belongs to the OLDEST
   * command still unanswered — which may be an ordinary command: typos and
   * misfired object commands draw the same reply ("activate portal" before
   * the `port` alias's "enter portal"; a failing "spp" before a dead "out").
   *  - "<Verb> what?" names its command: the oldest queued move sent with
   *    that verb failed ("Enter what?"). No such move → an ordinary command.
   *  - "What ?" fails the queue head only when it can draw one (a named or
   *    verb-prefixed move) and every non-move command sent before it is
   *    accounted for; otherwise the reply is credited to the oldest of those
   *    ("activate portal" → "What ?", "enter portal" → "What ?": the first
   *    reply is activate's, the second pops the portal command).
   * Errs toward NOT popping: a dead move left queued is caught by the queue
   * repair when the next block arrives, while popping a move that worked
   * leaves its block unexplained. Returns true when a queued move was failed.
   */
  onUnknownCommand(verb: string | null = null): boolean {
    if (!this.active) return false;
    if (verb) {
      const v = verb.toLowerCase();
      const i = this.queue.findIndex((m) => replyVerb(m) === v);
      if (i >= 0) {
        this.noteAnswered(this.queue.splice(i, 1)[0]);
        return true;
      }
      this.creditReply();
      return false;
    }
    const head = this.queue[0];
    if (head && canDrawWhat(head) && (this.sendsBefore.get(head) ?? 0) <= this.answered) {
      this.shiftMove();
      return true;
    }
    // Credited to an ordinary command while the head could have drawn it:
    // if that guess is wrong, every later reply is attributed one command
    // early — the head may be dead and the tries queued with it (one alias,
    // "eg" = enter glade / graveyard / grave) can no longer be told apart
    if (head && canDrawWhat(head)) for (const m of this.queue) this.doubtful.add(m);
    this.creditReply();
    return false;
  }

  /** A reply went to one of the non-move commands still awaiting theirs */
  private creditReply(): void {
    if (this.answered < this.sends) this.answered++;
  }

  /** Every command sent before an answered move has been answered too */
  private noteAnswered(m: TownMove): void {
    const before = this.sendsBefore.get(m) ?? 0;
    if (before > this.answered) this.answered = before;
  }

  /** Remove the queue head as answered (consumed, failed or dead) */
  private shiftMove(): TownMove | undefined {
    const m = this.queue.shift();
    if (m) this.noteAnswered(m);
    return m;
  }

  /** Remove the first `n` queued moves as answered */
  private consumeMoves(n: number): void {
    for (let i = 0; i < n; i++) this.shiftMove();
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
    const from = this.where();
    const room = this.map.room(from);
    if (room) room.portal = true;
    this.pendingPortalFrom = from ? { pos: from, dir: dirWord?.toLowerCase() ?? null } : null;
    this.pendingTeleport = null; // the newest transit line wins
    // Type-ahead survives the transit: when this line arrives every command
    // sent before the portal command has been answered, so moves queued
    // AFTER it run in the destination ("port n", then "w" typed before "You
    // step into the north portal." — 78 of 484 corpus transits). Clearing
    // them filed the next blocks one move behind, onto same-named market
    // twins. The LAST queued portal command is the one that fired: an
    // earlier one failed ("Which one, the southeast portal, ...?" for a bare
    // `port` in the seven-portal hub, then "port n"). With none queued,
    // nothing is attributable.
    let cut = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const m = this.queue[i];
      if (m.kind === 'named' && isPortalCommand(m.cmd)) cut = i;
    }
    if (cut >= 0) this.consumeMoves(cut + 1);
    else this.queue = [];
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
    // (Not from an unmapped dark room: the town exit it would anchor is a
    // room the player has left behind — see onDarkArrival)
    if (this.active && this.map.pos && !this.darkUnanchored) this.pendingExit = this.map.pos;
    this.active = false;
    this.lost = false;
    this.queue = [];
    // Replies still owed to indoor commands arrive while inactive (ignored):
    // the next town visit starts with nothing owed. Kept, the backlog of
    // commands sent after the last consumed move credited the next visit's
    // first "What ?" replies to them instead of failing dead named moves.
    this.answered = this.sends;
    this.clearTransits();
    // A survey places the player again: hex anchors are current from here on
    this.anchorStale = false;
  }

  /** Forget every transient between a line and the block it announces */
  private clearTransits(): void {
    this.portalJump = false;
    this.pendingPortalFrom = null;
    this.pendingTeleport = null;
    this.teleportSend = null;
    this.darkUnanchored = false;
    this.darkTransit = false;
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
    this.sends = 0;
    this.answered = 0;
    this.pendingExit = null;
    this.clearTransits();
  }

  /**
   * A login line arrived ("Running under version ..." / "You are already
   * playing, reconnecting to old object" — what useMudConnection fires
   * onCharacterName on). Call it at that line, before the login burst, on
   * the localizer that will resolve the burst: after a character switch,
   * the NEW character's (a fresh localizer trusts anchors). The server
   * session starts over: whatever was queued, owed a reply or announced by
   * a transit line is void, and the first room block is an entry — the
   * resume path matches it against the persisted position (DartMUD logs you
   * in where you logged out). Left active, a re-login's first block was
   * resolved against the previous session's queue and position. Until a
   * survey places the player, the hex position is no anchor (see
   * anchorStale). The teleport return memory is map data and survives.
   */
  onLogin(): void {
    this.reset();
    this.anchorStale = true;
  }

  /**
   * Resolve a town room block. `anchor` is the hex the player is parked on
   * ("island:q,r"), used to pick/create the town when entering.
   */
  onRoomBlock(block: TownRoomBlock, anchor: string | null, now: number): TownResolution {
    const prev = this.where();
    const res = this.resolveBlock(block, this.anchorStale ? null : anchor, now);
    // Doors closed behind this move (see noteDoorClose): this block printed
    // them before the close ran
    if (res.pos && res.kind !== 'lost' && res.moved?.closeAfter) {
      for (const d of res.moved.closeAfter) this.map.markDoorClosed(res.pos, d);
    }
    if (res.pos && res.kind !== 'lost') {
      // Probe the room just LEFT as well: walking straight through unmapped
      // rooms, the current room only ever holds its one back-link (the probe
      // needs two), while the room behind it has just gained its second. A
      // login on a twin Bedchamber (ambiguous entry → fragment town) walked
      // the whole keep-to-market route, 19 rooms over 13 hours of play,
      // before a revisit fused it; probing the previous room fuses it on
      // the second or third step.
      const left =
        prev && prev.townId === res.pos.townId && prev.roomId !== res.pos.roomId ? prev : null;
      const merged = this.tryMergeProbe() ?? (left ? this.tryMergeProbe(left) : undefined);
      if (merged) {
        res.merged = merged;
        res.pos = this.map.pos;
      }
    }
    return res;
  }

  /**
   * While fragments exist (same physical town entered from hexes that
   * weren't yet anchored, or a duplicate component grown from a floater),
   * probe whether the room at `probe` (default: the current position) + its
   * linked neighborhood uniquely matches a room elsewhere — if so the pieces
   * physically overlap and are fused (the hex engine's island merge, ported
   * to room graphs). The smaller link COMPONENT moves (ties leave the older
   * one in place): comparing whole towns moved all of Soriktos (184 rooms)
   * into Eris (187) in the shared-store replay, because a 19-room Eris
   * floater component inside it matched. A refused merge is no merge.
   */
  private tryMergeProbe(
    probe: TownPos | null = this.map.pos
  ): ({ from: number; into: number } & TownMergeResult) | undefined {
    if (!probe) return undefined;
    const town = this.map.get(probe.townId);
    const room = town?.rooms.get(probe.roomId);
    if (!town || !room) return undefined;
    const cand = this.map.findMergeCandidate(town, room, 2);
    if (!cand) return undefined;
    const own = this.map.componentOf(town, room.id);
    const other = this.map.componentOf(cand.town, cand.room.id);
    const ownMoves =
      own.size !== other.size
        ? own.size < other.size
        : cand.town === town
          ? Math.min(...own) > Math.min(...other)
          : town.id > cand.town.id;
    const [from, fromRoom, into, intoRoom] = ownMoves
      ? [town, room, cand.town, cand.room]
      : [cand.town, cand.room, town, room];
    const result = this.map.mergeTowns(from, fromRoom.id, into, intoRoom.id);
    return result ? { from: from.id, into: into.id, ...result } : undefined;
  }

  private resolveBlock(block: TownRoomBlock, anchor: string | null, now: number): TownResolution {
    this.expireQueue(now);
    const gap = now - this.lastBlockAt;
    this.lastBlockAt = now;
    const unanchored = this.darkUnanchored; // one-shot (see onDarkArrival)
    const darkTransit = this.darkTransit;
    this.darkUnanchored = false;
    this.darkTransit = false;

    // Messaged teleport (plane shift, temple pool): land on the room the
    // previous teleport left when the arrival matches it — the way back —
    // else enter fresh (no resume: the arrival is elsewhere by definition;
    // no anchor: the hex position says nothing about it). No portal flags
    // and no per-room destination memory: see onTeleport. Either way this
    // teleport's departure becomes the remembered way back.
    if (this.pendingTeleport) {
      const { from } = this.pendingTeleport;
      this.pendingTeleport = null;
      const back = this.map.teleportReturn;
      const backRoom = this.map.room(back);
      let res: TownResolution;
      if (back && backRoom && this.map.matches(backRoom, block)) {
        this.active = true;
        this.lost = false;
        this.map.touchRoom(backRoom, block, now);
        this.map.pos = { townId: back.townId, roomId: back.roomId };
        res = { kind: 'entered', pos: this.map.pos, moved: null };
      } else {
        this.active = false;
        // enterTown starts an entry with an empty queue; the type-ahead
        // onTeleport kept runs in this room and must survive it
        const typeAhead = this.queue;
        res = this.enterTown(block, null, now, false);
        this.queue = typeAhead;
      }
      this.map.teleportReturn = from;
      return res;
    }

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
      // enterTown starts an entry with an empty queue; the type-ahead
      // onPortalTransit kept runs in this room and must survive it
      const typeAhead = this.queue;
      const res = this.enterTown(block, null, now, false);
      this.queue = typeAhead;
      const arrival = this.map.room(res.pos);
      if (arrival) arrival.portal = true; // ... and so is the arrival room
      // Learn (or relearn) where this portal leads for next time.
      if (from && res.pos) this.map.setPortalDest(from.pos, from.dir, res.pos);
      return res;
    }

    // After a transit into an unlit room (see onDarkArrival) the player
    // walked on from a room no block described, in a place the departure's
    // town says nothing about: this block is the next move's arrival — that
    // move is spent — and a fresh entry like the transit's own would have
    // been (no resume, no hex anchor), with no portal mark and nothing
    // learned. Moves typed after it run here and survive the entry.
    if (darkTransit) {
      this.shiftMove();
      this.active = false;
      const typeAhead = this.queue;
      const res = this.enterTown(block, null, now, false);
      this.queue = typeAhead;
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
    // After a step into an unmapped dark room (see onDarkArrival) this block
    // is the NEXT move's arrival, from a room no block ever described: the
    // move says nothing about where it led from `current`. It is consumed,
    // and the queue predicts nothing — correlation alone resolves the block.
    if (unanchored) this.shiftMove();

    // --- Queue repair: drop dead moves before predicting ---
    // Moves die without a recognizable reply all the time: soft failures
    // with room-specific prose ("A very large eunuch ... You decide it's not
    // a good idea to go in there."), named moves answered "What ?" when the
    // reply could not be attributed. A dead head consumes the NEXT move's
    // block: the room lands in the wrong direction, under a false named
    // link, or as a phantom, and every later block is one move behind. Each
    // rule drops a head only on evidence that it cannot explain this block
    // (the block's own exits line, the current room's, a verbatim re-print)
    // — never on suspicion alone, since a move that worked and is dropped
    // leaves its block unexplained.
    const reprint = this.isReprint(current, block);
    let droppedDead = false;
    for (;;) {
      const head = unanchored ? undefined : this.queue[0];
      if (head?.kind === 'named') {
        if (!this.deadNamedHead(head, town, current, block, reprint)) break;
      } else if (head?.kind === 'dir') {
        // Exits sanity: the room's own exits line is ground truth. A move
        // through an exit it doesn't list (and was never walked) is a silent
        // failure — ALL such leading moves are dead, and the next live move
        // explains the block. (A stray "d" at a street corner once built a
        // duplicate street on a phantom floor.) A line listing only named
        // exits counts: "leap east" out of the Sepulcher Entrance ("There is
        // one obvious exit: out.") is a stunt, not an exit — tracked as `e`,
        // it filed the tunnel east under a link the next load cut (the
        // entrance never lists east), and every later leap built another
        // tunnel room.
        if (
          (current.exits.length > 0 || current.namedExits.length > 0) &&
          !current.exits.includes(head.dir) &&
          current.links[head.dir] === undefined
        ) {
          droppedDead = true;
        } else if (!this.deadDirHead(head, town, current, block, reprint)) {
          break;
        }
      } else {
        break;
      }
      this.shiftMove();
    }
    // Dead moves followed by a re-print of where we stand (a look, a
    // failure's re-print): stationary. Only a VERBATIM re-print — the old
    // rule dropped ONE dead move and called any same-NAMED block stationary,
    // swallowing the real move behind it: in the Blue Pearl pool, the
    // shallow end [out,s] with queue [n,n,s] took the middle-of-the-pool
    // block as a re-print, overwrote its own exits, and every later lap
    // minted another "shallow end" one cell further north (12 Pool rooms,
    // 2 real; session_2026-08-25T01-56-18-669.log).
    if (droppedDead && reprint && this.queue[0]?.kind !== 'look') {
      this.map.touchRoom(current, block, now);
      return { kind: 'stationary', pos: this.map.pos, moved: null };
    }

    // --- Try the queue prediction first ---
    const move = unanchored ? undefined : this.queue[0];

    if (move?.kind === 'look') {
      this.shiftMove();
      if (this.map.matches(current, block)) {
        this.map.touchRoom(current, block, now, true);
        return { kind: 'stationary', pos: this.map.pos, moved: move };
      }
      // Look shows a different room?! Fall through to correlation.
    } else if (move?.kind === 'dir') {
      // (Moves through exits current doesn't have were dropped above.)
      const linked = current.links[move.dir];
      let missedLink = false;
      if (linked !== undefined) {
        const dest = town.rooms.get(linked);
        if (dest && this.map.matches(dest, block)) {
          this.shiftMove();
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
        // Walked-between proof: a room we hold a direct link with (either
        // direction) is a physically DISTINCT room — the player traveled
        // between them — so it can never be "a duplicate of current" and
        // must not enable the healing exception. Identical twin ROWS
        // (Soriktos' Royal Stables: three word-identical segments in a
        // row, each with word-identical satellite Stalls) otherwise pass
        // the fingerprint test with no shared-neighbor conflict, and one
        // segment steals its neighbor's satellite — silently shifting the
        // player's map frame one cell sideways for the rest of the walk.
        const walkLinked = (a: TownRoom, b: TownRoom) =>
          Object.values(a.links).includes(b.id) || Object.values(b.links).includes(a.id);
        const relaxedReciprocal = (r: TownRoom) => {
          if (strictReciprocal(r)) return true;
          const back = town.rooms.get(r.links[TOWN_REVERSE[move.dir]]!);
          return (
            !!back &&
            back.name === current.name &&
            back.exits.join(',') === current.exits.join(',') &&
            !sharedNeighborConflict(current, back) &&
            !walkLinked(current, back)
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
          this.shiftMove();
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
        // ... unless the conflicting link is CONTRADICTED by the rooms'
        // own exits lines (a queue-desync scar, not geometry — see
        // linkContradicted): a poison wrong-direction link must not also
        // get to veto the true arrival forever.
        const alreadyNeighborElsewhere = (r: TownRoom) => {
          for (const [d, id] of Object.entries(current.links) as [TownDir, number][]) {
            if (id === r.id && d !== move.dir && !linkContradicted(current, d, r)) return true;
          }
          for (const [d, id] of Object.entries(r.links) as [TownDir, number][]) {
            if (
              id === current.id &&
              d !== TOWN_REVERSE[move.dir] &&
              !linkContradicted(r, d, current)
            ) {
              return true;
            }
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
        //
        // FLOOR ground truth: a tracked move's destination floor is exact
        // (lateral moves stay on the floor, u/d shift exactly one), so a
        // candidate on another z can never be this move's destination.
        // findMatchesNear tolerates dz=1 for the z-uncertain correlation
        // paths — here it let mirror-identical floors merge vertically:
        // the keep's 2F Bedchamber, entered n from its Vestibule, reused
        // the 3F Bedchamber directly above (same name+exits; its own
        // Vestibule mirrors ours, so the reciprocity guard passed).
        const cands = this.map
          .findMatchesNear(town, block, target.x, target.y, target.z, NEAR_RADIUS, 4)
          .filter(
            (r) =>
              r.z === target.z &&
              r.id !== current.id &&
              (gridVec === undefined || r.id !== occupantId)
          );
        const guarded = cands.filter((r) => relaxedReciprocal(r) && !alreadyNeighborElsewhere(r));
        // Readable disagreeing descs veto reuse regardless of candidate
        // count — the block itself is saying "not this one" (the plaza
        // lesson, extended to the single-candidate branch: the keep's
        // Bedchambers differ ONLY in prose, name+exits are identical).
        const descVeto = (r: TownRoom) =>
          descUsable(block.desc) && descUsable(r.desc) && !this.map.descAgrees(r, block);
        let reuse: TownRoom | null = null;
        if (cands.length <= 1) {
          reuse = guarded.length === 1 && !descVeto(guarded[0]) ? guarded[0] : null;
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
          } else if (guarded.length === 1 && !descVeto(guarded[0])) {
            reuse = guarded[0];
          }
        }
        if (reuse) {
          this.shiftMove();
          if (missedLink) this.linkHeals++;
          this.map.link(town, current, move.dir, reuse);
          this.map.touchRoom(reuse, block, now);
          this.map.pos = { townId: town.id, roomId: reuse.id };
          return { kind: 'expected', pos: this.map.pos, moved: move };
        }
        if (!missedLink) {
          this.shiftMove();
          const room = this.map.addRoom(town, block, target.x, target.y, target.z, now, move.dir);
          this.map.link(town, current, move.dir, room);
          this.map.pos = { townId: town.id, roomId: room.id };
          return { kind: 'new-room', pos: this.map.pos, moved: move };
        }
        // Mispredicting link with no confident replacement — leave the
        // queue intact and let correlation decide below.
      }
    } else if (move?.kind === 'named') {
      // Commands run in order, so the head is normally the move that
      // printed this block: tries of a multi-try alias that failed before it
      // were answered "What ?" and popped (onUnknownCommand), and later
      // tries run in the NEW room and get their own replies. But when a
      // "What ?" went to an earlier ordinary command instead of this head
      // (doubtful), the head may be dead too, and the alias's tries sent
      // with it are alternatives the block cannot tell apart ("eg" = enter
      // glade / enter graveyard / enter grave: the link was recorded as
      // "enter glade" while "enter grave" was what worked, and a walk would
      // send the command that fails).
      const tries = this.doubtful.has(move) ? this.namedBurst() : [move];
      for (const m of tries) {
        const id = current.namedLinks[m.cmd];
        const dest = id !== undefined ? town.rooms.get(id) : undefined;
        if (dest && dest.id !== current.id && this.map.matches(dest, block)) {
          this.consumeMoves(tries.length);
          this.map.touchRoom(dest, block, now, true);
          this.map.pos = { townId: town.id, roomId: dest.id };
          return { kind: 'expected', pos: this.map.pos, moved: m };
        }
      }
      // A try whose walked link leads elsewhere did not move us; the tries
      // without one are the candidates. Exactly one → its first use.
      const fresh = tries.filter((m) => current.namedLinks[m.cmd] === undefined);
      if (fresh.length === 0) {
        this.linkMisses++;
        // Every walked link disagrees (boats move!) — correlation decides
        // below, consuming the head; the rest of the tries go with it.
        this.queue.splice(1, tries.length - 1);
      } else {
        this.consumeMoves(tries.length);
        const linkWith = fresh.length === 1 ? fresh[0] : null;
        // First use of this named exit: reuse a matching known room
        // (proximity first), else create — unless continuity is broken
        // (a boat/portal carried us away → this is a fresh town entry).
        // Never the current room: a named exit doesn't lead back into the
        // room it leaves (re-prints were dropped above; the old search
        // included current and recorded self-links like "Shady Islet
        // -[enter path]-> Shady Islet").
        const target =
          this.namedTarget(
            this.map.findMatchesNear(
              town,
              block,
              current.x,
              current.y,
              current.z,
              NEAR_RADIUS,
              NAMED_REUSE_MAX + 1
            ),
            current,
            block
          ) ??
          this.namedTarget(this.map.findMatches(town, block, NAMED_REUSE_MAX + 1), current, block);
        if (target) {
          if (linkWith) this.map.linkNamed(current, linkWith.cmd, target);
          this.map.touchRoom(target, block, now);
          this.map.pos = { townId: town.id, roomId: target.id };
          return { kind: 'expected', pos: this.map.pos, moved: linkWith };
        }
        if (gap > CONTINUITY_GAP_MS) {
          this.active = false;
          return this.enterTown(block, anchor, now);
        }
        const created = this.map.addRoom(town, block, current.x, current.y, current.z, now);
        if (linkWith) this.map.linkNamed(current, linkWith.cmd, created);
        this.map.pos = { townId: town.id, roomId: created.id };
        return { kind: 'new-room', pos: this.map.pos, moved: linkWith };
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
        if (move) this.shiftMove();
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
          if (move) this.shiftMove();
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
          if (move) this.shiftMove();
          const floater = this.map.addRoom(town, block, current.x, current.y, current.z, now);
          this.map.pos = { townId: town.id, roomId: floater.id };
          return { kind: 'jumped', pos: this.map.pos, moved: null };
        }
      }
    }
    // Identity next: unsolicited re-prints and stale queues are common.
    if (this.map.matches(current, block)) {
      // Consume a stale dir move whose prediction failed (silent failure)
      if (move && move.kind !== 'look') this.shiftMove();
      this.map.touchRoom(current, block, now);
      return { kind: 'stationary', pos: this.map.pos, moved: null };
    }

    // Any linked neighbor matching? (forced moves, desynced queue)
    const matching = this.neighborsOf(town, current).filter((r) => this.map.matches(r, block));
    if (matching.length === 1) {
      if (move) this.shiftMove(); // whatever was queued, this is what happened
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
        if (move) this.shiftMove();
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
      if (move) this.shiftMove();
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
      if (move) this.shiftMove();
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
    if (move) this.shiftMove();
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
      const hit = this.map.findTownByAnchor(anchor, block);
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

  // -------------------------------------------------------------------------
  // Queue repair
  // -------------------------------------------------------------------------

  /** The block is a verbatim re-print of `current`: same name and exits,
   *  and no readable description disagreement. */
  private isReprint(current: TownRoom, block: TownRoomBlock): boolean {
    return (
      this.map.matchesStrict(current, block) &&
      (!descUsable(block.desc) || !descUsable(current.desc) || this.map.descAgrees(current, block))
    );
  }

  /**
   * A dir head the block cannot be the destination of. A room whose exits
   * line omits the way back is very unlikely to be where the head move led:
   * soft failures with room-specific flavor text leave their dead move at
   * the head, and consuming it for the NEXT move's block wires a poison link
   * that the twin-guards then defend forever (Soriktos: the Blue Pearl's
   * one-exit Garden Courtyard spent days wired WEST of the Salon, and every
   * true southern arrival duplicated it). Genuinely non-reciprocal arrivals
   * exist (~2% of corpus moves: sloped trails where "down" returns as
   * "north", the Ancient Temple's Eye), so the head is only dropped for a
   * strictly BETTER explanation: a later queued move whose way back the
   * block lists, or a verbatim re-print of the current room. A recorded link
   * whose destination matches keeps the head (a walked link proves the exit
   * even when a state-truncated exits line hides it). A block WITH named
   * exits can have been reached with the way back being one of them ("n"
   * into a building whose only exit is "out"), so there only a re-print
   * judges: a dead "d" ("You try to descend into the hold, but an awful
   * stench repels you.") otherwise filed the galley deck's look re-print as
   * a phantom deck one floor down.
   */
  private deadDirHead(
    head: Extract<TownMove, { kind: 'dir' }>,
    town: Town,
    current: TownRoom,
    block: TownRoomBlock,
    reprint: boolean
  ): boolean {
    const hasNamed = block.exits.named.length > 0;
    if (hasNamed ? !reprint : block.exits.dirs.length === 0) return false;
    if (block.exits.dirs.includes(TOWN_REVERSE[head.dir])) return false;
    const linked = current.links[head.dir];
    const dest = linked !== undefined ? town.rooms.get(linked) : undefined;
    if (dest && this.map.matches(dest, block)) return false;
    if (reprint) return true;
    return this.queue.some(
      (m, i) => i > 0 && m.kind === 'dir' && block.exits.dirs.includes(TOWN_REVERSE[m.dir])
    );
  }

  /**
   * A named head that cannot have printed this block. Named moves fail with
   * replies the movement-failure patterns never covered ("What ?" — popped
   * by onUnknownCommand when it can be attributed, but not always), and a
   * dead one used to claim the next block as its "first use": 27 of the 38
   * named links in the corpus replay were false, three of them in Bill's
   * live save (Forecourt -[enter portal]-> a phantom Market, which then
   * overwrote the plaza center with the SE corner's exits).
   *  - A portal command still queued has failed by construction: a working
   *    portal prints its transit line, and onPortalTransit consumes the
   *    command before the arrival block.
   *  - "out" / "back" / "exit" are words the exits line LISTS: a room whose
   *    exits line lacks the word cannot be left that way (the Armory: a dead
   *    "out" filed the Bailey reached next by "door s" as a new Bailey).
   *  - A verbatim re-print of current: the move went nowhere (a following
   *    look's output). Never a self-link.
   *  - A later queued direction that current really has and whose way back
   *    the block lists explains the block better — unless the block lists a
   *    named exit: a named move's destination has one as often as not, so
   *    the block fits both moves ("enter inn" lands in a lobby with "out,
   *    north, and south"; dropping the head for the "n" typed ahead to the
   *    corridor linked the lobby NORTH of the street, and the corridor became
   *    a floater). deadDirHead gates its rule the same way.
   * A walked link from current whose destination matches keeps the head.
   */
  private deadNamedHead(
    head: NamedMove,
    town: Town,
    current: TownRoom,
    block: TownRoomBlock,
    reprint: boolean
  ): boolean {
    if (isPortalCommand(head.cmd)) return true;
    if (
      LISTED_NAMED_EXITS.has(head.cmd) &&
      (current.exitsEver.length > 0 || current.namedExits.length > 0) &&
      !current.namedExits.includes(head.cmd)
    ) {
      return true;
    }
    const linked = current.namedLinks[head.cmd];
    const dest = linked !== undefined ? town.rooms.get(linked) : undefined;
    if (dest && dest.id !== current.id && this.map.matches(dest, block)) return false;
    if (reprint) return true;
    if (block.exits.named.length > 0) return false;
    return this.queue.some(
      (m, i) =>
        i > 0 &&
        m.kind === 'dir' &&
        block.exits.dirs.includes(TOWN_REVERSE[m.dir]) &&
        (current.exits.includes(m.dir) || current.links[m.dir] !== undefined)
    );
  }

  /** The named moves at the queue head sent in one burst with it (one alias
   *  expansion — see NAMED_BURST_MS) */
  private namedBurst(): NamedMove[] {
    const head = this.queue[0] as NamedMove;
    let n = 1;
    while (
      n < this.queue.length &&
      this.queue[n].kind === 'named' &&
      Math.abs(this.queue[n].at - head.at) <= NAMED_BURST_MS
    ) {
      n++;
    }
    return this.queue.slice(0, n) as NamedMove[];
  }

  /**
   * The room a first-use named exit may reuse among the strict matches `rs`
   * (more than NAMED_REUSE_MAX: the search hit its limit, too many
   * look-alikes to judge — create instead). Never current: a named exit
   * doesn't lead back into the room it leaves. But current still COUNTS as a
   * look-alike — when it shares the block's fingerprint, two physical rooms
   * already wear it, and a lone other match is no likelier the destination
   * than an unmapped third twin. So:
   *  - a unique description agreement identifies the room (same-fingerprint
   *    twins differ in prose: the Bailey's west and east ends);
   *  - otherwise only a LONE look-alike, current not among them, is reused —
   *    and not when both descriptions are readable and disagree (the
   *    frontier's single-candidate veto: the block itself says "not this
   *    one"). Excluding current before counting turned "current + one twin"
   *    into a unique reuse: from a market side, a door onto an unmapped third
   *    side was filed onto the twin two cells away, and touchRoom overwrote
   *    that twin's description — the plaza's hall-of-mirrors corruption.
   */
  private namedTarget(rs: TownRoom[], current: TownRoom, block: TownRoomBlock): TownRoom | null {
    if (rs.length > NAMED_REUSE_MAX) return null;
    const cands = rs.filter((r) => r.id !== current.id);
    const byDesc = cands.filter((r) => this.map.descAgrees(r, block));
    if (byDesc.length === 1) return byDesc[0];
    if (rs.length !== 1 || cands.length !== 1) return null;
    const lone = cands[0];
    const descVeto =
      descUsable(block.desc) && descUsable(lone.desc) && !this.map.descAgrees(lone, block);
    return descVeto ? null : lone;
  }

  private expireQueue(now: number): void {
    while (this.queue.length > 0 && now - this.queue[0].at > QUEUE_MAX_AGE) {
      this.shiftMove();
    }
  }
}
