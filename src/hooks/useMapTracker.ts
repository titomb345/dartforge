/**
 * useMapTracker — React hook that ties the room parsers, the localizers
 * and the map stores together: hex wilderness mapping and the town mapper.
 *
 * Every survey paints all visible hexes onto a global grid; position is
 * resolved by correlating each view against the already-painted map (see
 * hexLocalizer.ts). Town room blocks resolve through the town localizer
 * (townLocalizer.ts). Also owns the click-to-walk executors (hexWalk.ts,
 * townWalk.ts; their pacing: walkPacing.ts).
 *
 * Wiring rules this hook must keep in step with the corpus replay engine
 * (scripts/lib/townReplay.ts) — a difference here is a difference between
 * what Bill runs and what every measurement measured:
 *  - each output line goes to dispatchTownLine (the server lines the town
 *    engine reads directly), then the hex RoomParser, then the TownParser;
 *  - every sent command goes to both localizers (each gates itself);
 *  - at every login line the town localizer that resolves the login burst
 *    starts a new session (onLogin) — after a character switch, the new
 *    character's: the stores switch at the login line, before the burst
 *    (mapSession.ts holds the input while the new map loads).
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { RoomParser } from '../lib/roomParser';
import { HexLocalizer } from '../lib/hexLocalizer';
import { HexMapStore, type HexCell, type HexPos } from '../lib/hexMap';
import { getDirectionOffset, type Direction } from '../lib/hexUtils';
import { HexWalkExecutor } from '../lib/hexWalk';
import { TownParser } from '../lib/townParser';
import { TownLocalizer } from '../lib/townLocalizer';
import { dispatchTownLine } from '../lib/townLineEvents';
import { TownWalkExecutor } from '../lib/townWalk';
import { MapStoreSession, type HeldMapInput } from '../lib/mapSession';
import { TownMapStore, hexAnchorKey, type TownRoom } from '../lib/townMap';
import type { HexMarkerType, RoomIconType } from '../lib/mapMarkers';
import { type DataStore } from '../contexts/DataStoreContext';

function mapFilename(character: string): string {
  return `map-${character.toLowerCase()}.json`;
}

/** Idle time before a half-read survey / wrapped exits line is flushed (ms) */
const IDLE_FLUSH_MS = 400;

/** One character's persisted stores (map-<character>.json) */
interface LoadedStores {
  hex: HexMapStore;
  town: TownMapStore;
}

export interface WalkState {
  target: { q: number; r: number };
  remaining: number;
  /** Remaining route as hex coordinates (route preview) */
  path: { q: number; r: number }[];
}

/** Summary of the town the player is (or was last) in */
export interface TownSummary {
  id: number;
  name: string;
  roomId: number;
  roomName: string;
  floor: number;
  roomCount: number;
}

export interface MapTrackerState {
  /** Bumped on every map mutation — triggers canvas redraws */
  version: number;
  currentPos: HexPos | null;
  cellCount: number;
  visitedCount: number;
  islandCount: number;
  /** True when position is unknown (teleported into featureless terrain) */
  lost: boolean;
  /**
   * True while inside a town/building (set by exits-line rooms, cleared by
   * the next wilderness survey). Hex movement doesn't apply indoors.
   */
  indoors: boolean;
  walking: WalkState | null;
  /** Town the player is in (or was last in — persists while outdoors) */
  town: TownSummary | null;
  /** Total towns mapped for this character */
  townCount: number;
  /** Inside a town but the room couldn't be identified */
  townLost: boolean;
  /** The town localizer is tracking a room (false outdoors, with the town
   *  mapper off, and after a login or a re-enable until a block resolves) */
  townActive: boolean;
  /** Active town walk — `path` holds the remaining rooms (route preview) */
  townWalking: { remaining: number; path: number[] } | null;
}

