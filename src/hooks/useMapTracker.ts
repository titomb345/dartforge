/**
 * useMapTracker — React hook that ties the room parser, hex localizer,
 * and hex map store together for hex-only wilderness mapping.
 *
 * Every survey paints all visible hexes onto a global grid; position is
 * resolved by correlating each view against the already-painted map
 * (see hexLocalizer.ts). Also owns the click-to-walk executor.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { RoomParser } from '../lib/roomParser';
import { HexLocalizer, type SurveyResolution } from '../lib/hexLocalizer';
import { HexMapStore, type HexCell, type HexPos } from '../lib/hexMap';
import { parseDirection, getDirectionOffset, type Direction } from '../lib/hexUtils';
import { TownParser, PORTAL_TRANSIT_RE, TOWN_DIR_ALIASES, type TownDir } from '../lib/townParser';
import { buildDoorSequence } from '../lib/doorSequence';
import { TownLocalizer, classifyTownCommand, type TownResolution } from '../lib/townLocalizer';
import { TownMapStore, hexAnchorKey, type TownRoom, type TownWalkStep } from '../lib/townMap';
import type { HexMarkerType, RoomIconType } from '../lib/mapMarkers';
import { type DataStore } from '../contexts/DataStoreContext';

function mapFilename(character: string): string {
  return `map-${character.toLowerCase()}.json`;
}

/** Max ms to wait for a survey to confirm a walk step before aborting */
const WALK_STEP_TIMEOUT = 8_000;
/**
 * Moves kept in flight ahead of survey confirmation. Two hides a full
 * server round-trip per hex (like a player spamming directions — the
 * localizer's pending-move queue is built for it) while capping the
 * overshoot after a mid-walk block to a single hex.
 */
const WALK_PIPELINE = 2;

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

