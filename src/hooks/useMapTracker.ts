/**
 * useMapTracker — React hook that ties the room parser, movement tracker,
 * and map graph together for hex-only wilderness mapping.
 *
 * Uses terrain fingerprints from hex art to verify and correct positions,
 * preventing drift from accumulated movement tracking errors.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { RoomParser, type ParsedHexRoom } from '../lib/roomParser';
import { MovementTracker } from '../lib/movementTracker';
import {
  type MapGraph,
  type MapRoom,
  type FingerprintIndex,
  createGraph,
  upsertRoom,
  linkRooms,
  makeHexRoomId,
  assignCoords,
  findPath,
  serializeGraph,
  deserializeGraph,
  buildFingerprintIndex,
  indexFingerprint,
  deindexFingerprint,
  lookupFingerprint,
  type PathResult,
} from '../lib/mapGraph';
import { coordKey, type HexCoord } from '../lib/hexUtils';
import { type DataStore } from '../contexts/DataStoreContext';

function mapFilename(character: string): string {
  return `map-${character.toLowerCase()}.json`;
}

export interface MapTrackerState {
  graph: MapGraph;
  currentRoomId: string | null;
  roomCount: number;
}

export interface MapTrackerActions {
  /** Feed a stripped line from MUD output to the room parser */
  feedLine: (line: string) => void;
  /** Track a command being sent to the MUD */
  trackCommand: (command: string) => void;
  /** Find a path between two rooms */
  findPathTo: (targetRoomId: string) => PathResult | null;
  /** Get a room by ID */
  getRoom: (id: string) => MapRoom | undefined;
  /** Update room notes */
  setRoomNotes: (roomId: string, notes: string) => void;
  /** Clear the entire map */
  clearMap: () => void;
  /** Center request — bumps a counter to signal MapCanvas to re-center */
  centerOnPlayer: () => void;
  centerVersion: number;
}

