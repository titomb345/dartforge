/**
 * useMapTracker — React hook that ties the room parser, movement tracker,
 * and map graph together. Manages persistence.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { RoomParser, type ParsedRoom } from '../lib/roomParser';
import { MovementTracker } from '../lib/movementTracker';
import {
  type MapGraph,
  type MapRoom,
  createGraph,
  upsertRoom,
  linkRooms,
  makeRoomId,
  assignCoords,
  findPath,
  serializeGraph,
  deserializeGraph,
  type PathResult,
} from '../lib/mapGraph';
import type { HexCoord } from '../lib/hexUtils';
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
  activeCharacter: string | null,
): MapTrackerState & MapTrackerActions {
  const graphRef = useRef<MapGraph>(createGraph());
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

  // Handle parsed room
  const handleRoom = useCallback((parsed: ParsedRoom) => {
    const graph = graphRef.current;
    const tracker = movementTracker.current;

    // Generate room ID
    const exitDirStrings = parsed.exitDirections.map(String);
    const roomId = makeRoomId(
      parsed.name || parsed.brief,
      [...exitDirStrings, ...parsed.namedExits],
    );

    // Determine coordinates
    const movement = tracker.onRoomParsed(roomId);
    let coords: HexCoord;

    if (graph.rooms[roomId]) {
      // Room already known — use existing coords
      coords = graph.rooms[roomId].coords;
    } else if (movement && graph.rooms[movement.fromRoomId]) {
      // New room reached by movement — assign coords relative to source
      const { coords: newCoords, collision } = assignCoords(
        graph,
        graph.rooms[movement.fromRoomId],
        movement.direction,
      );
      if (collision && collision !== roomId) {
        // Coordinate collision — offset slightly
        coords = { q: newCoords.q, r: newCoords.r + 1, z: newCoords.z };
      } else {
        coords = newCoords;
      }
    } else {
      // No movement context — first room or look command; default to origin
      coords = { q: 0, r: 0, z: 0 };
    }

    // Upsert room
    upsertRoom(
      graph,
      roomId,
      parsed.name,
      parsed.brief,
      parsed.exitDirections,
      parsed.namedExits,
      parsed.terrain,
      coords,
    );

    // Link rooms if we moved
    if (movement && graph.rooms[movement.fromRoomId]) {
      linkRooms(graph, movement.fromRoomId, roomId, movement.direction);
    }

    graph.currentRoomId = roomId;
    syncState();
    scheduleSave();
  }, [syncState, scheduleSave]);

  // Initialize parser
  if (!parserRef.current) {
    parserRef.current = new RoomParser((event) => {
      switch (event.type) {
        case 'room':
          handleRoom(event.room);
          break;
        case 'move-failed':
          movementTracker.current.onMoveFailed();
          break;
        case 'look':
          break;
      }
    });
  }

  // Load/save on character change
  useEffect(() => {
    if (!activeCharacter) return;
    loadedCharRef.current = activeCharacter;

    (async () => {
      const data = await dataStore.get<{ rooms: Record<string, MapRoom>; currentRoomId: string | null }>(
        mapFilename(activeCharacter),
        'mapData',
      );
      if (data) {
        graphRef.current = deserializeGraph(data);
        if (graphRef.current.currentRoomId) {
          movementTracker.current.setCurrentRoom(graphRef.current.currentRoomId);
        }
      } else {
        graphRef.current = createGraph();
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

  const setRoomNotes = useCallback((roomId: string, notes: string) => {
    const room = graphRef.current.rooms[roomId];
    if (room) {
      room.notes = notes;
      syncState();
      scheduleSave();
    }
  }, [syncState, scheduleSave]);

  const clearMap = useCallback(() => {
    graphRef.current = createGraph();
    movementTracker.current = new MovementTracker();
    syncState();
    scheduleSave();
  }, [syncState, scheduleSave]);

  const centerOnPlayer = useCallback(() => {
    setCenterVersion((v) => v + 1);
  }, []);

  return {
    ...state,
    feedLine,
    trackCommand,
    findPathTo,
    getRoom,
    setRoomNotes,
    clearMap,
    centerOnPlayer,
    centerVersion,
  };
}