export function useMapTracker(
  dataStore: DataStore,
  activeCharacter: string | null,
  /** Sends a movement command (hex dirs, room dirs, or named exits like "back") */
  sendDirection: (dir: string) => Promise<void>,
  echo: (message: string) => void,
  /** Keyring slots the auto-door sequence tries (see /door) */
  doorKeys = 5,
  /** Kill switch: false = hex mapping only, town blocks are ignored */
  townMapperEnabled = true
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
    townWalking: null,
  });
  const [centerVersion, setCenterVersion] = useState(0);

  const parserRef = useRef<RoomParser | null>(null);
  const townParserRef = useRef<TownParser | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCharRef = useRef<string | null>(null);

  // Walk executor state (refs — driven by parser events, not renders)
  const walkRef = useRef<{
    path: Direction[];
    /** Steps confirmed by surveys */
    confirmed: number;
    /** Steps sent to the MUD (sent - confirmed = in flight) */
    sent: number;
    target: { q: number; r: number };
    timeout: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const walkSendingRef = useRef(false);
  // Town walk executor state — same shape, steps carry commands not dirs.
  // Each step may expand to several commands (door steps send the full
  // unlock/open/move/close/lock sequence, built at send time from the
  // door's freshest known state).
  const townWalkRef = useRef<{
    steps: (TownWalkStep & { cmds: string[]; door?: { dir: TownDir; fromId: number } })[];
    confirmed: number;
    sent: number;
    townId: number;
    targetRoomId: number;
    timeout: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const townWalkSendingRef = useRef(false);
  const sendDirectionRef = useRef(sendDirection);
  sendDirectionRef.current = sendDirection;
  const doorKeysRef = useRef(doorKeys);
  doorKeysRef.current = doorKeys;
  const townEnabledRef = useRef(townMapperEnabled);
  townEnabledRef.current = townMapperEnabled;
  const echoRef = useRef(echo);
  echoRef.current = echo;

  // Debounced save
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const char = loadedCharRef.current;
      if (!char) return;
      const data = mapRef.current.serialize();
      dataStore.set(mapFilename(char), 'mapData', data).catch(console.error);
      const townData = townMapRef.current.serialize();
      dataStore.set(mapFilename(char), 'townData', townData).catch(console.error);
    }, 2000);
  }, [dataStore]);

  // Sync summary state from refs to React state
  const syncState = useCallback(() => {
    const map = mapRef.current;
    let visited = 0;
    for (const c of map.allCells()) {
      if (c.visited) visited++;
    }
    const walk = walkRef.current;
    let hexWalkPath: { q: number; r: number }[] = [];
    if (walk && map.pos) {
      let q = map.pos.q;
      let r = map.pos.r;
      hexWalkPath = walk.path.slice(walk.confirmed).map((d) => {
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
    const townWalk = townWalkRef.current;
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
            remaining: walk.path.length - walk.confirmed,
            path: hexWalkPath,
          }
        : null,
      town,
      townCount: townMap.towns.size,
      townLost: townLocalizerRef.current.lost,
      townWalking: townWalk
        ? {
            remaining: townWalk.steps.length - townWalk.confirmed,
            path: townWalk.steps.slice(townWalk.confirmed).map((s) => s.toRoomId),
          }
        : null,
    }));
  }, []);

  // ---------------------------------------------------------------------
  // Walk executor
  // ---------------------------------------------------------------------

  const cancelWalk = useCallback(
    (reason?: string) => {
      const walk = walkRef.current;
      if (!walk) return;
      if (walk.timeout) clearTimeout(walk.timeout);
      walkRef.current = null;
      if (reason) echoRef.current(`[Map] Walk stopped — ${reason}`);
      syncState();
    },
    [syncState]
  );

  const armWalkTimeout = useCallback(() => {
    const walk = walkRef.current;
    if (!walk) return;
    if (walk.timeout) clearTimeout(walk.timeout);
    walk.timeout = setTimeout(() => cancelWalk('no response from the MUD'), WALK_STEP_TIMEOUT);
  }, [cancelWalk]);

  /**
   * Send walk steps until WALK_PIPELINE moves are in flight. Sends are
   * chained one at a time so commands reach the MUD in path order.
   */
  const pumpWalkSends = useCallback(() => {
    const walk = walkRef.current;
    if (!walk) return;
    if (walk.sent >= walk.path.length) return;
    if (walk.sent - walk.confirmed >= WALK_PIPELINE) return;
    const dir = walk.path[walk.sent];
    walk.sent += 1;
    walkSendingRef.current = true;
    Promise.resolve(sendDirectionRef.current(dir))
      .catch(() => cancelWalk('send failed'))
      .finally(() => {
        walkSendingRef.current = false;
        // Top up the pipeline (only refills if this walk is still active)
        if (walkRef.current) pumpWalkSends();
      });
  }, [cancelWalk]);

  /** Called after each survey resolution while a walk is active. */
  const advanceWalk = useCallback(
    (res: SurveyResolution) => {
      const walk = walkRef.current;
      if (!walk) return;
      const pos = res.pos;
      if (!pos || res.kind === 'lost') {
        cancelWalk('position lost');
        return;
      }
      if (res.moved === null && res.kind === 'stationary') {
        // A manual survey mid-walk — our step hasn't resolved yet; keep waiting
        armWalkTimeout();
        return;
      }
      if (res.moved !== walk.path[walk.confirmed]) {
        cancelWalk('unexpected movement');
        return;
      }
      walk.confirmed += 1;
      if (walk.confirmed >= walk.path.length) {
        if (walk.timeout) clearTimeout(walk.timeout);
        walkRef.current = null;
        echoRef.current('[Map] Arrived.');
        syncState();
        return;
      }
      armWalkTimeout();
      pumpWalkSends();
      syncState();
    },
    [cancelWalk, armWalkTimeout, pumpWalkSends, syncState]
  );

  // ---------------------------------------------------------------------
  // Town walk executor (right-click-to-walk through room graphs)
  // ---------------------------------------------------------------------

  const cancelTownWalk = useCallback(
    (reason?: string) => {
      const walk = townWalkRef.current;
      if (!walk) return;
      if (walk.timeout) clearTimeout(walk.timeout);
      townWalkRef.current = null;
      if (reason) echoRef.current(`[Map] Walk stopped — ${reason}`);
      syncState();
    },
    [syncState]
  );

  const armTownWalkTimeout = useCallback(() => {
    const walk = townWalkRef.current;
    if (!walk) return;
    if (walk.timeout) clearTimeout(walk.timeout);
    walk.timeout = setTimeout(() => cancelTownWalk('no response from the MUD'), WALK_STEP_TIMEOUT);
  }, [cancelTownWalk]);

  const pumpTownWalkSends = useCallback(() => {
    const walk = townWalkRef.current;
    if (!walk) return;
    if (walk.sent >= walk.steps.length) return;
    if (walk.sent - walk.confirmed >= WALK_PIPELINE) return;
    const step = walk.steps[walk.sent];
    let cmds = step.cmds;
    if (step.door) {
      // Door commands are built here (not at plan time) from the from-room's
      // freshest exits line, so hold the step until arrival there is
      // confirmed — the arrival block carries the live open/closed state.
      // The pump re-runs on every confirmation, so a held step self-releases.
      if (walk.confirmed < walk.sent) return;
      const fromRoom = townMapRef.current.get(walk.townId)?.rooms.get(step.door.fromId);
      const wasOpen = fromRoom?.openDoorDirs.includes(step.door.dir) ?? false;
      // A door found standing open is left as found: walk straight through,
      // no closing/locking behind. Only doors we opened ourselves (or whose
      // state is unknown) get the full unlock/open/move/close/lock sequence.
      if (!wasOpen) cmds = buildDoorSequence(step.cmd, doorKeysRef.current) ?? [step.cmd];
    }
    walk.sent += 1;
    townWalkSendingRef.current = true;
    (async () => {
      for (const cmd of cmds) {
        await sendDirectionRef.current(cmd);
      }
    })()
      .catch(() => cancelTownWalk('send failed'))
      .finally(() => {
        townWalkSendingRef.current = false;
        if (townWalkRef.current) pumpTownWalkSends();
      });
  }, [cancelTownWalk]);

  /** Called after each town room resolution while a town walk is active. */
  const advanceTownWalk = useCallback(
    (res: TownResolution) => {
      const walk = townWalkRef.current;
      if (!walk) return;
      if (res.merged) {
        // Room ids were remapped by a town merge — the plan is stale
        cancelTownWalk('map changed');
        return;
      }
      if (!res.pos || res.kind === 'lost') {
        cancelTownWalk('position lost');
        return;
      }
      if (res.kind === 'stationary' && res.moved === null) {
        // A room re-print (look, light change) — our step hasn't resolved
        // yet; keep waiting instead of aborting the walk.
        armTownWalkTimeout();
        return;
      }
      const expected = walk.steps[walk.confirmed];
      if (res.pos.roomId !== expected.toRoomId) {
        cancelTownWalk('unexpected movement');
        return;
      }
      walk.confirmed += 1;
      if (walk.confirmed >= walk.steps.length) {
        if (walk.timeout) clearTimeout(walk.timeout);
        townWalkRef.current = null;
        echoRef.current('[Map] Arrived.');
        syncState();
        return;
      }
      armTownWalkTimeout();
      pumpTownWalkSends();
      syncState();
    },
    [cancelTownWalk, armTownWalkTimeout, pumpTownWalkSends, syncState]
  );

  // ---------------------------------------------------------------------
  // Parser wiring
  // ---------------------------------------------------------------------

  /** Hex the player is parked on — the anchor key for town entries */
  const currentAnchor = useCallback((): string | null => {
    const pos = mapRef.current.pos;
    if (!pos || localizerRef.current.lost) return null;
    return hexAnchorKey(pos.island, pos.q, pos.r);
  }, []);

  if (!townParserRef.current) {
    townParserRef.current = new TownParser((block) => {
      const res = townLocalizerRef.current.onRoomBlock(block, currentAnchor(), Date.now());
      advanceTownWalk(res);
      syncState();
      scheduleSave();
    });
  }

  if (!parserRef.current) {
    parserRef.current = new RoomParser((event) => {
      const localizer = localizerRef.current;
      switch (event.type) {
        case 'survey': {
          townLocalizerRef.current.onWilderness();
          if (townWalkRef.current) cancelTownWalk('left the building');
          const res = localizer.onSurvey({
            art: event.art,
            description: event.description,
            now: Date.now(),
          });
          // Learn "leaving room R puts you on hex H" for instant re-entry
          townLocalizerRef.current.noteOutdoorPosition(currentAnchor());
          advanceWalk(res);
          syncState();
          scheduleSave();
          break;
        }
        case 'move-failed':
          if (townLocalizerRef.current.active) {
            // Indoors: the failure belongs to a room move, not a hex move
            townLocalizerRef.current.onMoveFailed();
            if (townWalkRef.current) cancelTownWalk('movement blocked');
          } else {
            localizer.onMoveFailed(event.hard);
            if (walkRef.current) cancelWalk('movement blocked');
            if (event.hard) {
              syncState();
              scheduleSave();
            }
          }
          break;
        case 'forced-move':
          localizer.trackForcedMove(event.dir, Date.now());
          break;
        case 'town-room':
          localizer.onTownRoom(Date.now());
          if (walkRef.current) cancelWalk('entered a building');
          syncState();
          scheduleSave();
          break;
      }
    });
  }

  // Load/save on character change
  useEffect(() => {
    if (!activeCharacter) return;
    loadedCharRef.current = activeCharacter;

    (async () => {
      const data = await dataStore.get<unknown>(mapFilename(activeCharacter), 'mapData');
      mapRef.current = HexMapStore.deserialize(data);
      localizerRef.current = new HexLocalizer(mapRef.current);
      const townData = await dataStore.get<unknown>(mapFilename(activeCharacter), 'townData');
      townMapRef.current = TownMapStore.deserialize(townData);
      townLocalizerRef.current = new TownLocalizer(townMapRef.current);
      syncState();
    })().catch(console.error);

    const char = activeCharacter;
    return () => {
      // Flush any pending debounced save for this character before switching
      // away (the map ref still holds this character's data at cleanup time)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const data = mapRef.current.serialize();
        dataStore.set(mapFilename(char), 'mapData', data).catch(console.error);
        const townData = townMapRef.current.serialize();
        dataStore.set(mapFilename(char), 'townData', townData).catch(console.error);
      }
    };
  }, [activeCharacter, dataStore, syncState]);

  // Kill switch flip: stop any town walk and clear transient localizer
  // state (queue, indoors flag). Mapped town data is untouched — turning
  // the mapper back on resumes exactly where the persisted map left off.
  useEffect(() => {
    if (townMapperEnabled) return;
    cancelTownWalk();
    townLocalizerRef.current.reset();
    syncState();
  }, [townMapperEnabled, cancelTownWalk, syncState]);

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const feedLine = useCallback(
    (line: string, raw?: string) => {
      parserRef.current?.feedLine(line, raw);
      if (townEnabledRef.current) {
        townParserRef.current?.feedLine(line);
        // Portal transits teleport between towns — the next room block must
        // start a fresh town entry instead of gluing into the current town.
        // The named portal ("north") keys the destination memory.
        const portal = PORTAL_TRANSIT_RE.exec(line);
        if (portal) {
          townLocalizerRef.current.onPortalTransit(portal[1] ?? null);
          if (townWalkRef.current) cancelTownWalk('stepped through a portal');
        }
      }
      // The MUD's trailing prompt has no newline, so a survey (or wrapped
      // exits line) without a clean terminator would wait for the NEXT output
      // burst. Flush once the stream goes idle instead. (Both flushes are
      // no-ops when nothing is pending.)
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (parserRef.current?.hasPendingSurvey() || townParserRef.current?.hasPending()) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          parserRef.current?.flushPending();
          townParserRef.current?.flushPending();
        }, 400);
      }
    },
    [cancelTownWalk]
  );

  const trackCommand = useCallback(
    (command: string) => {
      const now = Date.now();
      const isDir = parseDirection(command.trim().toLowerCase()) !== null;
      if (isDir && walkRef.current && !walkSendingRef.current) {
        // The user moved manually while auto-walking — stop the walk
        cancelWalk('manual movement');
      }
      if (
        townWalkRef.current &&
        !townWalkSendingRef.current &&
        classifyTownCommand(command, now) !== null
      ) {
        cancelTownWalk('manual movement');
      }
      // Each localizer gates itself (town only queues while indoors, hex
      // only while outdoors), so both can safely see every command.
      if (!townEnabledRef.current || !townLocalizerRef.current.trackCommand(command, now)) {
        localizerRef.current.trackCommand(command, now);
      }
    },
    [cancelWalk, cancelTownWalk]
  );

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
        echoRef.current('[Map] You are indoors — step outside to walk.');
        return;
      }
      if (localizerRef.current.lost) {
        echoRef.current('[Map] Cannot walk — position unknown.');
        return;
      }
      const path = map.findPath(map.pos, { island: map.pos.island, q, r });
      if (!path || path.length === 0) {
        echoRef.current('[Map] No known route there.');
        return;
      }
      cancelWalk();
      walkRef.current = { path, confirmed: 0, sent: 0, target: { q, r }, timeout: null };
      echoRef.current(`[Map] Walking ${path.length} hex${path.length === 1 ? '' : 'es'}...`);
      syncState();
      armWalkTimeout();
      pumpWalkSends();
    },
    [cancelWalk, armWalkTimeout, pumpWalkSends, syncState]
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
    cancelWalk();
    mapRef.current.clear();
    localizerRef.current = new HexLocalizer(mapRef.current);
    syncState();
    scheduleSave();
  }, [cancelWalk, syncState, scheduleSave]);

  const centerOnPlayer = useCallback(() => {
    setCenterVersion((v) => v + 1);
  }, []);

  const cancelWalkAction = useCallback(() => cancelWalk('cancelled'), [cancelWalk]);

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
      const map = townMapRef.current;
      const pos = map.pos;
      if (!pos) return;
      if (!townLocalizerRef.current.active) {
        echoRef.current('[Map] You are outdoors — enter the town to walk its rooms.');
        return;
      }
      if (townLocalizerRef.current.lost) {
        echoRef.current('[Map] Cannot walk — room unknown.');
        return;
      }
      const town = map.get(pos.townId);
      if (!town) return;
      const steps = map.findPath(town, pos.roomId, roomId);
      if (!steps || steps.length === 0) {
        echoRef.current('[Map] No known route there.');
        return;
      }
      // Mark door crossings — the room being left knows which of its exits
      // are doors from its own exits line. The commands themselves (full
      // unlock/open/move/close/lock, or a plain move through a door found
      // standing open) are built at send time from the freshest door state.
      let doors = 0;
      const enriched = steps.map((s, i) => {
        const fromId = i === 0 ? pos.roomId : steps[i - 1].toRoomId;
        const fromRoom = town.rooms.get(fromId);
        const dir = TOWN_DIR_ALIASES[s.cmd] as TownDir | undefined;
        if (fromRoom && dir && fromRoom.doorDirs.includes(dir)) {
          doors++;
          return { ...s, cmds: [s.cmd], door: { dir, fromId } };
        }
        return { ...s, cmds: [s.cmd] };
      });
      cancelWalk();
      cancelTownWalk();
      townWalkRef.current = {
        steps: enriched,
        confirmed: 0,
        sent: 0,
        townId: pos.townId,
        targetRoomId: roomId,
        timeout: null,
      };
      echoRef.current(
        `[Map] Walking ${steps.length} room${steps.length === 1 ? '' : 's'}${doors > 0 ? ` (${doors} door${doors === 1 ? '' : 's'})` : ''}...`
      );
      syncState();
      armTownWalkTimeout();
      pumpTownWalkSends();
    },
    [cancelWalk, cancelTownWalk, armTownWalkTimeout, pumpTownWalkSends, syncState]
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
        cancelTownWalk();
        townLocalizerRef.current.reset();
      }
      map.deleteTown(id);
      syncState();
      scheduleSave();
    },
    [cancelTownWalk, syncState, scheduleSave]
  );

  const cancelTownWalkAction = useCallback(() => cancelTownWalk('cancelled'), [cancelTownWalk]);

  return useMemo(
    () => ({
      ...state,
      feedLine,
      trackCommand,
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