export function useMapTracker(
  dataStore: DataStore,
  activeCharacter: string | null
): MapTrackerState & MapTrackerActions {
  const graphRef = useRef<MapGraph>(createGraph());
  const fpIndexRef = useRef<FingerprintIndex>({ exact: new Map(), prefix: new Map() });
  const [state, setState] = useState<MapTrackerState>({
    graph: graphRef.current,
    currentRoomId: null,
    roomCount: 0,
  });
  const [centerVersion, setCenterVersion] = useState(0);

  const movementTracker = useRef(new MovementTracker());
  const parserRef = useRef<RoomParser | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCharRef = useRef<string | null>(null);

  // Debounced save
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const char = loadedCharRef.current;
      if (!char) return;
      const data = serializeGraph(graphRef.current);
      dataStore.set(mapFilename(char), 'mapData', data).catch(console.error);
    }, 2000);
  }, [dataStore]);

  // Sync state from ref to React state
  const syncState = useCallback(() => {
    const g = graphRef.current;
    setState({
      graph: g,
      currentRoomId: g.currentRoomId,
      roomCount: Object.keys(g.rooms).length,
    });
  }, []);

  // Handle parsed hex room — core positioning logic with fingerprint verification
  const handleHexRoom = useCallback(
    (parsed: ParsedHexRoom) => {
      const graph = graphRef.current;
      const fpIndex = fpIndexRef.current;
      const tracker = movementTracker.current;

      // Get pending movement from tracker
      const prevRoomId = tracker.getCurrentRoomId();
      const movement = prevRoomId ? tracker.onRoomParsed('') : null;

      // Step 1: Compute candidate position from movement chain
      let chainCoords: HexCoord | null = null;
      let chainRoomId: string | null = null;
      let chainCollision: string | undefined;

      if (movement && graph.rooms[movement.fromRoomId]) {
        const fromRoom = graph.rooms[movement.fromRoomId];
        const { coords: newCoords, collision } = assignCoords(graph, fromRoom, movement.direction);
        chainCoords = newCoords;
        chainCollision = collision;
        chainRoomId = collision ?? makeHexRoomId(newCoords.q, newCoords.r);
      }

      // Step 2: Fingerprint verification
      const fpMatch = parsed.fingerprint ? lookupFingerprint(fpIndex, parsed.fingerprint) : null;

      let coords: HexCoord;
      let roomId: string;
      let fingerprintOverrodeChain = false;

      if (fpMatch) {
        // Known fingerprint — use fingerprint position
        const fpRoom = graph.rooms[fpMatch.roomId];
        if (fpRoom) {
          coords = fpRoom.coords;
          roomId = fpMatch.roomId;
          // Check if fingerprint disagrees with chain
          if (chainRoomId && chainRoomId !== fpMatch.roomId) {
            const chainKey = chainCoords ? coordKey(chainCoords) : null;
            const fpKey = coordKey(fpRoom.coords);
            if (chainKey !== fpKey) {
              // Chain drifted — fingerprint wins, don't link from prev room
              fingerprintOverrodeChain = true;
            }
          }
        } else if (chainCoords) {
          // Fingerprint points to a deleted room — fall through to chain logic
          coords = chainCoords;
          roomId = chainCollision ?? makeHexRoomId(chainCoords.q, chainCoords.r);
        } else if (prevRoomId && graph.rooms[prevRoomId]) {
          coords = graph.rooms[prevRoomId].coords;
          roomId = prevRoomId;
        } else {
          coords = { q: 0, r: 0 };
          roomId = makeHexRoomId(0, 0);
        }
      } else {
        // Unknown fingerprint (or no fingerprint) — use chain positioning
        if (chainCoords) {
          coords = chainCoords;
          roomId = chainCollision ?? makeHexRoomId(chainCoords.q, chainCoords.r);
        } else if (prevRoomId && graph.rooms[prevRoomId]) {
          // No movement (look/survey) — stay at current position
          coords = graph.rooms[prevRoomId].coords;
          roomId = prevRoomId;
        } else {
          // First room or broken chain — place at origin
          coords = { q: 0, r: 0 };
          roomId = makeHexRoomId(0, 0);
        }
      }

      // Step 3: Update fingerprint index before upsert (need old fingerprint)
      const oldFingerprint = graph.rooms[roomId]?.fingerprint ?? null;

      // Step 4: Upsert room with fingerprint
      upsertRoom(graph, roomId, coords, parsed.terrain, parsed.description, parsed.landmarks, parsed.fingerprint);

      // Step 5: Incrementally update fingerprint index
      if (parsed.fingerprint) {
        const newFingerprint = graph.rooms[roomId]?.fingerprint;
        if (oldFingerprint && oldFingerprint !== newFingerprint) {
          deindexFingerprint(fpIndex, oldFingerprint, roomId);
        }
        if (newFingerprint) {
          indexFingerprint(fpIndex, newFingerprint, roomId);
        }
      }

      // Step 6: Link rooms if we moved AND fingerprint didn't override chain
      if (
        movement &&
        graph.rooms[movement.fromRoomId] &&
        movement.fromRoomId !== roomId &&
        !fingerprintOverrodeChain
      ) {
        linkRooms(graph, movement.fromRoomId, roomId, movement.direction);
      }

      // Step 7: Update tracker and state
      tracker.setCurrentRoom(roomId);
      graph.currentRoomId = roomId;
      syncState();
      scheduleSave();
    },
    [syncState, scheduleSave]
  );

  // Initialize parser
  if (!parserRef.current) {
    parserRef.current = new RoomParser((event) => {
      switch (event.type) {
        case 'hex-room':
          handleHexRoom(event.room);
          break;
        case 'move-failed':
          movementTracker.current.onMoveFailed();
          break;
      }
    });
  }

  // Load/save on character change
  useEffect(() => {
    if (!activeCharacter) return;
    loadedCharRef.current = activeCharacter;

    (async () => {
      const data = await dataStore.get<{
        rooms: Record<string, MapRoom>;
        currentRoomId: string | null;
      }>(mapFilename(activeCharacter), 'mapData');
      if (data) {
        graphRef.current = deserializeGraph(data);
        fpIndexRef.current = buildFingerprintIndex(graphRef.current);
        if (graphRef.current.currentRoomId) {
          movementTracker.current.setCurrentRoom(graphRef.current.currentRoomId);
        }
      } else {
        graphRef.current = createGraph();
        fpIndexRef.current = { exact: new Map(), prefix: new Map() };
      }
      syncState();
    })().catch(console.error);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeCharacter, dataStore, syncState]);

  const feedLine = useCallback((line: string) => {
    parserRef.current?.feedLine(line);
  }, []);

  const trackCommand = useCallback((command: string) => {
    movementTracker.current.trackCommand(command);
  }, []);

  const findPathTo = useCallback((targetRoomId: string): PathResult | null => {
    const graph = graphRef.current;
    if (!graph.currentRoomId) return null;
    return findPath(graph, graph.currentRoomId, targetRoomId);
  }, []);

  const getRoom = useCallback((id: string): MapRoom | undefined => {
    return graphRef.current.rooms[id];
  }, []);

  const setRoomNotes = useCallback(
    (roomId: string, notes: string) => {
      const room = graphRef.current.rooms[roomId];
      if (room) {
        room.notes = notes;
        syncState();
        scheduleSave();
      }
    },
    [syncState, scheduleSave]
  );

  const clearMap = useCallback(() => {
    graphRef.current = createGraph();
    fpIndexRef.current = { exact: new Map(), prefix: new Map() };
    movementTracker.current = new MovementTracker();
    syncState();
    scheduleSave();
  }, [syncState, scheduleSave]);

  const centerOnPlayer = useCallback(() => {
    setCenterVersion((v) => v + 1);
  }, []);

  return useMemo(
    () => ({
      ...state,
      feedLine,
      trackCommand,
      findPathTo,
      getRoom,
      setRoomNotes,
      clearMap,
      centerOnPlayer,
      centerVersion,
    }),
    [
      state,
      feedLine,
      trackCommand,
      findPathTo,
      getRoom,
      setRoomNotes,
      clearMap,
      centerOnPlayer,
      centerVersion,
    ]
  );
}
