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
import { parseDirection, type Direction } from '../lib/hexUtils';
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
  walking: WalkState | null;
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
   * Clear a hex's blocked-direction AND river marks (both sides of each
   * edge). Correct data re-detects on the next survey there.
   */
  clearBlockedAt: (q: number, r: number) => void;
  clearMap: () => void;
  /** Center request — bumps a counter to signal MapCanvas to re-center */
  centerOnPlayer: () => void;
  centerVersion: number;
}

export function useMapTracker(
  dataStore: DataStore,
  activeCharacter: string | null,
  sendDirection: (dir: Direction) => Promise<void>,
  echo: (message: string) => void
): MapTrackerState & MapTrackerActions {
  const mapRef = useRef<HexMapStore>(new HexMapStore());
  const localizerRef = useRef<HexLocalizer>(new HexLocalizer(mapRef.current));
  const [state, setState] = useState<MapTrackerState>({
    version: 0,
    currentPos: null,
    cellCount: 0,
    visitedCount: 0,
    islandCount: 0,
    lost: false,
    walking: null,
  });
  const [centerVersion, setCenterVersion] = useState(0);

  const parserRef = useRef<RoomParser | null>(null);
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
  const sendDirectionRef = useRef(sendDirection);
  sendDirectionRef.current = sendDirection;
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
    setState((prev) => ({
      version: prev.version + 1,
      currentPos: map.pos,
      cellCount: map.size,
      visitedCount: visited,
      islandCount: map.islandSizes().size,
      lost: localizerRef.current.lost,
      walking: walk
        ? { target: walk.target, remaining: walk.path.length - walk.confirmed }
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
  // Parser wiring
  // ---------------------------------------------------------------------

  if (!parserRef.current) {
    parserRef.current = new RoomParser((event) => {
      const localizer = localizerRef.current;
      switch (event.type) {
        case 'survey': {
          const res = localizer.onSurvey({
            art: event.art,
            description: event.description,
            now: Date.now(),
          });
          advanceWalk(res);
          syncState();
          scheduleSave();
          break;
        }
        case 'move-failed':
          localizer.onMoveFailed(event.hard);
          if (walkRef.current) cancelWalk('movement blocked');
          if (event.hard) {
            syncState();
            scheduleSave();
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
      }
    };
  }, [activeCharacter, dataStore, syncState]);

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const feedLine = useCallback((line: string, raw?: string) => {
    parserRef.current?.feedLine(line, raw);
    // The MUD's trailing prompt has no newline, so a survey without a clean
    // description terminator would wait for the NEXT output burst. Flush it
    // once the stream goes idle instead.
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (parserRef.current?.hasPendingSurvey()) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        parserRef.current?.flushPending();
      }, 400);
    }
  }, []);

  const trackCommand = useCallback(
    (command: string) => {
      const isDir = parseDirection(command.trim().toLowerCase()) !== null;
      if (isDir && walkRef.current && !walkSendingRef.current) {
        // The user moved manually while auto-walking — stop the walk
        cancelWalk('manual movement');
      }
      localizerRef.current.trackCommand(command, Date.now());
    },
    [cancelWalk]
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
      clearMap,
      centerOnPlayer,
      centerVersion,
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
      clearMap,
      centerOnPlayer,
      centerVersion,
    ]
  );
}