export interface MapTrackerActions {
  /**
   * Feed an ANSI-stripped line (leading whitespace preserved!).
   * `raw` is the same line with ANSI codes, for color-based river detection.
   */
  feedLine: (line: string, raw?: string) => void;
  /** Track an outgoing command (all sends — user, triggers, walk steps) */
  trackCommand: (command: string) => void;
  /**
   * A login line named the character — call it synchronously, BEFORE the
   * rest of the login chunk is filtered: when it is not the character whose
   * map is loaded, the stores switch now and input is held until the map
   * has loaded. (The activeCharacter effect does the same for switches that
   * happen outside a login.)
   */
  beginCharacter: (name: string) => void;
  /** A login line arrived (a new server session) — call it right after
   *  beginCharacter, before the login chunk is filtered */
  noteLogin: () => void;
  /** Cells of the island currently being displayed (the player's island) */
  getCells: () => HexCell[];
  /** Cell lookup on the current island */
  getCellAt: (q: number, r: number) => HexCell | undefined;
  /** Path from the player to a cell on the current island */
  findPathTo: (q: number, r: number) => Direction[] | null;
  /** Walk the player along a path, one confirmed step at a time */
  walkTo: (q: number, r: number) => void;
  cancelWalk: () => void;
  setCellNotes: (q: number, r: number, notes: string) => void;
  /**
   * Clear a hex's blocked-direction AND river/cliff marks (both sides of
   * each edge). Correct data re-detects on the next survey there.
   */
  clearBlockedAt: (q: number, r: number) => void;
  /** Set a hex's landmark marker ('none' = remove, null = back to auto) */
  setMarkerAt: (q: number, r: number, marker: HexMarkerType | 'none' | null) => void;
  clearMap: () => void;
  /** Center request — bumps a counter to signal MapCanvas to re-center */
  centerOnPlayer: () => void;
  centerVersion: number;
  // --- Town mapper ---
  /** All mapped towns (for the browse picker), biggest first */
  getTowns: () => { id: number; name: string; roomCount: number }[];
  /** Rooms of a town (default: the player's town; canvas filters by floor) */
  getTownRooms: (townId?: number) => TownRoom[];
  /** Sorted floor indices of a town (default: the player's town) */
  getTownFloors: (townId?: number) => number[];
  /** Walk the player to a room in the current town, one confirmed step at a time */
  walkToRoom: (roomId: number) => void;
  cancelTownWalk: () => void;
  renameTown: (name: string, townId?: number) => void;
  /** Delete a town's map entirely (default: the player's town) */
  deleteTown: (townId?: number) => void;
  /** Set a room's icon ('none' = remove, null = back to auto) */
  setRoomIcon: (townId: number, roomId: number, icon: RoomIconType | 'none' | null) => void;
}

const neverHeld = () => false;

