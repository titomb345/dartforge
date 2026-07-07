/**
 * Town map store — per-town room graphs laid out on a 3D grid.
 *
 * Layout model (corpus-validated, July 2026):
 *  - Cardinal moves (n/s/e/w) and u/d are grid-consistent in DartMUD towns
 *    (98%+ of round trips and coordinate revisits agree), so they are HARD
 *    placement constraints: a room reached by "e" sits one cell east.
 *  - Diagonal exits (ne/nw/se/sw) do NOT compose like vectors (confirmed:
 *    Tobermore "sw" ≠ "s"+"w") — they are graph shortcuts. A diagonal
 *    placement is only a HINT; it never overrides an occupied cell.
 *  - Named exits ("back", "out", "enter <thing>") are non-spatial links.
 *  - When a CARDINAL placement collides (two rooms, one cell), the map is
 *    STRETCHED: every placed room at/beyond the target cell shifts one cell
 *    along the movement axis, vacating the natural cell so the new room
 *    lands exactly where the move says. Straight streets stay straight and
 *    axis order stays monotone. A DIAGONAL arrival into an occupied cell
 *    double-stretches — one shift per component axis — so the room still
 *    lands at its diagonal hint cell and the occupant stays diagonal to it.
 *    Placements without a direction at all (u/d, floaters, named exits)
 *    are nudged to the nearest free cell instead. Links — not grid
 *    adjacency — drive pathfinding, so a displaced room stays walkable
 *    either way.
 *
 * Each town is keyed by the hex(es) it was entered from, so the hex map
 * can show which town you're in. z is the floor index (0 = entry level).
 */

import { TOWN_DIR_VEC, TOWN_REVERSE, type TownDir, type TownRoomBlock } from './townParser';
import { classifyRoomIcon, type RoomIconType } from './mapMarkers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TownRoom {
  id: number;
  name: string;
  descFirst: string;
  desc: string;
  x: number;
  y: number;
  z: number;
  /** Directions listed in the latest exits line */
  exits: TownDir[];
  /** Union of every direction this room has ever listed (exit sets vary
   *  with world state — portcullises, darkness — but never grow lies) */
  exitsEver: TownDir[];
  /** Directions that go through a door/gate */
  doorDirs: TownDir[];
  /** Doors standing open at the latest sighting (subset of doorDirs) */
  openDoorDirs: TownDir[];
  /** Keyring slot that unlocked each door dir (learned by the door runner) */
  doorKeySlots?: Partial<Record<TownDir, number>>;
  /** Non-directional exits ("back", "out", "exit") */
  namedExits: string[];
  /** A portal transit departed from or arrived at this room */
  portal: boolean;
  /**
   * Point-of-interest icon (bank, shop, inn, ...). Auto-classified from
   * the room's name/description; 'none' = user explicitly removed it
   * (auto must not re-add); null = unclassified.
   */
  icon: RoomIconType | 'none' | null;
  /** Confirmed connections: dir → destination room id */
  links: Partial<Record<TownDir, number>>;
  /** Confirmed non-directional connections: command → destination room id */
  namedLinks: Record<string, number>;
  visits: number;
  lastSeen: number;
  notes: string;
}

export interface Town {
  id: number;
  /** User-editable label (defaults to the entry room's name) */
  name: string;
  /**
   * Hex anchor memory: "island:q,r" → room id you land in when entering
   * from that hex (learned on entry AND on exit). This is what re-localizes
   * instantly on re-entry — town room names are far too generic for
   * fingerprint-only relocalization.
   */
  anchors: Record<string, number>;
  rooms: Map<number, TownRoom>;
  /** "x,y,z" → room id */
  grid: Map<string, number>;
  nextRoomId: number;
  /** Room seen first when entering from the wilderness */
  entryRoomId: number | null;
}

export interface TownPos {
  townId: number;
  roomId: number;
}

export interface TownWalkStep {
  /** Command to send ("n", "u", "back", ...) */
  cmd: string;
  toRoomId: number;
}

const gridKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Component cardinal axes of each diagonal (double-stretch placement) */
const DIAG_COMPONENTS: Partial<Record<TownDir, [TownDir, TownDir]>> = {
  ne: ['n', 'e'],
  nw: ['n', 'w'],
  se: ['s', 'e'],
  sw: ['s', 'w'],
};

/**
 * Canonical description for identity comparison. Lighting sentences ("It is
 * painfully bright.") change with the time of day, so every "It is ..."
 * sentence is stripped and whitespace collapsed. What survives is the room's
 * stable prose — which tells same-fingerprint twins apart (the Eris market
 * plaza: identical "Market" name and exits, but "the northern edge" vs "the
 * western side" mid-description). Too-short results are unusable: comparing
 * them proves nothing, so callers must check descUsable() first.
 */
/** Lighting sentences change with the time of day — one definition shared
 *  by descKey (global strip) and stableSentenceCandidates (per-sentence). */
const LIGHTING_SENTENCE = 'It is [^.]{1,60}\\.';

