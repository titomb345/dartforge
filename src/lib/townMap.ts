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
 *    STRETCHED: the occupant's structure — every placed room linked to it
 *    (stairs included) beyond the cut through the target cell, plus
 *    whatever that structure would land on — shifts one cell along the
 *    movement axis, vacating the natural cell so the new room lands
 *    exactly where the move says. Straight streets stay straight and axis
 *    order stays monotone along every walked link, while streets that
 *    merely cross the cut line stay put unless the moved structure would
 *    land on them (see stretchToVacate). A DIAGONAL arrival into an
 *    occupied cell stretches ONE component axis (a single shift already
 *    frees the cell) — chosen so the displaced occupant's own street moves
 *    as one piece — and the room still lands at its diagonal hint cell.
 *    Placements without a direction at all (u/d, floaters, named exits)
 *    are nudged to the nearest free cell instead. Links — not grid
 *    adjacency — drive pathfinding, so a displaced room stays walkable
 *    either way.
 *
 * Each town is keyed by the hex(es) it was entered from, so the hex map
 * can show which town you're in. z is the floor index (0 = entry level).
 */

import {
  LISTED_NAMED_EXITS,
  TOWN_DIR_VEC,
  TOWN_REVERSE,
  type TownDir,
  type TownRoomBlock,
} from './townParser';
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
  /** Each door's noun per direction at the latest sighting ("gate",
   *  "trapdoor" — see TownExits.doorNouns). Absent when the room has no
   *  door (and on rooms saved before door nouns were recorded). */
  doorNouns?: Partial<Record<TownDir, string>>;
  /** Non-directional exits the exits line lists ("out", "back", "path",
   *  "hole" — see TownExits.named) */
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

/** What a structural merge did (mergeTowns returns null when it refused) */
export interface TownMergeResult {
  /** Rooms in the moved link component */
  moved: number;
  /** ... that were rooms the target already had */
  fused: number;
  /** ... that were new to the target: copied into it, or (same-town merge)
   *  moved beside their aligned neighbors */
  placed: number;
}

const gridKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Every direction, in the fixed order merges walk links (deterministic) */
const ALL_DIRS: TownDir[] = ['n', 'e', 's', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw'];

/** A room's walked directional links as [direction, room id], in ALL_DIRS
 *  order. Link components and merge placement both follow exactly these. */
function directionalLinks(r: TownRoom): [TownDir, number][] {
  const out: [TownDir, number][] = [];
  for (const dir of ALL_DIRS) {
    const id = r.links[dir];
    if (id !== undefined) out.push([dir, id]);
  }
  return out;
}

/** Component cardinal axes of each diagonal, [vertical, horizontal] */
const DIAG_COMPONENTS: Partial<Record<TownDir, [TownDir, TownDir]>> = {
  ne: ['n', 'e'],
  nw: ['n', 'w'],
  se: ['s', 'e'],
  sw: ['s', 'w'],
};

/** Lighting sentences change with the time of day — one definition shared
 *  by descKey (global strip) and stableSentenceCandidates (per-sentence).
 *  Deliberately broad: it also strips "It is raining." / "It is snowing."
 *  (and ~10 rooms' "It is ..." identity prose, which costs nothing) — a
 *  narrower lighting list would have to move those weather lines into
 *  AMBIENT_SENTENCE. */
const LIGHTING_SENTENCE = 'It is [^.]{1,60}\\.';

/**
 * World-state sentences that come and go on a room whose prose otherwise
 * never changes — closed vocabularies mined from both corpora (whitespace
 * collapsed):
 *  - the weather line, always the description's LAST sentence: "The air is
 *    quite warm/humid/chilly/dry." (MUSH 29,525 / 19,671 / 15,072 / 4,381;
 *    no other value exists). Other "The air is ..." sentences ("very moist
 *    here", "freezing cold, but the view is incredible") are room prose and
 *    stay.
 *  - temple portal fire, present only while the portal is active: "A sheet
 *    of silvery-white fire fills the [north ]portal[ and the west
 *    portal]." (Forecourt, Cloister Garth, Portal Chamber).
 * Each is PRESENT or ABSENT, never swapped for another sentence, so the
 * volatile-prose learner (one swapped sentence) can never learn the portal
 * line, nor weather appearing or clearing; and at the end of the text the
 * suffix tolerance doesn't absorb them either. Left in, one room disagreed
 * with itself across portal activations and seasons (portal fire alone:
 * 856 of the legacy replay's 1,616 description disagreements) — Market
 * blocks carrying "The air is quite chilly." against stored descriptions
 * without it became desc floaters, and Garrison Road / Bailey moves were
 * swallowed as re-prints of the wrong segment
 * (session_2026-07-06T02-10-10-259.log:1297-1385). Bill's live map had
 * learned none of the weather lines.
 */
const AMBIENT_SENTENCE =
  'The air is quite (?:warm|humid|chilly|dry)\\.|A sheet of silvery-white fire fills the (?:[a-z]+ )?portal(?: and the [a-z]+ portal)*\\.';
const AMBIENT_SENTENCE_ANYWHERE = new RegExp('\\b(?:' + AMBIENT_SENTENCE + ')', 'g');
const AMBIENT_SENTENCE_WHOLE = new RegExp('^(?:' + AMBIENT_SENTENCE + ')$');

/**
 * Canonical description for identity comparison: lighting (time of day) and
 * ambient world-state sentences stripped, whitespace collapsed. What
 * survives is the room's stable prose — which tells same-fingerprint twins
 * apart (the Eris market plaza: identical "Market" name and exits, but "the
 * northern edge" vs "the western side" mid-description). Too-short results
 * are unusable: comparing them proves nothing, so callers must check
 * descUsable() first.
 */
export function descKey(desc: string): string {
  return desc
    .replace(new RegExp('\\b' + LIGHTING_SENTENCE, 'g'), '')
    .replace(/\s+/g, ' ')
    .replace(AMBIENT_SENTENCE_ANYWHERE, '')
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
 *  lighting and ambient sentences descKey already handles (kept, a
 *  chilly↔warm weather swap wasted two of the 64 learned-sentence slots
 *  per pair). */
const LIGHTING_SENTENCE_START = new RegExp('^' + LIGHTING_SENTENCE);
function stableSentenceCandidates(text: string): string[] {
  return splitSentences(text).filter(
    (s) => s.length >= 20 && !LIGHTING_SENTENCE_START.test(s) && !AMBIENT_SENTENCE_WHOLE.test(s)
  );
}

/** Max learned volatile sentences kept (and serialized) */
const VOLATILE_MAX = 64;
/** Max unpromoted alternation pairs tracked */
const VOLATILE_PENDING_MAX = 200;

export function hexAnchorKey(island: number, q: number, r: number): string {
  return `${island}:${q},${r}`;
}

/**
 * A command that steps into a portal ("enter portal", "enter n portal" —
 * Bill's `port` alias). Never a named exit: a working portal prints its
 * transit line (TownLocalizer.onPortalTransit) and lands in another town,
 * so a portal command that a room block "answered" had failed — every
 * portal named link in the corpus replay was one (Forecourt -[enter
 * portal]-> a phantom Market in Bill's live save).
 */
export function isPortalCommand(cmd: string): boolean {
  return /\bportal\b/.test(cmd);
}

/**
 * Named exits a walk can never take as a plain step: portal commands (see
 * isPortalCommand; entering also needs an "activate" first, and the transit
 * cancels the walk) and boats, whose deck is only there while it is docked
 * ("board galley" fails once it sails; "enter galley" is the same trip).
 */
const UNWALKABLE_NAMED_RE =
  /^(?:board|disembark)\b|^enter (?:\w+ )?(?:galley|ship|boat|ferry|barge|raft|skiff|longship|vessel)$/;
export function walkableNamed(cmd: string): boolean {
  return !isPortalCommand(cmd) && !UNWALKABLE_NAMED_RE.test(cmd);
}

/** A room's door-noun field from a sighting: present only when the exits
 *  line lists a door, so rooms without one (and saves from before door
 *  nouns were recorded) carry no field at all. */
function doorNounsOf(block: TownRoomBlock): Pick<TownRoom, 'doorNouns'> {
  const nouns = block.exits.doorNouns;
  return nouns && Object.keys(nouns).length > 0 ? { doorNouns: { ...nouns } } : {};
}

/**
 * Exits-line ground truth on a recorded link: walking `dir` out of `from`
 * requires `from` to have EVER listed that exit, and `to` to have EVER
 * listed the way back (unless `to` offers named exits — "out"-style
 * returns). A link violating either side is a queue-desync scar, not
 * geometry: an unrecognized soft move failure shifts the FIFO and the next
 * block gets linked in the DEAD move's direction (Soriktos: the Blue
 * Pearl's one-exit Garden Courtyard wired west of the Salon). exitsEver is
 * the union of all sightings, so world-state truncation (portcullis,
 * darkness) only bites rooms sighted exclusively in that state — and a
 * wrongly severed link re-forms on the next real walk.
 */
export function linkContradicted(from: TownRoom, dir: TownDir, to: TownRoom): boolean {
  if (from.exitsEver.length > 0 && !from.exitsEver.includes(dir)) return true;
  return (
    to.exitsEver.length > 0 &&
    !to.exitsEver.includes(TOWN_REVERSE[dir]) &&
    to.namedExits.length === 0
  );
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
   * Teleport return memory: the room the last messaged teleport (plane
   * shift, temple pool — see TownLocalizer.onTeleport) departed from.
   * These teleports are two-way: `plane shift` in the OOC Entry Hall returns
   * the player to the city entrance they left (every DF pair: Eris -> Eris,
   * Soriktos -> Soriktos), the Cave of Spirits' pool to the Sanctum it was
   * entered from — so the next teleport arriving in a room matching this one
   * lands on it. One slot covers both legs: shifting in remembers the
   * entrance, shifting back remembers the hall. Persisted, so a login inside
   * the OOC realm still finds the way back.
   */
  teleportReturn: TownPos | null = null;
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

  /**
   * The town (and room) an anchor key leads into. setAnchor keeps keys
   * unique, but saves from before it can hold one key in several towns (the
   * corpus replay ended with 6: "0:7,5" in Eris, Tobermore's Servants
   * Quarters and a cave; "0:8,10" in three swamp towns) — so with the block
   * in hand, a holder whose anchor room matches it wins: strictly (name +
   * exits) first, then by name, else the first holder. The first holder by
   * id used to win outright, and a mismatch there sent the entry on to the
   * global match, ambiguous at twin-heavy entrances (a fragment town).
   */
  findTownByAnchor(
    anchor: string,
    block?: TownRoomBlock
  ): { town: Town; roomId: number } | undefined {
    let first: { town: Town; roomId: number } | undefined;
    let byName: { town: Town; roomId: number } | undefined;
    for (const town of this.towns.values()) {
      const roomId = town.anchors[anchor];
      const room = roomId !== undefined ? town.rooms.get(roomId) : undefined;
      if (!room) continue;
      const hit = { town, roomId: room.id };
      if (!block || this.matchesStrict(room, block)) return hit;
      if (!byName && this.matches(room, block)) byName = hit;
      first ??= hit;
    }
    return byName ?? first;
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

  /**
   * Remember "entering from this hex lands in this room". One hex leads into
   * one place, so the key moves here from any other town holding it (last
   * writer wins): left in place, a key learned twice — through hex
   * mislocalization, island churn, or a stale login position — kept
   * flip-flopping between towns (session_2026-07-04T03-06-07-253.log: Bone
   * Pit / Cove), and findTownByAnchor read whichever town came first.
   */
  setAnchor(town: Town, anchor: string, roomId: number): void {
    for (const other of this.towns.values()) {
      if (other !== town) delete other.anchors[anchor];
    }
    town.anchors[anchor] = roomId;
  }

  deleteTown(townId: number): void {
    this.towns.delete(townId);
    if (this.pos?.townId === townId) this.pos = null;
    if (this.teleportReturn?.townId === townId) this.teleportReturn = null;
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
    this.teleportReturn = null;
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
   * shift along a single component axis for a diagonal (see
   * stretchToVacate). Without a lateral `via` (u/d, floaters, named exits)
   * the room is nudged to the nearest free cell instead (grid position is
   * presentation; links carry connectivity).
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
      this.stretchToVacate(town, { x, y, z }, via!);
    } else if (occupied && diag) {
      // Diagonal arrival: a single shift along one axis already vacates the
      // hint cell, so stretch only ONE component axis (stretching both
      // spread the map an extra cell in each direction on every diagonal
      // collision). Pick the axis perpendicular to the occupant's own
      // linked run: a vertical stretch moves its whole row as one piece, a
      // horizontal one its whole column — so its street stays intact
      // instead of having the new room wedged into the middle of it.
      const occupant = town.rooms.get(town.grid.get(gridKey(x, y, z))!);
      const runsEW = occupant?.links.e !== undefined || occupant?.links.w !== undefined;
      const runsNS = occupant?.links.n !== undefined || occupant?.links.s !== undefined;
      const [vertical, horizontal] = diag;
      this.stretchToVacate(town, { x, y, z }, runsNS && !runsEW ? horizontal : vertical);
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
      ...doorNounsOf(block),
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
   * Vacate `target` (a cell on floor target.z) for a lateral arrival by
   * shifting the occupant's STRUCTURE one cell along `dir`. The cut is the
   * line through `target` across the movement axis; the structure is every
   * PLACED room reachable from the occupant over directional links
   * (cardinal, u/d and diagonal, followed either way: a one-way passage
   * ties its room on as firmly as a two-way one) without crossing back over
   * the cut — plus, transitively, the structure of any room a shifted room
   * would land on (collision closure), so no shifted room ever lands on one
   * that stays. By construction:
   *  - every shifted room is at/beyond the cut and the from-room is strictly
   *    before it, so the from-room never moves, and nothing lands on
   *    `target` (it would have to start before the cut) while the occupant
   *    leaves it: the cell is free afterward;
   *  - a link changes only where it joins a shifted room to one before the
   *    cut: a subset of the links the half-plane shift distorted;
   *  - linked stairs move with both their floors and stay aligned, while a
   *    floor, a street or a link component that is not linked to the
   *    occupant stays where it is, unless the moved structure would land
   *    on it (the closure then carries it, with its own structure beyond
   *    the cut).
   * The occupant and every landing cell are looked up on their own floor,
   * so callers pass the arrival's floor in target.z: on an upper floor a
   * lookup on floor 0 seeds the wrong room or none, and the new room is
   * then written over the occupant's grid entry (two rooms, one cell).
   * The half-plane shift this replaced moved every placed room beyond the
   * cut, on every floor and in every link component, so each collision
   * opened a gap line through every street it crossed, and nothing ever
   * closed one (Bill's live Eris: 58 of its 179 n/s/e/w links two cells
   * long, the market plaza drawn on gap columns). Frozen-corpus replay, 39
   * collisions under either rule (37 of them the same; the layouts differ,
   * so a few cells are taken by other rooms): rooms shifted 1,419 -> 1,133,
   * stretches reaching 2+ floors 23 -> 14, exact links lengthened 148 -> 82
   * (the Soriktos stables' "Byre", session_2026-07-06T00-03-28-376.log:2933:
   * 67 rooms on 3 floors and 14 links -> 6 rooms and 2 links); end state
   * 82.6% -> 90.0% exact cardinal links with localization identical. That
   * needs graph-lockstep merges (mergeTowns): under the old translated-cell
   * fusion the changed coordinates fused merge copies onto other twins
   * (raw-line replay: 18 more wrong-room assignments, 17 of them walks out
   * of three merge copies wired to the wrong Market and Garrison Road
   * twins).
   * Only rooms present in town.grid move — during relayout the not-yet-
   * placed rooms keep their stale coords untouched.
   */
  private stretchToVacate(
    town: Town,
    target: { x: number; y: number; z: number },
    dir: TownDir
  ): void {
    const vec = TOWN_DIR_VEC[dir];
    if (!vec || vec[2] !== 0) return;
    const [dx, dy] = vec;
    const isPlaced = (r: TownRoom | undefined): r is TownRoom =>
      r !== undefined && town.grid.get(gridKey(r.x, r.y, r.z)) === r.id;
    const seed = town.grid.get(gridKey(target.x, target.y, target.z));
    if (seed === undefined || !isPlaced(town.rooms.get(seed))) return;
    const beyond = (r: TownRoom) =>
      dx === 1
        ? r.x >= target.x
        : dx === -1
          ? r.x <= target.x
          : dy === 1
            ? r.y >= target.y
            : r.y <= target.y;
    // Undirected adjacency over the placed rooms' directional links: an
    // incoming link ties a room to the structure as firmly as its own
    const adjacent = new Map<number, number[]>();
    const join = (a: number, b: number) => {
      let list = adjacent.get(a);
      if (!list) adjacent.set(a, (list = []));
      list.push(b);
    };
    for (const id of town.grid.values()) {
      const r = town.rooms.get(id);
      if (!isPlaced(r)) continue;
      for (const [, n] of directionalLinks(r)) {
        if (n === r.id || !isPlaced(town.rooms.get(n))) continue;
        join(r.id, n);
        join(n, r.id);
      }
    }
    // One flood computes both closures: a room joins through a link to a
    // room already in the set (staying beyond the cut), or because a room
    // in the set would land on it (which is always beyond the cut too)
    const shifted = new Set<number>([seed]);
    const stack = [seed];
    while (stack.length > 0) {
      const r = town.rooms.get(stack.pop()!)!;
      const landsOn = town.grid.get(gridKey(r.x + dx, r.y + dy, r.z));
      if (landsOn !== undefined && !shifted.has(landsOn) && isPlaced(town.rooms.get(landsOn))) {
        shifted.add(landsOn);
        stack.push(landsOn);
      }
      for (const n of adjacent.get(r.id) ?? []) {
        if (shifted.has(n) || !beyond(town.rooms.get(n)!)) continue;
        shifted.add(n);
        stack.push(n);
      }
    }
    const rooms = [...shifted].map((id) => town.rooms.get(id)!);
    for (const r of rooms) town.grid.delete(gridKey(r.x, r.y, r.z));
    for (const r of rooms) {
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
    // from the same DIAG_COMPONENTS table addRoom's collision stretch uses,
    // so the hint cell and the cell the stretch vacates can never disagree.
    const [d1, d2] = DIAG_COMPONENTS[dir]!;
    const v1 = TOWN_DIR_VEC[d1]!;
    const v2 = TOWN_DIR_VEC[d2]!;
    return { x: from.x + v1[0] + v2[0], y: from.y + v1[1] + v2[1], z: from.z };
  }

  /** Record a confirmed transition. The reverse link is inferred (98%+ of
   *  town moves are symmetric) but never overwrites a confirmed link, and
   *  only runs through an exit the destination's own exits line has
   *  listed: one-way passages exist (the Segliz nets drop you north into a
   *  basement whose only exit is up; the Dressing Room's ne into the Eye of
   *  the Temple), and an inferred way back there was a phantom exit walks
   *  routed through all session (7 such links, 227 planned routes in the
   *  corpus replay) until the load cleanse cut it. A destination listing no
   *  direction at all gets none either — the spirit plane's Arena ("There
   *  are no obvious exits.", left only by being transported out) gained a
   *  phantom "s" back to its Armory, which the cleanse cannot see because an
   *  empty exit union reads as "unknown" there. */
  link(_town: Town, from: TownRoom, dir: TownDir, to: TownRoom): void {
    from.links[dir] = to.id;
    const rev = TOWN_REVERSE[dir];
    if (
      to.links[rev] === undefined &&
      to.exitsEver.includes(rev) &&
      !linkContradicted(to, rev, from)
    ) {
      to.links[rev] = from.id;
    }
  }

  linkNamed(from: TownRoom, cmd: string, to: TownRoom): void {
    from.namedLinks[cmd] = to.id;
  }

  /**
   * Record the door in `dir` of the room at `pos` as shut — on both sides:
   * the linked neighbor's door back is the same physical door. Only ever
   * closes: an exits line printed before a close (see
   * TownLocalizer.noteDoorClose) shows the door open, and a wrongly-open
   * door makes the walker send a bare move into it, while a wrongly-closed
   * one only costs a harmless unlock/open.
   */
  markDoorClosed(pos: TownPos, dir: TownDir): void {
    const town = this.towns.get(pos.townId);
    const room = town?.rooms.get(pos.roomId);
    if (!town || !room) return;
    room.openDoorDirs = room.openDoorDirs.filter((d) => d !== dir);
    const otherId = room.links[dir];
    const other = otherId !== undefined ? town.rooms.get(otherId) : undefined;
    if (other) {
      const back = TOWN_REVERSE[dir];
      other.openDoorDirs = other.openDoorDirs.filter((d) => d !== back);
    }
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
    // A description's FIRST sentence is the room's identity headline, never
    // world-state: every corpus-confirmed volatile sentence (market crowds,
    // weather, street traffic) lives mid-description. A swapped headline
    // means the "revisit" was really two look-alike rooms conflated by a
    // wrong link — the Blue Pearl Inn's floors differ only by their
    // "second/third floor" headline, and learning that pair glued the
    // floors together for good (cross-floor links, duplicated bedrooms).
    if (removed[0] === splitSentences(oldDesc)[0] || added[0] === splitSentences(newDesc)[0]) {
      return;
    }
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
   *
   * A "positive" identification is only name-verified, though (matches()):
   * a walked link or a look can land on a word-identical twin — a login
   * resumed on the wrong wing's Bedchamber, and the link to "its" Vestibule
   * then reached the other wing's (session_2026-07-06T20-19-27-332.log:112,
   * "north side" stored, "south side" printed). When the block opens with a
   * different identity headline than the room (see headlinesConflict: no
   * DF-era room ever changed its first sentence), the sighting is someone
   * else's: it neither teaches volatile prose nor replaces the stored
   * description — overwritten, the room disagreed with its own next
   * sighting (07-07T07-13-20-126.log:2777), and a corrupted description
   * vetoes the correct reuse of that room later.
   */
  touchRoom(room: TownRoom, block: TownRoomBlock, now: number, positiveId = false): void {
    const foreign = positiveId && this.headlineTextsConflict(room.desc, block.desc);
    if (positiveId && !foreign && room.desc && block.desc) {
      this.learnVolatileDesc(room.id, room.desc, block.desc);
    }
    room.exits = block.exits.dirs;
    for (const d of block.exits.dirs) {
      if (!room.exitsEver.includes(d)) room.exitsEver.push(d);
    }
    room.doorDirs = block.exits.doorDirs;
    room.openDoorDirs = block.exits.openDoorDirs;
    const nouns = doorNounsOf(block).doorNouns;
    if (nouns) room.doorNouns = nouns;
    else delete room.doorNouns;
    room.namedExits = block.exits.named;
    if (!foreign) {
      room.descFirst = block.descFirst || room.descFirst;
      room.desc = block.desc || room.desc;
    }
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

  /** descKey with learned volatile sentences removed first. Stable prose
   *  can never be learned as volatile (it never appears in a revisit diff),
   *  so the stripped key always retains the room's distinguishing text. */
  private canonDesc(text: string): string {
    if (this.volatileSentences.size === 0) return descKey(text);
    const kept = splitSentences(text).filter((s) => !this.volatileSentences.has(s));
    return descKey(kept.join(' '));
  }

  /**
   * Does the block's description agree with this room's? Only meaningful
   * when both sides are usable (long enough after canonicalization) — this
   * is the tiebreaker that separates same-fingerprint twins in uniform
   * neighborhoods like the Eris market plaza. A DISAGREEMENT is weaker
   * evidence: descriptions embed dynamic content the volatile learning may
   * not know yet, so it never overrides a positive identification (a walked
   * link, a reverse link pointing back, a unique agreement). It does veto a
   * GUESS when both sides are usable — the lone survivor of the frontier's
   * reuse guards, a closest-room pick, a lone look-alike for a named exit's
   * first use: the block itself is saying "not this one", and reusing anyway
   * is how the plaza snapped onto wrong twins and grew false links.
   */
  descAgrees(room: TownRoom, block: TownRoomBlock): boolean {
    return this.descTextsAgree(room.desc, block.desc);
  }

  /** descAgrees for two description texts (merges compare two rooms). */
  private descTextsAgree(x: string, y: string): boolean {
    const a = this.canonDesc(x);
    const b = this.canonDesc(y);
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
   * The link component of `startId`: every room reachable over walked
   * DIRECTIONAL links, followed either way. Rooms without such a path share
   * nothing but a town id — an unexplained arrival plants a floater, and a
   * floater can grow a whole neighborhood of its own — so merges move
   * components, never whole towns. Named exits don't join components: they
   * include portals, boats and teleporting pools between different places
   * (and, until dead named moves are recognized, scars). A missed portal
   * transit once left the portal hub and its spokes named-linked to an Eris
   * fragment, and merging that fragment carried them all into Eris (18
   * rooms of other places, in the raw-line replays).
   */
  componentOf(town: Town, startId: number): Set<number> {
    const adjacent = new Map<number, number[]>();
    const join = (a: number, b: number) => {
      let list = adjacent.get(a);
      if (!list) adjacent.set(a, (list = []));
      list.push(b);
    };
    for (const r of town.rooms.values()) {
      for (const [, id] of directionalLinks(r)) {
        if (!town.rooms.has(id)) continue;
        join(r.id, id);
        join(id, r.id);
      }
    }
    const seen = new Set<number>([startId]);
    const stack = [startId];
    while (stack.length > 0) {
      for (const next of adjacent.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  }

  /**
   * Search for a unique structural match of `room`: in the other towns, and
   * in the OTHER link components of its own town. A floater planted on the
   * wrong floor grows a permanent parallel copy of the town it is in —
   * frontier reuse is floor-exact, so the copy never re-joins (Segliz: a
   * floater one floor up rebuilt Harbor Way, Main Street and the gate there,
   * and the town's hex anchor moved into the copy). Never inside the room's
   * own component: look-alikes you can walk between are twins (mirror
   * wings, word-identical street segments), not duplicates. Returns the
   * match or null (none / ambiguous).
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
    let ownComponent: Set<number> | null = null;
    for (const other of this.towns.values()) {
      for (const cand of other.rooms.values()) {
        if (cand === room) continue;
        if (!this.structuralMatch(town, room, other, cand, minMatches)) continue;
        if (other === town) {
          ownComponent ??= this.componentOf(town, room.id);
          if (ownComponent.has(cand.id)) continue;
        }
        if (found) return null; // ambiguous
        found = { town: other, room: cand };
      }
    }
    return found;
  }

  /**
   * A description's identity HEADLINE: its first sentence once lighting,
   * ambient and learned volatile prose are set aside — or null when the
   * capture can't be trusted to start at one (a fragment-captured tail
   * starts mid-sentence) or it is too short to say anything.
   */
  private headlineOf(desc: string): string | null {
    const first = splitSentences(desc).find(
      (s) =>
        !LIGHTING_SENTENCE_START.test(s) &&
        !AMBIENT_SENTENCE_WHOLE.test(s) &&
        !this.volatileSentences.has(s)
    );
    if (!first || first.length < 20 || !/^[A-Z]/.test(first)) return null;
    return first;
  }

  /**
   * Do two rooms open with DIFFERENT headlines? That is not a stale
   * sighting, it is a different place: mirror-copied floors share every
   * word except the headline (the keep: "This is a landing on the third /
   * fourth floor of the keep."; the Blue Pearl Inn's "second / third floor"
   * hallways). No DF-era room ever changed its first sentence between
   * sightings (0 of 418 corpus rooms with several texts). A headline that
   * reappears anywhere inside the other description is a tail capture
   * starting at a later sentence, not a conflict.
   */
  private headlinesConflict(a: TownRoom, b: TownRoom): boolean {
    return this.headlineTextsConflict(a.desc, b.desc);
  }

  /** headlinesConflict for two description texts (touchRoom compares a
   *  room with a block) */
  private headlineTextsConflict(x: string, y: string): boolean {
    const hx = this.headlineOf(x);
    const hy = this.headlineOf(y);
    if (!hx || !hy || hx === hy) return false;
    if (splitSentences(y).some((s) => s.endsWith(hx))) return false;
    return !splitSentences(x).some((s) => s.endsWith(hy));
  }

  /**
   * Identity check for a pair the lockstep walk reached (same name, same
   * exit of the same physical room). Structure is the evidence; the texts
   * only veto CLEAR differences. Measured with the ground-truth oracle on
   * every pair the merges of five replay modes reached (previous-room probe
   * off, so the merges were big): 101 distinct pairs, 99 the same room.
   *  - exits: the union of every sighting must be the same set. Exit sets
   *    vary only with world state, and in the replayed maps only 6 of 532
   *    rooms ever showed two — every one damaged by an earlier wrong fusion
   *    or link scar (the scrambled OOC corridor, a plaza corner). Refusing
   *    such a pair keeps the walk out of the scrambled links behind it: 2-3
   *    fewer true duplicates in the replays whose merges reach that
   *    corridor than comparing the latest exits or tolerating a subset
   *    (both let the walk fuse a wrong OOC room).
   *  - description: vetoed only when it disagrees in full AND in its
   *    opening. A full-text veto refused 42 of the 99 genuine pairs —
   *    day/night prose the store had not learned as volatile yet
   *    ("Daylight/Starlight streams in...", the market's crowd sentence) —
   *    and every refusal stopped the walk there, so the rest of the
   *    fragment was copied as duplicates (one replay mode grew 19 merges
   *    and 30 duplicate Soriktos rooms).
   * Headlines are checked separately: a conflict refuses the whole merge.
   */
  private mergeIdentityAgrees(a: TownRoom, b: TownRoom): boolean {
    const ea = new Set(a.exitsEver);
    const eb = new Set(b.exitsEver);
    if (ea.size > 0 && eb.size > 0 && (ea.size !== eb.size || [...ea].some((d) => !eb.has(d)))) {
      return false;
    }
    if (!descUsable(a.desc) || !descUsable(b.desc) || this.descTextsAgree(a.desc, b.desc)) {
      return true;
    }
    return !(
      a.descFirst.length >= 20 &&
      b.descFirst.length >= 20 &&
      a.descFirst.slice(0, 40) !== b.descFirst.slice(0, 40)
    );
  }

  /**
   * Do two rooms' exit unions EACH list a direction the other never did?
   * World state only hides exits (a portcullis down, darkness), so one
   * union inside the other can still be one room seen in two states. Two
   * unions that each miss an exit the other lists are two rooms: mirror-
   * image wings (a west-wing hall [e,n,s] and its word-identical east-wing
   * twin [n,s,w]) share name, prose and neighbors, so nothing else tells
   * them apart.
   */
  private exitsContradict(a: TownRoom, b: TownRoom): boolean {
    if (a.exitsEver.length === 0 || b.exitsEver.length === 0) return false;
    return (
      a.exitsEver.some((d) => !b.exitsEver.includes(d)) &&
      b.exitsEver.some((d) => !a.exitsEver.includes(d))
    );
  }

  /**
   * Merge the link component of `fromRoomId` (in town `from`) into town
   * `into`, aligning it onto `intoRoomId` — the same physical room. `from`
   * may be `into` (a duplicate component of one town). Returns null, having
   * changed nothing, when the evidence contradicts itself.
   *
   * Alignment is a LOCKSTEP walk of both link graphs from the matched pair:
   * a fragment room reached through the same exit as a target room, with
   * the same name, on the same relative floor, is that room (one-to-one:
   * a target room is claimed once). Grid cells are presentation — stretches
   * and nudges make two independently grown layouts of one area drift apart
   * within a few rooms — and the old translated-cell fusion copied most
   * fragment rooms as duplicates (corpus: 72 duplicate copies in 7 merges;
   * a 19-room login fragment of the keep fused 1 room and copied 15 that
   * Eris already had, and the copies cascaded into floaters and parallel
   * garrisons) or fused the wrong twin (the west Garrison Road segment onto
   * the east one). The same exit of one room leading to differently named
   * rooms, or a headline conflict anywhere, means the seed was a look-alike
   * (a mirror floor) or a side is scarred: the merge is refused. Pieces the
   * walk cannot reach (the target never walked the link between them)
   * re-anchor on a UNIQUE structural match among the unclaimed target rooms
   * and walk again.
   *
   * The seed pair is held to its own rule. A walk step's only evidence is
   * one shared exit, so it needs equal exit unions (mergeIdentityAgrees).
   * The seed was found by name, two or more agreeing neighbors and the
   * description's opening, so it only has to avoid mirror-image exits
   * (exitsContradict) and a different headline: a room seen with its gate
   * shut is still that room (test-merge-links).
   *
   * Only the matched room's component moves. Moving whole towns dragged all
   * 165 Soriktos rooms into Eris, two floors up (the pair's floor offset
   * applied to the whole town), because a 19-room Eris fragment sat inside
   * Soriktos as a floater component. That was the shared-store replay,
   * which mixed characters' maps; the per-character replay's only
   * multi-component merge carried a 17-room keep component along with the
   * OOC piece that matched (15 duplicate copies), and the live save's Eris
   * holds such an OOC component too.
   *
   * Rooms new to the target are copied (or, in a same-town merge, moved)
   * next to an already-placed neighbor along their own link, so floors
   * follow the u/d links. There is deliberately no coordinate fallback: the
   * only translated-cell fusion left in the corpus (word-identical OOC
   * corridor) was a wrong one. Anchors, the current position, portal memory
   * and entry rooms follow the moved rooms only; the source town survives
   * until it is empty.
   */
  mergeTowns(
    from: Town,
    fromRoomId: number,
    into: Town,
    intoRoomId: number
  ): TownMergeResult | null {
    const fromRoom = from.rooms.get(fromRoomId);
    const intoRoom = into.rooms.get(intoRoomId);
    if (!fromRoom || !intoRoom) return null;
    const sameTown = from === into;
    const moving = this.componentOf(from, fromRoomId);
    if (sameTown && moving.has(intoRoomId)) return null;
    if (this.headlinesConflict(fromRoom, intoRoom) || this.exitsContradict(fromRoom, intoRoom)) {
      return null;
    }
    const order = [...moving].sort((a, b) => a - b);

    // --- Alignment: decided in full before anything is changed ---
    const fused = new Map<number, number>(); // fragment id → target id
    const claimed = new Set<number>();
    const available = (t: TownRoom) => !claimed.has(t.id) && !(sameTown && moving.has(t.id));
    /** Walk both graphs from a seed pair; false (and undone) on a contradiction */
    const lockstep = (seedA: TownRoom, seedB: TownRoom): boolean => {
      const walked: number[] = [];
      const take = (a: TownRoom, b: TownRoom) => {
        fused.set(a.id, b.id);
        claimed.add(b.id);
        walked.push(a.id);
      };
      take(seedA, seedB);
      const queue: [TownRoom, TownRoom][] = [[seedA, seedB]];
      while (queue.length > 0) {
        const [a, b] = queue.shift()!;
        for (const dir of ALL_DIRS) {
          const aId = a.links[dir];
          const bId = b.links[dir];
          if (aId === undefined || bId === undefined || !moving.has(aId)) continue;
          const a2 = from.rooms.get(aId);
          const b2 = into.rooms.get(bId);
          // A link its own rooms' exits lines contradict is a queue-desync
          // scar, not geometry: it proves nothing either way.
          if (!a2 || !b2 || linkContradicted(a, dir, a2) || linkContradicted(b, dir, b2)) continue;
          if (a2.name !== b2.name || this.headlinesConflict(a2, b2)) {
            for (const id of walked) {
              claimed.delete(fused.get(id)!);
              fused.delete(id);
            }
            return false;
          }
          if (fused.has(a2.id) || !available(b2)) continue;
          if (a2.z - a.z !== b2.z - b.z || !this.mergeIdentityAgrees(a2, b2)) continue;
          take(a2, b2);
          queue.push([a2, b2]);
        }
      }
      return true;
    };
    if (!lockstep(fromRoom, intoRoom)) return null;

    // Re-anchor what the walk could not reach: a unique structural match
    // among the unclaimed target rooms, on the pair's relative floor and
    // consistent with every fusion so far, seeds another walk. (A walk that
    // runs into a contradiction undoes itself and the piece is copied — the
    // seed's evidence still stands.) A claimed room is never a candidate:
    // it already IS another fragment room, and the fragment's own look-alike
    // (a second quay behind an alley the target never walked) would
    // collapse onto it. One pass: a second pass only re-tried rooms left
    // ambiguous until another piece claimed a look-alike, the weakest
    // evidence a re-anchor could act on, and it never fused anything in the
    // corpus or in 18,000 fuzzed merges.
    const dz = intoRoom.z - fromRoom.z;
    for (const id of order) {
      if (fused.has(id)) continue;
      const r = from.rooms.get(id)!;
      let match: TownRoom | null = null;
      let ambiguous = false;
      for (const cand of into.rooms.values()) {
        if (!available(cand) || cand.z - r.z !== dz) continue;
        if (!this.structuralMatch(from, r, into, cand, 2)) continue;
        if (match) {
          ambiguous = true;
          break;
        }
        match = cand;
      }
      if (!match || ambiguous) continue;
      const anchor = match;
      const consistent = (Object.entries(r.links) as [TownDir, number][]).every(([dir, n]) => {
        const mapped = fused.get(n);
        return (
          mapped === undefined || anchor.links[dir] === undefined || anchor.links[dir] === mapped
        );
      });
      if (consistent && !this.headlinesConflict(r, anchor) && this.mergeIdentityAgrees(r, anchor)) {
        lockstep(r, anchor);
      }
    }

    // --- Placement: rooms new to the target, beside a placed neighbor ---
    const placed = new Map<number, number>(fused); // fragment id → target id
    if (sameTown) {
      // Every moving room is re-placed or retired: free their cells first
      for (const id of order) {
        const r = from.rooms.get(id)!;
        if (from.grid.get(gridKey(r.x, r.y, r.z)) === id) from.grid.delete(gridKey(r.x, r.y, r.z));
      }
    }
    // [neighbor, the direction it lies in], over the component's own links:
    // the very links componentOf followed (directionalLinks), so the walk
    // below, starting from the fused rooms, reaches every moving room.
    const beside = new Map<number, [number, TownDir][]>();
    const besideOf = (id: number) => {
      let list = beside.get(id);
      if (!list) beside.set(id, (list = []));
      return list;
    };
    for (const id of order) {
      for (const [dir, n] of directionalLinks(from.rooms.get(id)!)) {
        if (!moving.has(n)) continue;
        besideOf(id).push([n, dir]);
        besideOf(n).push([id, TOWN_REVERSE[dir]]);
      }
    }
    const place = (r: TownRoom, at: { x: number; y: number; z: number }) => {
      const spot = this.findFreeCell(into, at.x, at.y, at.z);
      if (spot.x !== at.x || spot.y !== at.y) this.nudges++;
      if (sameTown) {
        r.x = spot.x;
        r.y = spot.y;
        r.z = at.z;
        into.grid.set(gridKey(r.x, r.y, r.z), r.id);
        placed.set(r.id, r.id);
        return;
      }
      // Links start EMPTY and are rebuilt below: the fragment's room ids
      // mean nothing in the target town (a spread copy once SHARED r.links,
      // and every merge wired its copies to unrelated target rooms). Arrays
      // are copied for the same no-aliasing reason.
      const copy: TownRoom = {
        ...r,
        id: into.nextRoomId++,
        x: spot.x,
        y: spot.y,
        z: at.z,
        exits: [...r.exits],
        exitsEver: [...r.exitsEver],
        doorDirs: [...r.doorDirs],
        openDoorDirs: [...r.openDoorDirs],
        ...(r.doorNouns ? { doorNouns: { ...r.doorNouns } } : {}),
        namedExits: [...r.namedExits],
        links: {},
        namedLinks: {},
      };
      into.rooms.set(copy.id, copy);
      into.grid.set(gridKey(copy.x, copy.y, copy.z), copy.id);
      placed.set(r.id, copy.id);
    };
    const queue = order.filter((id) => fused.has(id));
    while (queue.length > 0) {
      const id = queue.shift()!;
      const anchor = into.rooms.get(placed.get(id)!)!;
      for (const [n, dir] of beside.get(id) ?? []) {
        if (placed.has(n)) continue;
        place(from.rooms.get(n)!, this.placementTarget(anchor, dir));
        queue.push(n);
      }
    }

    // --- Links: fused rooms keep theirs and fill gaps; the rest take theirs ---
    const mapId = (id: number) => placed.get(id) ?? (sameTown && !moving.has(id) ? id : undefined);
    for (const id of order) {
      const r = from.rooms.get(id)!;
      const t = into.rooms.get(placed.get(id)!)!;
      const isFused = fused.has(id);
      if (isFused) {
        t.visits += r.visits;
        if (r.lastSeen > t.lastSeen) t.lastSeen = r.lastSeen;
        if (!t.notes && r.notes) t.notes = r.notes;
        if (r.portal) t.portal = true;
        if (t.icon === null) t.icon = r.icon;
        // Exits seen only from the fragment's side are still real exits —
        // without them, the load-time linkContradicted cleanse would sever
        // the very links merged below.
        for (const d of r.exitsEver) {
          if (!t.exitsEver.includes(d)) t.exitsEver.push(d);
        }
      }
      for (const [dir, old] of Object.entries(r.links) as [TownDir, number][]) {
        const mapped = mapId(old);
        if (mapped !== undefined && (!isFused || t.links[dir] === undefined)) t.links[dir] = mapped;
      }
      for (const [cmd, old] of Object.entries(r.namedLinks)) {
        const mapped = mapId(old);
        if (mapped !== undefined && (!isFused || t.namedLinks[cmd] === undefined)) {
          t.namedLinks[cmd] = mapped;
        }
      }
    }
    // Named exits from rooms left behind into the moved component (a portal
    // crossing, a dead named move's scar) follow their room within one town
    // and are dropped across towns — a link never points into another town.
    for (const r of from.rooms.values()) {
      if (moving.has(r.id)) continue;
      for (const [cmd, id] of Object.entries(r.namedLinks)) {
        if (!moving.has(id)) continue;
        if (sameTown) r.namedLinks[cmd] = placed.get(id)!;
        else delete r.namedLinks[cmd];
      }
    }

    // --- Retire the moved rooms from `from` (same town: only the fused) ---
    for (const id of order) {
      if (sameTown && !fused.has(id)) continue;
      const r = from.rooms.get(id)!;
      if (from.grid.get(gridKey(r.x, r.y, r.z)) === id) from.grid.delete(gridKey(r.x, r.y, r.z));
      from.rooms.delete(id);
    }

    // Anchors, entry room and position follow the moved rooms only
    for (const [anchor, roomId] of Object.entries(from.anchors)) {
      const mapped = moving.has(roomId) ? placed.get(roomId) : undefined;
      if (mapped === undefined) continue;
      if (sameTown) {
        from.anchors[anchor] = mapped;
        continue;
      }
      delete from.anchors[anchor];
      if (into.anchors[anchor] === undefined) into.anchors[anchor] = mapped;
    }
    if (from.entryRoomId !== null && moving.has(from.entryRoomId)) {
      if (sameTown) from.entryRoomId = placed.get(from.entryRoomId) ?? from.entryRoomId;
      else from.entryRoomId = from.rooms.size > 0 ? Math.min(...from.rooms.keys()) : null;
    }
    if (this.pos?.townId === from.id && moving.has(this.pos.roomId)) {
      const mapped = placed.get(this.pos.roomId);
      this.pos = mapped !== undefined ? { townId: into.id, roomId: mapped } : null;
    }
    const ret = this.teleportReturn;
    if (ret?.townId === from.id && moving.has(ret.roomId)) {
      const mapped = placed.get(ret.roomId);
      this.teleportReturn = mapped !== undefined ? { townId: into.id, roomId: mapped } : null;
    }

    // Portal destination memory follows (both sides of each entry) — this is
    // how the anchor learned on a first-trip fragment keeps working once the
    // fragment fuses into the real town. Rebuilt into a fresh map so
    // mutation-during-iteration can't happen by construction.
    const remapped = new Map<string, TownPos>();
    for (const [key, dest] of this.portalDests) {
      let newKey = key;
      const [townIdStr, roomIdStr, dirWord] = key.split(':');
      if (Number(townIdStr) === from.id && moving.has(Number(roomIdStr))) {
        const mapped = placed.get(Number(roomIdStr));
        if (mapped === undefined) continue; // drop — source room vanished
        newKey = `${into.id}:${mapped}:${dirWord}`;
      }
      let newDest = dest;
      if (dest.townId === from.id && moving.has(dest.roomId)) {
        const mapped = placed.get(dest.roomId);
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

    // An emptied source goes the way every town is deleted, taking any
    // portal memory still keyed to it along: every moved room's entry was
    // re-keyed above, so what is left names rooms that no longer exist
    // (before component-only moves, the full remap dropped those too).
    if (!sameTown && from.rooms.size === 0) this.deleteTown(from.id);
    // Deliberately NO relayoutTown here: re-deriving the layout mid-session
    // moved same-fingerprint twins (Eris market plaza) relative to each
    // other and broke the proximity heuristics tuned on organically-grown
    // layouts (corpus replay: +3 duplicate plaza rooms).
    return { moved: order.length, fused: fused.size, placed: order.length - fused.size };
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /**
   * Deterministically re-embed a town from its link graph, discarding the
   * (possibly collision-scarred) stored coordinates. BFS from the entry
   * room over cardinal links in fixed n,e,s,w,u,d order (ties by room id),
   * stretching on conflict by the same rule live mapping uses (only the
   * occupant's already re-placed structure moves; see stretchToVacate), so
   * the result is idempotent for graph-anchored rooms. Rooms reachable only
   * via diagonals/named/one-way links attach at hint cells near a placed
   * neighbor; true floaters keep their old position relative to the root.
   * Runs on pre-v2 save migration only — never after merges (see
   * mergeTowns).
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
   * executor stops cleanly if a door turns out to be closed. Edges a walk
   * cannot take are skipped: portal and boat commands (walkableNamed —
   * Bill's live save had 372 of 8,961 Eris routes planned through false
   * "enter portal" links, e.g. Healer's Garden -> Market = nw, nw, e, enter
   * portal), and a direction the room's own exits line has never listed (a
   * queue-desync scar the load cleanse would cut; until then it is a wall).
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
        if (room.exitsEver.length > 0 && !room.exitsEver.includes(dir)) continue;
        neighbors.push({ cmd: dir, toRoomId: dest });
      }
      for (const [cmd, dest] of Object.entries(room.namedLinks)) {
        if (!walkableNamed(cmd)) continue;
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
      teleportReturn: this.teleportReturn,
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
        const room: TownRoom = {
          ...r,
          exitsEver: r.exitsEver ?? [...(r.exits ?? [])],
          openDoorDirs: r.openDoorDirs ?? [],
          portal: r.portal ?? false,
          // Classify pre-existing rooms on load; explicit choices persist
          icon: r.icon !== undefined ? r.icon : classifyRoomIcon(r.name ?? '', r.desc ?? ''),
          links: r.links ?? {},
          namedLinks: r.namedLinks ?? {},
          notes: r.notes ?? '',
        };
        // Optional field: absent unless a door was seen (see doorNounsOf)
        if (
          typeof room.doorNouns !== 'object' ||
          !room.doorNouns ||
          Array.isArray(room.doorNouns)
        ) {
          delete room.doorNouns;
        }
        town.rooms.set(r.id, room);
        town.grid.set(gridKey(r.x, r.y, r.z), r.id);
      }
      store.towns.set(town.id, town);
      if (town.id >= store.nextTownId) store.nextTownId = town.id + 1;
    }
    const validPos = (p: TownPos | null | undefined): TownPos | null =>
      p &&
      typeof p.townId === 'number' &&
      typeof p.roomId === 'number' &&
      store.towns.get(p.townId)?.rooms.has(p.roomId)
        ? p
        : null;
    store.pos = validPos((d as { pos?: TownPos | null }).pos);
    store.teleportReturn = validPos((d as { teleportReturn?: TownPos | null }).teleportReturn);
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
    // Identity headlines can never be world-state prose — drop any learned
    // (or pending) volatile sentence matching a room's first sentence.
    // Heals saves poisoned before learnVolatileDesc gained its headline
    // guard: the Blue Pearl Inn's "second/third floor" hallway headlines
    // got learned as volatile, gluing the inn's floors together.
    const headlines = new Set<string>();
    for (const town of store.towns.values()) {
      for (const r of town.rooms.values()) {
        const first = splitSentences(r.desc ?? '')[0];
        if (first) headlines.add(first);
        const firstShown = splitSentences(r.descFirst ?? '')[0];
        if (firstShown) headlines.add(firstShown);
      }
    }
    for (const s of [...store.volatileSentences]) {
      if (headlines.has(s)) store.volatileSentences.delete(s);
    }
    for (const k of [...store.volatilePending.keys()]) {
      if (k.split('\0').some((s) => headlines.has(s))) store.volatilePending.delete(k);
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
    // Ground-truth link invariant: a lateral move can never change floors,
    // and stairs move exactly one. Every placement path preserves that
    // (placementTarget, findFreeCell, stretch all keep z), so a recorded
    // link violating it can only be a cross-floor merge scar — mirror-
    // identical stacked floors reusing each other's rooms (the rangers'
    // keep bedrooms, the Blue Pearl Inn hallways) before the localizer
    // gained its floor filter. Sever such links; walking the exit again
    // maps the real destination. Must run BEFORE the relayout migration,
    // which embeds rooms by following links.
    for (const town of store.towns.values()) {
      for (const room of town.rooms.values()) {
        for (const [dir, id] of Object.entries(room.links) as [TownDir, number][]) {
          const dest = id !== undefined ? town.rooms.get(id) : undefined;
          if (!dest) continue;
          const dz = dir === 'u' ? 1 : dir === 'd' ? -1 : 0;
          if (dest.z !== room.z + dz) delete room.links[dir];
        }
      }
    }
    // Second link invariant: a link must be possible per both rooms' own
    // exits lines (see linkContradicted). Severs queue-desync scars from
    // unrecognized soft move failures, which healed-over saves carry as
    // wrong-direction links — those links then block the reuse guards from
    // ever re-matching the real room, duplicating it on every revisit.
    for (const town of store.towns.values()) {
      for (const room of town.rooms.values()) {
        for (const [dir, id] of Object.entries(room.links) as [TownDir, number][]) {
          const dest = id !== undefined ? town.rooms.get(id) : undefined;
          if (!dest) continue;
          if (linkContradicted(room, dir, dest)) delete room.links[dir];
        }
      }
    }
    // Named-link invariants: links a FAILED named move forged before the
    // localizer could recognize one ("What ?" consumed nothing; the next
    // block was taken as the move's destination). A portal command is never
    // a named exit (isPortalCommand); a named exit never leads back into its
    // own room (a dead move consuming a look's re-print); "out" / "back" /
    // "exit" lead nowhere from a room whose exits line doesn't list the word
    // (the Armory -[out]-> Bailey after "What ?"). Bill's live save carried
    // three "enter portal" links; one was the ONLY way to a phantom Market
    // component, so a walk there would have sent "enter portal" in the
    // temple Forecourt — a real portal.
    for (const town of store.towns.values()) {
      for (const room of town.rooms.values()) {
        const listsExits = room.exitsEver.length > 0 || room.namedExits.length > 0;
        for (const [cmd, id] of Object.entries(room.namedLinks)) {
          if (
            id === room.id ||
            isPortalCommand(cmd) ||
            (LISTED_NAMED_EXITS.has(cmd) && listsExits && !room.namedExits.includes(cmd))
          ) {
            delete room.namedLinks[cmd];
          }
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