export function useMapTracker(
  dataStore: DataStore,
  activeCharacter: string | null,
  /** Sends a movement command (hex dirs, room dirs, or named exits like "back") */
  sendDirection: (dir: string) => Promise<void>,
  echo: (message: string) => void,
  /** Keyring slots the auto-door sequence tries (see /door) */
  doorKeys = 5,
  /** Kill switch: false = hex mapping only, town blocks are ignored */
  townMapperEnabled = true,
  /**
   * True while the client holds outgoing commands (the action blocker,
   * during a cast): walks wait instead of queueing steps behind it — queued,
   * they counted as sent, then went out untracked as "manual movement"
   */
  sendsHeld: () => boolean = neverHeld
): MapTrackerState & MapTrackerActions {
  const mapRef = useRef<HexMapStore>(new HexMapStore());
  const localizerRef = useRef<HexLocalizer>(new HexLocalizer(mapRef.current));
  const townMapRef = useRef<TownMapStore>(new TownMapStore());
  const townLocalizerRef = useRef<TownLocalizer>(new TownLocalizer(townMapRef.current));
  const [state, setState] = useState<MapTrackerState>({
    version: 0,
    currentPos: null,
    cellCount: 0,
    visitedCount: 0,
    islandCount: 0,
    lost: false,
    indoors: false,
    walking: null,
    town: null,
    townCount: 0,
    townLost: false,
    townActive: false,
    townWalking: null,
  });
  const [centerVersion, setCenterVersion] = useState(0);

  const parserRef = useRef<RoomParser | null>(null);
  const townParserRef = useRef<TownParser | null>(null);
  // The walk executors (driven by parser events and sends, not renders)
  const hexWalkRef = useRef<HexWalkExecutor | null>(null);
  const townWalkRef = useRef<TownWalkExecutor | null>(null);
  const sessionRef = useRef<MapStoreSession<LoadedStores> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** While held input replays: its own time (the localizers' clock) */
  const clockRef = useRef<number | null>(null);

  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const sendDirectionRef = useRef(sendDirection);
  sendDirectionRef.current = sendDirection;
  const doorKeysRef = useRef(doorKeys);
  doorKeysRef.current = doorKeys;
  const townEnabledRef = useRef(townMapperEnabled);
  townEnabledRef.current = townMapperEnabled;
  const echoRef = useRef(echo);
  echoRef.current = echo;
  const sendsHeldRef = useRef(sendsHeld);
  sendsHeldRef.current = sendsHeld;

  const now = useCallback(() => clockRef.current ?? Date.now(), []);

  // Sync summary state from refs to React state
  const syncState = useCallback(() => {
    const map = mapRef.current;
    let visited = 0;
    for (const c of map.allCells()) {
      if (c.visited) visited++;
    }
    const walk = hexWalkRef.current?.progress ?? null;
    let hexWalkPath: { q: number; r: number }[] = [];
    if (walk && map.pos) {
      let q = map.pos.q;
      let r = map.pos.r;
      hexWalkPath = walk.remaining.map((d) => {
        const o = getDirectionOffset(d);
        q += o.dq;
        r += o.dr;
        return { q, r };
      });
    }
    const townMap = townMapRef.current;
    const townPos = townMap.pos;
    let town: TownSummary | null = null;
    if (townPos) {
      const t = townMap.get(townPos.townId);
      const r = t?.rooms.get(townPos.roomId);
      if (t && r) {
        town = {
          id: t.id,
          name: t.name,
          roomId: r.id,
          roomName: r.name,
          floor: r.z,
          roomCount: t.rooms.size,
        };
      }
    }
    const townWalking = townWalkRef.current?.progress ?? null;
    setState((prev) => ({
      version: prev.version + 1,
      currentPos: map.pos,
      cellCount: map.size,
      visitedCount: visited,
      islandCount: map.islandSizes().size,
      lost: localizerRef.current.lost,
      indoors: localizerRef.current.indoors,
      walking: walk
        ? {
            target: walk.target,
            remaining: walk.remaining.length,
            path: hexWalkPath,
          }
        : null,
      town,
      townCount: townMap.towns.size,
      townLost: townLocalizerRef.current.lost,
      townActive: townLocalizerRef.current.active,
      townWalking,
    }));
  }, []);

  // ---------------------------------------------------------------------
  // Store ownership (whose map the refs hold; load / save / held input)
  // ---------------------------------------------------------------------

  const session = useCallback((): MapStoreSession<LoadedStores> => sessionRef.current!, []);
  const scheduleSave = useCallback(() => session().scheduleSave(), [session]);

  // ---------------------------------------------------------------------
  // Walk executors
  // ---------------------------------------------------------------------

  const hexWalk = useCallback((): HexWalkExecutor => {
    if (!hexWalkRef.current) {
      hexWalkRef.current = new HexWalkExecutor({
        send: (dir) => sendDirectionRef.current(dir),
        sendsHeld: () => sendsHeldRef.current(),
        echo: (message) => echoRef.current(message),
        changed: () => syncState(),
      });
    }
    return hexWalkRef.current;
  }, [syncState]);

  const townWalk = useCallback((): TownWalkExecutor => {
    if (!townWalkRef.current) {
      townWalkRef.current = new TownWalkExecutor({
        map: () => townMapRef.current,
        localizer: () => townLocalizerRef.current,
        send: (cmd) => sendDirectionRef.current(cmd),
        doorKeys: () => doorKeysRef.current,
        sendsHeld: () => sendsHeldRef.current(),
        indoors: () => localizerRef.current.indoors,
        echo: (message) => echoRef.current(message),
        changed: () => syncState(),
        // (Indoors no hex walk is under way: entering stopped it)
        starting: () => hexWalk().cancel(),
      });
    }
    return townWalkRef.current;
  }, [syncState, hexWalk]);

  // ---------------------------------------------------------------------
  // Parser wiring
  // ---------------------------------------------------------------------

  /** Hex the player is parked on — the anchor key for town entries */
  const currentAnchor = useCallback((): string | null => {
    const pos = mapRef.current.pos;
    if (!pos || localizerRef.current.lost) return null;
    return hexAnchorKey(pos.island, pos.q, pos.r);
  }, []);

  const makeTownParser = useCallback(
    () =>
      new TownParser((block) => {
        const res = townLocalizerRef.current.onRoomBlock(block, currentAnchor(), now());
        townWalk().onResolution(res);
        syncState();
        scheduleSave();
      }),
    [currentAnchor, now, townWalk, syncState, scheduleSave]
  );

  const makeHexParser = useCallback(
    () =>
      new RoomParser((event) => {
        const localizer = localizerRef.current;
        switch (event.type) {
          case 'survey': {
            townLocalizerRef.current.onWilderness();
            townWalk().onWilderness();
            const res = localizer.onSurvey({
              art: event.art,
              description: event.description,
              now: now(),
            });
            // Learn "leaving room R puts you on hex H" for instant re-entry
            townLocalizerRef.current.noteOutdoorPosition(currentAnchor());
            hexWalk().onResolution(res);
            syncState();
            scheduleSave();
            break;
          }
          case 'move-failed':
            if (townLocalizerRef.current.active) {
              // Indoors: the failure belongs to a room move, not a hex move
              townLocalizerRef.current.onMoveFailed();
              townWalk().onMoveFailed();
            } else {
              localizer.onMoveFailed(event.hard);
              hexWalk().cancel('movement blocked');
              if (event.hard) {
                syncState();
                scheduleSave();
              }
            }
            break;
          case 'forced-move':
            localizer.trackForcedMove(event.dir, now());
            break;
          case 'town-room':
            localizer.onTownRoom(now());
            hexWalk().cancel('entered a building');
            syncState();
            scheduleSave();
            break;
        }
      }),
    [now, townWalk, currentAnchor, hexWalk, syncState, scheduleSave]
  );

  if (!townParserRef.current) townParserRef.current = makeTownParser();
  if (!parserRef.current) parserRef.current = makeHexParser();

  const clearIdleFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  /**
   * The MUD's trailing prompt has no newline, so a survey (or wrapped exits
   * line) without a clean terminator would wait for the NEXT output burst.
   * Flush once the stream goes idle instead (both flushes are no-ops when
   * nothing is pending) — never while a map loads (held input replays
   * first), and the town parser only while the town mapper is on.
   */
  const armIdleFlush = useCallback(() => {
    clearIdleFlush();
    const townPending = townEnabledRef.current && townParserRef.current?.hasPending();
    if (!parserRef.current?.hasPendingSurvey() && !townPending) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (sessionRef.current?.holding) return;
      parserRef.current?.flushPending();
      if (townEnabledRef.current) townParserRef.current?.flushPending();
    }, IDLE_FLUSH_MS);
  }, [clearIdleFlush]);

  /** One output line through the live pipeline — the replay engine's order */
  const processLine = useCallback(
    (line: string, raw?: string) => {
      if (townEnabledRef.current) {
        const events = dispatchTownLine(line, townLocalizerRef.current, now());
        if (events.length > 0) {
          townWalk().onLineEvents(events);
          // A dark step moves the position, a portal marks its room
          if (events.some((e) => e.kind === 'dark' || e.kind === 'portal')) {
            syncState();
            scheduleSave();
          }
        }
      }
      parserRef.current?.feedLine(line, raw);
      if (townEnabledRef.current) townParserRef.current?.feedLine(line);
      armIdleFlush();
    },
    [now, townWalk, syncState, scheduleSave, armIdleFlush]
  );

  /** One sent command through both localizers */
  const processCommand = useCallback(
    (command: string) => {
      const t = now();
      // A move the walks did not send is the player taking over
      hexWalk().onCommand(command);
      if (townEnabledRef.current) townWalk().onCommand(command, t);
      // Each localizer gates itself (town only queues while indoors, hex
      // only while outdoors), so both can safely see every command.
      if (!townEnabledRef.current || !townLocalizerRef.current.trackCommand(command, t)) {
        localizerRef.current.trackCommand(command, t);
      }
    },
    [now, hexWalk, townWalk]
  );

  /** A new server session: the town localizer that resolves its burst resets */
  const applyLogin = useCallback(() => {
    hexWalk().cancel();
    townWalk().cancel();
    townLocalizerRef.current.onLogin();
    syncState();
  }, [hexWalk, townWalk, syncState]);

  if (!sessionRef.current) {
    sessionRef.current = new MapStoreSession<LoadedStores>({
      load: async (character, stale) => {
        const store = dataStoreRef.current;
        const mapData = await store.get<unknown>(mapFilename(character), 'mapData');
        // (Superseded: skip the second read — the session drops the result)
        if (stale()) return { hex: new HexMapStore(), town: new TownMapStore() };
        const townData = await store.get<unknown>(mapFilename(character), 'townData');
        return { hex: HexMapStore.deserialize(mapData), town: TownMapStore.deserialize(townData) };
      },
      install: (stores) => {
        // A walk planned on the old map, and parser state from its session
        // (a half-read block), must not carry over
        hexWalk().cancel();
        townWalk().cancel();
        clearIdleFlush();
        mapRef.current = stores?.hex ?? new HexMapStore();
        localizerRef.current = new HexLocalizer(mapRef.current);
        townMapRef.current = stores?.town ?? new TownMapStore();
        townLocalizerRef.current = new TownLocalizer(townMapRef.current);
        parserRef.current = makeHexParser();
        townParserRef.current = makeTownParser();
        syncState();
      },
      save: (character) => {
        const store = dataStoreRef.current;
        const file = mapFilename(character);
        store.set(file, 'mapData', mapRef.current.serialize()).catch(console.error);
        store.set(file, 'townData', townMapRef.current.serialize()).catch(console.error);
      },
      replay: (input: HeldMapInput) => {
        clockRef.current = input.at;
        try {
          if (input.kind === 'line') processLine(input.line, input.raw);
          else if (input.kind === 'command') processCommand(input.command);
          else applyLogin();
        } finally {
          clockRef.current = null;
        }
      },
      loadFailed: (character, error) => {
        console.error(`Failed to load ${mapFilename(character)}:`, error);
        echoRef.current(
          `[Map] Could not load ${character}'s map. Mapping goes on without saving; the map is read again at your next login.`
        );
      },
    });
  }

  // Load on character change. A data-dir change (new dataStore identity)
  // flushes and reloads the same character's map from the new place.
  const loadedStoreRef = useRef(dataStore);
  useEffect(() => {
    const dirChanged = loadedStoreRef.current !== dataStore;
    loadedStoreRef.current = dataStore;
    if (activeCharacter) session().begin(activeCharacter, dirChanged);
  }, [activeCharacter, dataStore, session]);

  // Unmount: pending changes go to the owner's file
  useEffect(() => () => session().flush(), [session]);

  // Kill switch flip (either way): stop any town walk, start the town
  // parser over (a block half-read before the flip must not be emitted
  // into a reset localizer) and clear the localizer's transient state
  // (queue, indoors flag). Mapped town data is untouched — turning the
  // mapper back on resumes from the persisted map at the next room block.
  const townEnabledSeenRef = useRef(townMapperEnabled);
  useEffect(() => {
    if (townEnabledSeenRef.current === townMapperEnabled) return;
    townEnabledSeenRef.current = townMapperEnabled;
    townWalk().cancel();
    townParserRef.current = makeTownParser();
    townLocalizerRef.current.reset();
    syncState();
  }, [townMapperEnabled, townWalk, makeTownParser, syncState]);

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  const feedLine = useCallback(
    (line: string, raw?: string) => {
      if (session().hold({ kind: 'line', line, raw, at: Date.now() })) return;
      processLine(line, raw);
    },
    [session, processLine]
  );

  const trackCommand = useCallback(
    (command: string) => {
      if (session().hold({ kind: 'command', command, at: Date.now() })) return;
      processCommand(command);
    },
    [session, processCommand]
  );

  const beginCharacter = useCallback((name: string) => void session().begin(name), [session]);

  const noteLogin = useCallback(() => {
    if (session().hold({ kind: 'login', at: Date.now() })) return;
    applyLogin();
  }, [session, applyLogin]);

  const getCells = useCallback((): HexCell[] => {
    const map = mapRef.current;
    const island = map.pos?.island ?? map.primaryIsland();
    return map.cellsOfIsland(island);
  }, []);

  const getCellAt = useCallback((q: number, r: number): HexCell | undefined => {
    const map = mapRef.current;
    const island = map.pos?.island ?? map.primaryIsland();
    return map.get(island, q, r);
  }, []);

  const findPathTo = useCallback((q: number, r: number): Direction[] | null => {
    const map = mapRef.current;
    if (!map.pos) return null;
    return map.findPath(map.pos, { island: map.pos.island, q, r });
  }, []);

  const walkTo = useCallback(
    (q: number, r: number) => {
      const map = mapRef.current;
      if (!map.pos) return;
      if (localizerRef.current.indoors) {
        echoRef.current('[Map] You are indoors. Step outside to walk.');
        return;
      }
      if (localizerRef.current.lost) {
        echoRef.current('[Map] Cannot walk: position unknown.');
        return;
      }
      const path = map.findPath(map.pos, { island: map.pos.island, q, r });
      if (!path || path.length === 0) {
        echoRef.current('[Map] No known route there.');
        return;
      }
      hexWalk().start(path, { q, r });
    },
    [hexWalk]
  );

  const setCellNotes = useCallback(
    (q: number, r: number, notes: string) => {
      const map = mapRef.current;
      const island = map.pos?.island ?? map.primaryIsland();
      map.setNotes(island, q, r, notes);
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  const clearBlockedAt = useCallback(
    (q: number, r: number) => {
      const map = mapRef.current;
      const island = map.pos?.island ?? map.primaryIsland();
      map.clearBlocked(island, q, r);
      map.clearOverlayMarks(island, q, r);
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  const setMarkerAt = useCallback(
    (q: number, r: number, marker: HexMarkerType | 'none' | null) => {
      const map = mapRef.current;
      const island = map.pos?.island ?? map.primaryIsland();
      map.setMarker(island, q, r, marker);
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  const setRoomIcon = useCallback(
    (townId: number, roomId: number, icon: RoomIconType | 'none' | null) => {
      townMapRef.current.setRoomIcon(townId, roomId, icon);
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  const clearMap = useCallback(() => {
    hexWalk().cancel();
    mapRef.current.clear();
    localizerRef.current = new HexLocalizer(mapRef.current);
    syncState();
    scheduleSave();
  }, [hexWalk, syncState, scheduleSave]);

  const centerOnPlayer = useCallback(() => {
    setCenterVersion((v) => v + 1);
  }, []);

  const cancelWalkAction = useCallback(() => hexWalk().cancel('cancelled'), [hexWalk]);

  // ---------------------------------------------------------------------
  // Town actions
  // ---------------------------------------------------------------------

  const getTowns = useCallback((): { id: number; name: string; roomCount: number }[] => {
    return [...townMapRef.current.towns.values()]
      .map((t) => ({ id: t.id, name: t.name, roomCount: t.rooms.size }))
      .sort((a, b) => b.roomCount - a.roomCount);
  }, []);

  const resolveTown = useCallback((townId?: number) => {
    const map = townMapRef.current;
    if (townId !== undefined) return map.get(townId);
    return map.pos ? map.get(map.pos.townId) : undefined;
  }, []);

  const getTownRooms = useCallback(
    (townId?: number): TownRoom[] => {
      const town = resolveTown(townId);
      return town ? [...town.rooms.values()] : [];
    },
    [resolveTown]
  );

  const getTownFloors = useCallback(
    (townId?: number): number[] => {
      const town = resolveTown(townId);
      return town ? townMapRef.current.floorsOf(town) : [];
    },
    [resolveTown]
  );

  const walkToRoom = useCallback(
    (roomId: number) => {
      if (!townEnabledRef.current) {
        echoRef.current('[Map] Town mapper is disabled (Settings > Map).');
        return;
      }
      // (A walk that starts stops the hex walk: see `starting`)
      townWalk().start(roomId);
    },
    [townWalk]
  );

  const renameTown = useCallback(
    (name: string, townId?: number) => {
      const map = townMapRef.current;
      const id = townId ?? map.pos?.townId;
      if (id === undefined) return;
      map.renameTown(id, name.trim() || 'Town');
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  const deleteTown = useCallback(
    (townId?: number) => {
      const map = townMapRef.current;
      const id = townId ?? map.pos?.townId;
      if (id === undefined) return;
      // Only disturb live tracking when deleting the town we're standing in
      if (map.pos?.townId === id) {
        townWalk().cancel();
        townLocalizerRef.current.reset();
      }
      map.deleteTown(id);
      syncState();
      scheduleSave();
    },
    [townWalk, syncState, scheduleSave]
  );

  const cancelTownWalkAction = useCallback(() => townWalk().cancel('cancelled'), [townWalk]);

  return useMemo(
    () => ({
      ...state,
      feedLine,
      trackCommand,
      beginCharacter,
      noteLogin,
      getCells,
      getCellAt,
      findPathTo,
      walkTo,
      cancelWalk: cancelWalkAction,
      setCellNotes,
      clearBlockedAt,
      setMarkerAt,
      clearMap,
      centerOnPlayer,
      centerVersion,
      getTowns,
      getTownRooms,
      getTownFloors,
      walkToRoom,
      cancelTownWalk: cancelTownWalkAction,
      renameTown,
      deleteTown,
      setRoomIcon,
    }),
    [
      state,
      feedLine,
      trackCommand,
      beginCharacter,
      noteLogin,
      getCells,
      getCellAt,
      findPathTo,
      walkTo,
      cancelWalkAction,
      setCellNotes,
      clearBlockedAt,
      setMarkerAt,
      clearMap,
      centerOnPlayer,
      centerVersion,
      getTowns,
      getTownRooms,
      getTownFloors,
      walkToRoom,
      cancelTownWalkAction,
      renameTown,
      deleteTown,
      setRoomIcon,
    ]
  );
}