export function descKey(desc: string): string {
  return desc
    .replace(new RegExp('\\b' + LIGHTING_SENTENCE, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DESC_KEY_MIN = 20;

export function descUsable(desc: string): boolean {
  return descKey(desc).length >= DESC_KEY_MIN;
}

/** Split prose into normalized sentences (whitespace collapsed). */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentences too short to be meaningful volatile-prose evidence, plus the
 *  lighting sentences descKey already handles. */
const LIGHTING_SENTENCE_START = new RegExp('^' + LIGHTING_SENTENCE);
function stableSentenceCandidates(text: string): string[] {
  return splitSentences(text).filter((s) => s.length >= 20 && !LIGHTING_SENTENCE_START.test(s));
}

/** Max learned volatile sentences kept (and serialized) */
const VOLATILE_MAX = 64;
/** Max unpromoted alternation pairs tracked */
const VOLATILE_PENDING_MAX = 200;

export function hexAnchorKey(island: number, q: number, r: number): string {
  return `${island}:${q},${r}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class TownMapStore {
  towns = new Map<number, Town>();
  nextTownId = 0;
  pos: TownPos | null = null;
  /** Nudge counter — collisions resolved by nearest-free-cell (diagnostics) */
  nudges = 0;
  /** Stretch counter — collisions resolved by shifting the map (diagnostics) */
  stretches = 0;
  /**
   * Portal destination memory: "townId:roomId:dirWord" of the room a portal
   * was stepped into (dirWord '*' when the transit line names no direction)
   * → the room it delivered to. This is the hex map's anchor idea applied
   * to portals: every temple Forecourt looks identical, so entry matching
   * is hopelessly ambiguous — but WHICH portal was stepped through is not.
   * Without it, every hub transit spawned a fresh fragment town that later
   * merge-scarred the real town with desc-divergent duplicates.
   */
  portalDests = new Map<string, TownPos>();
  /**
   * Learned VOLATILE prose: sentences that swap with world state (time of
   * day) inside otherwise-identical descriptions — "The market is active
   * with shoppers..." alternating with "...mostly empty except for a few
   * adventurers..." (the Eris market cycles through six such variants).
   * These defeat the description tiebreaker: the same room reads as a
   * desc-DISAGREEING twin across an hour boundary, and the disagreement
   * veto then duplicates it. Learning: a positively-identified revisit
   * (confirmed link / look re-print) whose desc differs in EXACTLY one
   * swapped sentence records the pair; a pair witnessed on 2+ DIFFERENT
   * rooms promotes both sentences. World-state prose is shared across
   * rooms by nature; twin-distinguishing prose is room-specific — that
   * asymmetry is what makes the promotion safe.
   */
  volatileSentences = new Set<string>();
  private volatilePending = new Map<string, Set<number>>();

  get(townId: number): Town | undefined {
    return this.towns.get(townId);
  }

  room(pos: TownPos | null): TownRoom | undefined {
    if (!pos) return undefined;
    return this.towns.get(pos.townId)?.rooms.get(pos.roomId);
  }

  findTownByAnchor(anchor: string): { town: Town; roomId: number } | undefined {
    for (const town of this.towns.values()) {
      const roomId = town.anchors[anchor];
      if (roomId !== undefined && town.rooms.has(roomId)) return { town, roomId };
    }
    return undefined;
  }

  createTown(defaultName: string): Town {
    const town: Town = {
      id: this.nextTownId++,
      name: defaultName,
      anchors: {},
      rooms: new Map(),
      grid: new Map(),
      nextRoomId: 0,
      entryRoomId: null,
    };
    this.towns.set(town.id, town);
    return town;
  }

  setAnchor(town: Town, anchor: string, roomId: number): void {
    town.anchors[anchor] = roomId;
  }

  deleteTown(townId: number): void {
    this.towns.delete(townId);
    if (this.pos?.townId === townId) this.pos = null;
    for (const [key, dest] of this.portalDests) {
      if (dest.townId === townId || key.startsWith(`${townId}:`)) this.portalDests.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Portal destination memory
  // -------------------------------------------------------------------------

  private portalKey(from: TownPos, dirWord: string | null): string {
    return `${from.townId}:${from.roomId}:${dirWord ?? '*'}`;
  }

  setPortalDest(from: TownPos, dirWord: string | null, dest: TownPos): void {
    this.portalDests.set(this.portalKey(from, dirWord), dest);
  }

  getPortalDest(from: TownPos, dirWord: string | null): TownPos | undefined {
    return this.portalDests.get(this.portalKey(from, dirWord));
  }

  renameTown(townId: number, name: string): void {
    const town = this.towns.get(townId);
    if (town) town.name = name;
  }

  clear(): void {
    this.towns.clear();
    this.nextTownId = 0;
    this.pos = null;
    this.nudges = 0;
    this.stretches = 0;
    this.portalDests.clear();
    this.volatileSentences.clear();
    this.volatilePending.clear();
  }

  // -------------------------------------------------------------------------
  // Room creation & placement
  // -------------------------------------------------------------------------

  /**
   * Create a room from a parsed block at/near (x,y,z). When `via` is the
   * direction that was walked to reach the room, an occupied cell is
   * resolved by STRETCHING the map so the new room always lands exactly at
   * (x,y,z): one shift along the movement axis for a cardinal arrival, one
   * shift per component axis for a diagonal (see stretchToVacate). Without
   * a lateral `via` (u/d, floaters, named exits) the room is nudged to the
   * nearest free cell instead (grid position is presentation; links carry
   * connectivity).
   */
  addRoom(
    town: Town,
    block: TownRoomBlock,
    x: number,
    y: number,
    z: number,
    now: number,
    via?: TownDir
  ): TownRoom {
    let spot = { x, y };
    const vec = via !== undefined ? TOWN_DIR_VEC[via] : undefined;
    const diag = via !== undefined ? DIAG_COMPONENTS[via] : undefined;
    const occupied = town.grid.has(gridKey(x, y, z));
    if (occupied && vec && vec[2] === 0) {
      this.stretchToVacate(town, { x, y }, via!);
    } else if (occupied && diag) {
      // Diagonal arrival: double-stretch — vacate the target column and the
      // target row (one shift per component axis) so the room lands at its
      // diagonal hint cell and the displaced occupant stays diagonal to it.
      this.stretchToVacate(town, { x, y }, diag[0]);
      this.stretchToVacate(town, { x, y }, diag[1]);
    } else {
      spot = this.findFreeCell(town, x, y, z);
      if (spot.x !== x || spot.y !== y) this.nudges++;
    }
    const room: TownRoom = {
      id: town.nextRoomId++,
      name: block.name,
      descFirst: block.descFirst,
      desc: block.desc,
      x: spot.x,
      y: spot.y,
      z,
      exits: block.exits.dirs,
      exitsEver: [...block.exits.dirs],
      doorDirs: block.exits.doorDirs,
      openDoorDirs: block.exits.openDoorDirs,
      namedExits: block.exits.named,
      portal: false,
      icon: classifyRoomIcon(block.name, block.desc),
      links: {},
      namedLinks: {},
      visits: 1,
      lastSeen: now,
      notes: '',
    };
    town.rooms.set(room.id, room);
    town.grid.set(gridKey(room.x, room.y, room.z), room.id);
    return room;
  }

  /**
   * Vacate `target` for a cardinal arrival by shifting the half-plane of
   * PLACED rooms at/beyond the target cell one cell along the movement
   * axis (all floors — cross-floor stair alignment is preserved). The
   * from-room is strictly on the near side of the cut, so it never moves;
   * the entire target row/column is vacated, so the cell is guaranteed
   * free afterward. Only rooms present in town.grid move — during relayout
   * the not-yet-placed rooms keep their stale coords untouched.
   */
  private stretchToVacate(town: Town, target: { x: number; y: number }, dir: TownDir): void {
    const vec = TOWN_DIR_VEC[dir];
    if (!vec || vec[2] !== 0) return;
    const [dx, dy] = vec;
    const shifted: TownRoom[] = [];
    for (const id of town.grid.values()) {
      const r = town.rooms.get(id);
      if (!r) continue;
      const beyond =
        dx === 1
          ? r.x >= target.x
          : dx === -1
            ? r.x <= target.x
            : dy === 1
              ? r.y >= target.y
              : r.y <= target.y;
      if (beyond) shifted.push(r);
    }
    for (const r of shifted) town.grid.delete(gridKey(r.x, r.y, r.z));
    for (const r of shifted) {
      r.x += dx;
      r.y += dy;
      town.grid.set(gridKey(r.x, r.y, r.z), r.id);
    }
    this.stretches++;
  }

  /** Nearest free cell to (x,y) on floor z — ring search, radius ≤ 6. */
  private findFreeCell(town: Town, x: number, y: number, z: number): { x: number; y: number } {
    if (!town.grid.has(gridKey(x, y, z))) return { x, y };
    for (let radius = 1; radius <= 6; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          if (!town.grid.has(gridKey(x + dx, y + dy, z))) {
            return { x: x + dx, y: y + dy };
          }
        }
      }
    }
    // Pathological pile-up — stack far out rather than overwrite
    let fx = x + 7;
    while (town.grid.has(gridKey(fx, y, z))) fx++;
    return { x: fx, y };
  }

  /** Target cell for a move from `from` in `dir` (grid dirs move one cell;
   *  diagonals hint diagonally; u/d change floor). */
  placementTarget(from: TownRoom, dir: TownDir): { x: number; y: number; z: number } {
    const vec = TOWN_DIR_VEC[dir];
    if (vec) return { x: from.x + vec[0], y: from.y + vec[1], z: from.z + vec[2] };
    // Diagonal — the visual diagonal is a placement hint only. Derived
    // from the same DIAG_COMPONENTS table addRoom's double-stretch uses,
    // so the hint cell and the vacated row/column can never disagree.
    const [d1, d2] = DIAG_COMPONENTS[dir]!;
    const v1 = TOWN_DIR_VEC[d1]!;
    const v2 = TOWN_DIR_VEC[d2]!;
    return { x: from.x + v1[0] + v2[0], y: from.y + v1[1] + v2[1], z: from.z };
  }

  /** Record a confirmed transition. The reverse link is inferred (98%+ of
   *  town moves are symmetric) but never overwrites a confirmed link. */
  link(_town: Town, from: TownRoom, dir: TownDir, to: TownRoom): void {
    from.links[dir] = to.id;
    const rev = TOWN_REVERSE[dir];
    if (to.links[rev] === undefined) to.links[rev] = from.id;
  }

  linkNamed(from: TownRoom, cmd: string, to: TownRoom): void {
    from.namedLinks[cmd] = to.id;
  }

  /**
   * Record a desc alternation observed on a POSITIVELY identified revisit:
   * old and new descs sharing 2+ sentences and differing in exactly one
   * swapped sentence. The pair promotes to volatileSentences once seen on
   * two different rooms (see the field's doc for why that guard matters).
   */
  private learnVolatileDesc(roomId: number, oldDesc: string, newDesc: string): void {
    const a = stableSentenceCandidates(oldDesc);
    const b = stableSentenceCandidates(newDesc);
    if (a.length < 3 || b.length < 3) return;
    const setA = new Set(a);
    const setB = new Set(b);
    const removed = a.filter((s) => !setB.has(s));
    const added = b.filter((s) => !setA.has(s));
    // (a.length >= 3 above + exactly one swap ⇒ at least 2 shared sentences)
    if (removed.length !== 1 || added.length !== 1) return;
    if (this.volatileSentences.has(removed[0]) && this.volatileSentences.has(added[0])) return;
    const pair = [removed[0], added[0]].sort();
    const key = pair.join(' ');
    let seenOn = this.volatilePending.get(key);
    if (!seenOn) {
      if (this.volatilePending.size >= VOLATILE_PENDING_MAX) return;
      seenOn = new Set();
      this.volatilePending.set(key, seenOn);
    }
    seenOn.add(roomId);
    if (seenOn.size >= 2 && this.volatileSentences.size <= VOLATILE_MAX - 2) {
      this.volatileSentences.add(pair[0]);
      this.volatileSentences.add(pair[1]);
      this.volatilePending.delete(key);
    }
  }

  /**
   * Refresh a room's volatile fields from a fresh sighting. Pass
   * `positiveId` only when the identification did NOT lean on heuristics
   * (confirmed link follow, look re-print) — it feeds volatile-prose
   * learning, and learning from a wrong reuse would poison the set.
   */
  touchRoom(room: TownRoom, block: TownRoomBlock, now: number, positiveId = false): void {
    if (positiveId && room.desc && block.desc) {
      this.learnVolatileDesc(room.id, room.desc, block.desc);
    }
    room.exits = block.exits.dirs;
    for (const d of block.exits.dirs) {
      if (!room.exitsEver.includes(d)) room.exitsEver.push(d);
    }
    room.doorDirs = block.exits.doorDirs;
    room.openDoorDirs = block.exits.openDoorDirs;
    room.namedExits = block.exits.named;
    room.descFirst = block.descFirst || room.descFirst;
    room.desc = block.desc || room.desc;
    // A fuller description can newly reveal an icon (bulletin boards live
    // mid-desc); explicit choices (any icon, or 'none') are never touched.
    if (room.icon === null) room.icon = classifyRoomIcon(room.name, room.desc);
    room.visits++;
    room.lastSeen = now;
  }

  /**
   * Set a room's icon from the picker. 'none' records explicit removal;
   * null returns the room to AUTO (re-classified immediately).
   */
  setRoomIcon(townId: number, roomId: number, icon: RoomIconType | 'none' | null): void {
    const room = this.towns.get(townId)?.rooms.get(roomId);
    if (!room) return;
    room.icon = icon === null ? classifyRoomIcon(room.name, room.desc) : icon;
  }

  /**
   * Remember which keyring slot unlocks a door (learned by the door
   * runner). Mirrored onto the far side of the door — same lock, same key.
   */
  learnDoorKey(townId: number, roomId: number, dir: TownDir, slot: number): void {
    const town = this.towns.get(townId);
    const room = town?.rooms.get(roomId);
    if (!town || !room) return;
    (room.doorKeySlots ??= {})[dir] = slot;
    const destId = room.links[dir];
    const dest = destId !== undefined ? town.rooms.get(destId) : undefined;
    if (dest) (dest.doorKeySlots ??= {})[TOWN_REVERSE[dir]] = slot;
  }

  // -------------------------------------------------------------------------
  // Matching
  // -------------------------------------------------------------------------

  /**
   * Does a parsed block plausibly describe this room? Name must match
   * exactly; exits are scored leniently (door states, portcullises and
   * darkness change the listed set between sightings).
   */
  matches(room: TownRoom, block: TownRoomBlock): boolean {
    return room.name === block.name;
  }

  /** Stricter match for relocalization: name + exact exits dir-set. */
  matchesStrict(room: TownRoom, block: TownRoomBlock): boolean {
    if (room.name !== block.name) return false;
    const a = room.exits.join(',');
    const b = block.exits.dirs.join(',');
    return a === b;
  }

  /**
   * Does the block's description agree with this room's? Only meaningful
   * when both sides are usable (long enough after canonicalization) — this
   * is the tiebreaker that separates same-fingerprint twins in uniform
   * neighborhoods like the Eris market plaza. Never use a desc DISAGREEMENT
   * to veto an otherwise-unique match: descriptions can embed dynamic
   * content, so absence of agreement only means "no extra evidence".
   */
  /** descKey with learned volatile sentences removed first. Stable prose
   *  can never be learned as volatile (it never appears in a revisit diff),
   *  so the stripped key always retains the room's distinguishing text. */
  private canonDesc(text: string): string {
    if (this.volatileSentences.size === 0) return descKey(text);
    const kept = splitSentences(text).filter((s) => !this.volatileSentences.has(s));
    return descKey(kept.join(' '));
  }

  descAgrees(room: TownRoom, block: TownRoomBlock): boolean {
    const a = this.canonDesc(room.desc);
    const b = this.canonDesc(block.desc);
    if (a.length < DESC_KEY_MIN || b.length < DESC_KEY_MIN) return false;
    // Suffix containment, not just equality: session logs (and rarely the
    // live stream) can fragment lines, and the parser then captures a
    // contiguous TAIL of the true description (its backward scan stops at
    // the mangled line). Two sightings of one room therefore produce keys
    // where one is a suffix of the other. Twins' prose still differs, so
    // suffix agreement keeps separating them.
    return a === b || a.endsWith(b) || b.endsWith(a);
  }

  /** Entry-grade match: name + exits + description prefix. Town names are
   *  generic ("A dirt road") — only this grade may join towns together. */
  matchesEntry(room: TownRoom, block: TownRoomBlock): boolean {
    return (
      this.matchesStrict(room, block) &&
      room.descFirst.length >= 20 &&
      room.descFirst.slice(0, 40) === block.descFirst.slice(0, 40)
    );
  }

  /** Unique entry-grade match across ALL towns (used when entering from an
   *  unknown hex). Returns null when none or ambiguous. */
  findEntryMatchGlobal(block: TownRoomBlock): { town: Town; room: TownRoom } | null {
    let found: { town: Town; room: TownRoom } | null = null;
    for (const town of this.towns.values()) {
      for (const room of town.rooms.values()) {
        if (!this.matchesEntry(room, block)) continue;
        if (found) return null; // ambiguous
        found = { town, room };
      }
    }
    return found;
  }

  /** Rooms in `town` that strictly match the block (relocalization). */
  findMatches(town: Town, block: TownRoomBlock, limit: number): TownRoom[] {
    const out: TownRoom[] = [];
    for (const room of town.rooms.values()) {
      if (this.matchesStrict(room, block)) {
        out.push(room);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Strict matches near a grid position (Chebyshev distance on the same or
   * adjacent floor). Duplicate fingerprints are common town-wide ("Market"
   * street runs) but rare within a small neighborhood — proximity is the
   * disambiguator that keeps nudged/aliased walks from duplicating rooms.
   */
  findMatchesNear(
    town: Town,
    block: TownRoomBlock,
    x: number,
    y: number,
    z: number,
    radius: number,
    limit: number
  ): TownRoom[] {
    const out: TownRoom[] = [];
    for (const room of town.rooms.values()) {
      if (Math.abs(room.z - z) > 1) continue;
      if (Math.max(Math.abs(room.x - x), Math.abs(room.y - y)) > radius) continue;
      if (this.matchesStrict(room, block)) {
        out.push(room);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Town merging (the hex engine's island-merge, ported to room graphs)
  // -------------------------------------------------------------------------

  /**
   * Does `roomB` structurally match `roomA`? Same name, and their linked
   * neighborhoods agree: at least `minMatches` shared directions lead to
   * same-named rooms, with zero contradictions. A room name alone is far
   * too generic; a room plus its neighbors is a reliable "patch".
   */
  private structuralMatch(
    townB: Town,
    roomB: TownRoom,
    townA: Town,
    roomA: TownRoom,
    minMatches: number
  ): boolean {
    if (roomB.name !== roomA.name) return false;
    let matches = 0;
    let lateralMatch = false; // a matched non-u/d direction
    let distinctName = false; // a matched neighbor named differently than us
    for (const [dir, idB] of Object.entries(roomB.links) as [TownDir, number][]) {
      const idA = roomA.links[dir];
      if (idA === undefined) continue;
      const nB = townB.rooms.get(idB);
      const nA = townA.rooms.get(idA);
      if (!nB || !nA) continue;
      if (nB.name !== nA.name) return false; // contradiction
      matches++;
      if (dir !== 'u' && dir !== 'd') lateralMatch = true;
      if (nB.name !== roomB.name) distinctName = true;
    }
    if (matches < minMatches) return false;
    // Self-similar structures (stairwell towers agreeing only on u/d,
    // identical dirt-road chains) must not merge on structure alone.
    if (!lateralMatch || !distinctName) return false;
    // Description agreement seals it; short/absent descriptions need a
    // deeper structural match instead.
    if (roomB.descFirst.length >= 20 && roomA.descFirst.length >= 20) {
      return roomB.descFirst.slice(0, 40) === roomA.descFirst.slice(0, 40);
    }
    return matches >= minMatches + 1;
  }

  /**
   * Search other towns for a unique structural match of `room`. Returns
   * the match or null (none / ambiguous).
   */
  findMergeCandidate(
    town: Town,
    room: TownRoom,
    minMatches = 2
  ): { town: Town; room: TownRoom } | null {
    let linkCount = 0;
    for (const v of Object.values(room.links)) if (v !== undefined) linkCount++;
    if (linkCount < minMatches) return null;
    let found: { town: Town; room: TownRoom } | null = null;
    for (const other of this.towns.values()) {
      if (other.id === town.id) continue;
      for (const cand of other.rooms.values()) {
        if (!this.structuralMatch(town, room, other, cand, minMatches)) continue;
        if (found) return null; // ambiguous
        found = { town: other, room: cand };
      }
    }
    return found;
  }

  /**
   * Merge town `from` into town `into`, aligning `fromRoom` onto `intoRoom`
   * (they are the same physical room). Rooms are translated into the target
   * frame; a translated room landing on a same-named room FUSES with it
   * (links redirected), otherwise it is copied (nudged if its cell is
   * taken). Anchors and the current position follow the merge.
   */
  mergeTowns(from: Town, fromRoomId: number, into: Town, intoRoomId: number): void {
    const fromRoom = from.rooms.get(fromRoomId);
    const intoRoom = into.rooms.get(intoRoomId);
    if (!fromRoom || !intoRoom) return;
    const dx = intoRoom.x - fromRoom.x;
    const dy = intoRoom.y - fromRoom.y;
    const dz = intoRoom.z - fromRoom.z;

    // Pass 1: decide fuse-vs-copy for every room and build the id mapping.
    const idMap = new Map<number, number>();
    const copied: TownRoom[] = [];
    for (const r of from.rooms.values()) {
      const tx = r.x + dx;
      const ty = r.y + dy;
      const tz = r.z + dz;
      const occupantId = into.grid.get(gridKey(tx, ty, tz));
      const occupant = occupantId !== undefined ? into.rooms.get(occupantId) : undefined;
      if (occupant && occupant.name === r.name) {
        idMap.set(r.id, occupant.id); // fuse
        occupant.visits += r.visits;
        if (r.lastSeen > occupant.lastSeen) occupant.lastSeen = r.lastSeen;
        if (!occupant.notes && r.notes) occupant.notes = r.notes;
      } else {
        const spot = this.findFreeCell(into, tx, ty, tz);
        if (spot.x !== tx || spot.y !== ty) this.nudges++;
        const copy: TownRoom = { ...r, id: into.nextRoomId++, x: spot.x, y: spot.y, z: tz };
        into.rooms.set(copy.id, copy);
        into.grid.set(gridKey(copy.x, copy.y, copy.z), copy.id);
        idMap.set(r.id, copy.id);
        copied.push(copy);
      }
    }

    // Pass 2: rewrite links through the id mapping. Fused targets keep
    // their own links; incoming links only fill gaps.
    for (const r of from.rooms.values()) {
      const target = into.rooms.get(idMap.get(r.id)!);
      if (!target) continue;
      for (const [dir, destOld] of Object.entries(r.links) as [TownDir, number][]) {
        const destNew = idMap.get(destOld);
        if (destNew !== undefined && target.links[dir] === undefined) {
          target.links[dir] = destNew;
        }
      }
      for (const [cmd, destOld] of Object.entries(r.namedLinks)) {
        const destNew = idMap.get(destOld);
        if (destNew !== undefined && target.namedLinks[cmd] === undefined) {
          target.namedLinks[cmd] = destNew;
        }
      }
    }
    void copied;

    // Anchors follow
    for (const [anchor, roomId] of Object.entries(from.anchors)) {
      const mapped = idMap.get(roomId);
      if (mapped !== undefined && into.anchors[anchor] === undefined) {
        into.anchors[anchor] = mapped;
      }
    }

    // Current position follows
    if (this.pos?.townId === from.id) {
      const mapped = idMap.get(this.pos.roomId);
      this.pos = mapped !== undefined ? { townId: into.id, roomId: mapped } : null;
    }

    // Portal destination memory follows (both sides of each entry) — this is
    // how the anchor learned on a first-trip fragment keeps working once the
    // fragment fuses into the real town. Rebuilt into a fresh map so
    // mutation-during-iteration can't happen by construction.
    const remapped = new Map<string, TownPos>();
    for (const [key, dest] of this.portalDests) {
      let newKey = key;
      const [townIdStr, roomIdStr, dirWord] = key.split(':');
      if (Number(townIdStr) === from.id) {
        const mapped = idMap.get(Number(roomIdStr));
        if (mapped === undefined) continue; // drop — source room vanished
        newKey = `${into.id}:${mapped}:${dirWord}`;
      }
      let newDest = dest;
      if (dest.townId === from.id) {
        const mapped = idMap.get(dest.roomId);
        if (mapped === undefined) continue;
        newDest = { townId: into.id, roomId: mapped };
      }
      remapped.set(newKey, newDest);
    }
    this.portalDests = remapped;

    // Pending volatile-prose witnesses hold bare room ids that this merge
    // just renumbered — a stale id plus its remapped twin could satisfy
    // the "2+ different rooms" promotion guard with ONE physical room, so
    // drop them (merges are rare; pending evidence re-accumulates).
    this.volatilePending.clear();

    this.towns.delete(from.id);
    // Deliberately NO relayoutTown here: re-deriving the layout mid-session
    // moved same-fingerprint twins (Eris market plaza) relative to each
    // other and broke the proximity heuristics tuned on organically-grown
    // layouts (corpus replay: +3 duplicate plaza rooms). Merge nudge scars
    // persist until the one-time v1→v2 load migration heals them.
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /**
   * Deterministically re-embed a town from its link graph, discarding the
   * (possibly collision-scarred) stored coordinates. BFS from the entry
   * room over cardinal links in fixed n,e,s,w,u,d order (ties by room id),
   * stretching on conflict — the same rule live mapping uses — so the
   * result is idempotent for graph-anchored rooms. Rooms reachable only
   * via diagonals/named/one-way links attach at hint cells near a placed
   * neighbor; true floaters keep their old position relative to the root.
   * Runs on pre-v2 save migration and after town merges.
   */
  relayoutTown(town: Town): void {
    if (town.rooms.size === 0) return;
    const ids = [...town.rooms.keys()].sort((a, b) => a - b);
    const rootId =
      town.entryRoomId !== null && town.rooms.has(town.entryRoomId) ? town.entryRoomId : ids[0];
    const root = town.rooms.get(rootId)!;
    const origin = { x: root.x, y: root.y, z: root.z };

    town.grid.clear();
    const placed = new Set<number>();
    const placeAt = (r: TownRoom, x: number, y: number, z: number) => {
      r.x = x;
      r.y = y;
      r.z = z;
      town.grid.set(gridKey(x, y, z), r.id);
      placed.add(r.id);
    };

    // Grow the cardinal skeleton from a placed seed: BFS in fixed direction
    // order, stretching on conflict exactly like live placement.
    const DIR_ORDER: TownDir[] = ['n', 'e', 's', 'w', 'u', 'd'];
    const growFrom = (seedId: number) => {
      const queue = [seedId];
      while (queue.length > 0) {
        const room = town.rooms.get(queue.shift()!)!;
        for (const dir of DIR_ORDER) {
          const destId = room.links[dir];
          if (destId === undefined || placed.has(destId)) continue;
          const dest = town.rooms.get(destId);
          if (!dest) continue;
          const vec = TOWN_DIR_VEC[dir]!;
          // Read the parent's coords now — an earlier stretch may have moved it
          let target = { x: room.x + vec[0], y: room.y + vec[1], z: room.z + vec[2] };
          if (town.grid.has(gridKey(target.x, target.y, target.z))) {
            if (vec[2] === 0) {
              this.stretchToVacate(town, target, dir);
            } else {
              // u/d collision — no lateral axis to stretch; nudge on the floor
              const spot = this.findFreeCell(town, target.x, target.y, target.z);
              this.nudges++;
              target = { x: spot.x, y: spot.y, z: target.z };
            }
          }
          placeAt(dest, target.x, target.y, target.z);
          queue.push(destId);
        }
      }
    };

    // Attach rooms reachable only via diagonal/named/one-way links at a
    // hint cell beside a placed neighbor, then grow the cardinal skeleton
    // hanging off each as it lands. Iterate until no progress.
    const attachAnchored = () => {
      let progress = true;
      while (progress) {
        progress = false;
        for (const id of ids) {
          if (placed.has(id)) continue;
          const room = town.rooms.get(id)!;
          const hint = this.relayoutHint(town, room, placed);
          if (!hint) continue;
          const spot = this.findFreeCell(town, hint.x, hint.y, hint.z);
          if (spot.x !== hint.x || spot.y !== hint.y) this.nudges++;
          placeAt(room, spot.x, spot.y, hint.z);
          growFrom(id);
          progress = true;
        }
      }
    };

    placeAt(root, 0, 0, 0);
    growFrom(rootId);
    attachAnchored();

    // Disconnected fragments: seed each at its old root-relative position
    // and re-grow from there.
    for (const id of ids) {
      if (placed.has(id)) continue;
      const room = town.rooms.get(id)!;
      const tx = room.x - origin.x;
      const ty = room.y - origin.y;
      const tz = room.z - origin.z;
      const spot = this.findFreeCell(town, tx, ty, tz);
      if (spot.x !== tx || spot.y !== ty) this.nudges++;
      placeAt(room, spot.x, spot.y, tz);
      growFrom(id);
      attachAnchored();
    }
  }

  /**
   * Placement hint for a still-unplaced room during relayout: prefer a
   * directional link to/from a placed room (the hint cell mirrors the
   * direction), else land beside a named-link neighbor (findFreeCell will
   * pick the nearest open cell around it).
   */
  private relayoutHint(
    town: Town,
    room: TownRoom,
    placed: Set<number>
  ): { x: number; y: number; z: number } | null {
    for (const [dir, destId] of Object.entries(room.links) as [TownDir, number][]) {
      if (!placed.has(destId)) continue;
      const dest = town.rooms.get(destId);
      if (!dest) continue;
      return this.placementTarget(dest, TOWN_REVERSE[dir]);
    }
    let named: { x: number; y: number; z: number } | null = null;
    for (const otherId of placed) {
      const other = town.rooms.get(otherId);
      if (!other) continue;
      for (const [dir, destId] of Object.entries(other.links) as [TownDir, number][]) {
        if (destId === room.id) return this.placementTarget(other, dir);
      }
      if (!named) {
        for (const destId of Object.values(other.namedLinks)) {
          if (destId === room.id) named = { x: other.x, y: other.y, z: other.z };
        }
      }
    }
    if (!named) {
      for (const destId of Object.values(room.namedLinks)) {
        if (!placed.has(destId)) continue;
        const dest = town.rooms.get(destId);
        if (dest) named = { x: dest.x, y: dest.y, z: dest.z };
      }
    }
    return named;
  }

  // -------------------------------------------------------------------------
  // Pathfinding
  // -------------------------------------------------------------------------

  /**
   * BFS over confirmed links (directional + named). Returns the command
   * sequence, or null when unreachable. Door edges cost the same — the walk
   * executor stops cleanly if a door turns out to be closed.
   */
  findPath(town: Town, fromId: number, toId: number): TownWalkStep[] | null {
    if (fromId === toId) return [];
    const prev = new Map<number, { from: number; step: TownWalkStep }>();
    const queue: number[] = [fromId];
    const seen = new Set<number>([fromId]);

    while (queue.length > 0) {
      const id = queue.shift()!;
      const room = town.rooms.get(id);
      if (!room) continue;
      const neighbors: TownWalkStep[] = [];
      for (const [dir, dest] of Object.entries(room.links) as [TownDir, number][]) {
        neighbors.push({ cmd: dir, toRoomId: dest });
      }
      for (const [cmd, dest] of Object.entries(room.namedLinks)) {
        neighbors.push({ cmd, toRoomId: dest });
      }
      for (const step of neighbors) {
        if (seen.has(step.toRoomId)) continue;
        seen.add(step.toRoomId);
        prev.set(step.toRoomId, { from: id, step });
        if (step.toRoomId === toId) {
          const path: TownWalkStep[] = [];
          let cur = toId;
          while (cur !== fromId) {
            const p = prev.get(cur)!;
            path.unshift(p.step);
            cur = p.from;
          }
          return path;
        }
        queue.push(step.toRoomId);
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Queries for rendering
  // -------------------------------------------------------------------------

  roomsOnFloor(town: Town, z: number): TownRoom[] {
    const out: TownRoom[] = [];
    for (const room of town.rooms.values()) {
      if (room.z === z) out.push(room);
    }
    return out;
  }

  floorsOf(town: Town): number[] {
    const floors = new Set<number>();
    for (const room of town.rooms.values()) floors.add(room.z);
    return [...floors].sort((a, b) => a - b);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * v2: coordinates produced by stretch-on-collision placement (or healed
   * by relayoutTown). Pre-v2 saves carry nudge-scarred layouts and are
   * re-laid-out from the link graph once on load.
   */
  serialize(): unknown {
    return {
      v: 2,
      nextTownId: this.nextTownId,
      pos: this.pos,
      portalDests: Object.fromEntries(this.portalDests),
      volatileSentences: [...this.volatileSentences],
      volatilePending: Object.fromEntries(
        [...this.volatilePending].map(([k, ids]) => [k, [...ids]])
      ),
      towns: [...this.towns.values()].map((t) => ({
        id: t.id,
        name: t.name,
        anchors: t.anchors,
        nextRoomId: t.nextRoomId,
        entryRoomId: t.entryRoomId,
        rooms: [...t.rooms.values()],
      })),
    };
  }

  static deserialize(data: unknown): TownMapStore {
    const store = new TownMapStore();
    if (!data || typeof data !== 'object') return store;
    const d = data as {
      v?: number;
      nextTownId?: number;
      towns?: Array<{
        id: number;
        name: string;
        anchors: Record<string, number>;
        nextRoomId: number;
        entryRoomId: number | null;
        rooms: TownRoom[];
      }>;
    };
    if (!Array.isArray(d.towns)) return store;
    store.nextTownId = d.nextTownId ?? 0;
    for (const t of d.towns) {
      const town: Town = {
        id: t.id,
        name: t.name ?? 'Town',
        anchors:
          t.anchors && typeof t.anchors === 'object' && !Array.isArray(t.anchors) ? t.anchors : {},
        rooms: new Map(),
        grid: new Map(),
        nextRoomId: t.nextRoomId ?? 0,
        entryRoomId: t.entryRoomId ?? null,
      };
      for (const r of t.rooms ?? []) {
        town.rooms.set(r.id, {
          ...r,
          exitsEver: r.exitsEver ?? [...(r.exits ?? [])],
          openDoorDirs: r.openDoorDirs ?? [],
          portal: r.portal ?? false,
          // Classify pre-existing rooms on load; explicit choices persist
          icon: r.icon !== undefined ? r.icon : classifyRoomIcon(r.name ?? '', r.desc ?? ''),
          links: r.links ?? {},
          namedLinks: r.namedLinks ?? {},
          notes: r.notes ?? '',
        });
        town.grid.set(gridKey(r.x, r.y, r.z), r.id);
      }
      store.towns.set(town.id, town);
      if (town.id >= store.nextTownId) store.nextTownId = town.id + 1;
    }
    const pos = (d as { pos?: TownPos | null }).pos;
    if (
      pos &&
      typeof pos.townId === 'number' &&
      typeof pos.roomId === 'number' &&
      store.towns.get(pos.townId)?.rooms.has(pos.roomId)
    ) {
      store.pos = pos;
    }
    const vol = (d as { volatileSentences?: unknown }).volatileSentences;
    if (Array.isArray(vol)) {
      for (const s of vol.slice(0, VOLATILE_MAX)) {
        if (typeof s === 'string') store.volatileSentences.add(s);
      }
    }
    const pending = (d as { volatilePending?: Record<string, unknown> }).volatilePending;
    if (pending && typeof pending === 'object') {
      for (const [k, ids] of Object.entries(pending).slice(0, VOLATILE_PENDING_MAX)) {
        if (Array.isArray(ids)) {
          store.volatilePending.set(k, new Set(ids.filter((n) => typeof n === 'number')));
        }
      }
    }
    const portalDests = (d as { portalDests?: Record<string, TownPos> }).portalDests;
    if (portalDests && typeof portalDests === 'object') {
      for (const [key, dest] of Object.entries(portalDests)) {
        if (
          dest &&
          typeof dest.townId === 'number' &&
          typeof dest.roomId === 'number' &&
          store.towns.get(dest.townId)?.rooms.has(dest.roomId)
        ) {
          store.portalDests.set(key, { townId: dest.townId, roomId: dest.roomId });
        }
      }
    }
    // Pre-v2 layouts were nudge-scarred (and last-write-wins above can
    // silently collapse corrupt duplicate cells) — re-embed once from the
    // link graph. v2 coordinates load verbatim, keeping maps stable.
    if ((d.v ?? 0) < 2) {
      for (const town of store.towns.values()) store.relayoutTown(town);
    }
    return store;
  }
}
