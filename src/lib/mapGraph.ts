/**
 * Map graph — rooms, edges, coordinate assignment, and pathfinding.
 */

import { type HexCoord, type Direction, applyDirection, coordKey, oppositeDirection } from './hexUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapRoom {
  id: string;
  name: string;
  brief: string;
  exits: Partial<Record<Direction, string>>; // direction → target room id
  namedExits: string[];                      // non-compass named exits (e.g. "path", "door")
  coords: HexCoord;
  terrain: 'indoor' | 'wilderness' | 'city' | 'unknown';
  notes: string;
  lastVisited: number;
  visitCount: number;
}

export interface MapGraph {
  rooms: Record<string, MapRoom>;
  currentRoomId: string | null;
}

// ---------------------------------------------------------------------------
// Room identity
// ---------------------------------------------------------------------------

/**
 * Generate a stable room ID from name + sorted exit directions.
 * This deduplicates rooms that share name and exit layout.
 */
export function makeRoomId(name: string, exitDirs: string[]): string {
  const normalized = name.toLowerCase().trim();
  const exits = [...exitDirs].sort().join(',');
  return simpleHash(`${normalized}|${exits}`);
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Graph operations
// ---------------------------------------------------------------------------

export function createGraph(): MapGraph {
  return { rooms: {}, currentRoomId: null };
}

/**
 * Add or update a room in the graph. If the room already exists,
 * updates lastVisited and visitCount. Returns the room.
 */
export function upsertRoom(
  graph: MapGraph,
  id: string,
  name: string,
  brief: string,
  exitDirs: Direction[],
  namedExits: string[],
  terrain: MapRoom['terrain'],
  coords: HexCoord,
): MapRoom {
  const existing = graph.rooms[id];
  if (existing) {
    existing.lastVisited = Date.now();
    existing.visitCount += 1;
    // Update exits if we have new info
    for (const dir of exitDirs) {
      if (!(dir in existing.exits)) {
        existing.exits[dir] = undefined as unknown as string; // placeholder — linked later
      }
    }
    return existing;
  }

  const room: MapRoom = {
    id,
    name,
    brief,
    exits: {},
    namedExits,
    coords,
    terrain,
    notes: '',
    lastVisited: Date.now(),
    visitCount: 1,
  };
  // Initialize exits as empty (targets linked later)
  for (const dir of exitDirs) {
    room.exits[dir] = undefined as unknown as string;
  }
  graph.rooms[id] = room;
  return room;
}

/**
 * Link two rooms by direction. Sets the edge from→to and optionally
 * the reverse edge to→from.
 */
export function linkRooms(
  graph: MapGraph,
  fromId: string,
  toId: string,
  direction: Direction,
): void {
  const from = graph.rooms[fromId];
  const to = graph.rooms[toId];
  if (!from || !to) return;

  from.exits[direction] = toId;

  // Set reverse link if the target has the opposite direction as an exit
  const opposite = oppositeDirection(direction);
  if (opposite in to.exits) {
    to.exits[opposite] = fromId;
  }
}

// ---------------------------------------------------------------------------
// Coordinate assignment
// ---------------------------------------------------------------------------

/**
 * Assign coordinates to a new room based on the previous room and movement direction.
 * Returns the new coordinates. If there's a collision at the expected position,
 * returns the colliding room's ID.
 */
export function assignCoords(
  graph: MapGraph,
  fromRoom: MapRoom,
  direction: Direction,
): { coords: HexCoord; collision?: string } {
  const newCoords = applyDirection(fromRoom.coords, direction);
  const key = coordKey(newCoords);

  // Check for collision
  for (const room of Object.values(graph.rooms)) {
    if (coordKey(room.coords) === key) {
      return { coords: newCoords, collision: room.id };
    }
  }

  return { coords: newCoords };
}

// ---------------------------------------------------------------------------
// Pathfinding — BFS
// ---------------------------------------------------------------------------

export interface PathResult {
  directions: Direction[];
  roomIds: string[];
}

/**
 * BFS shortest path between two rooms.
 */
export function findPath(graph: MapGraph, fromId: string, toId: string): PathResult | null {
  if (fromId === toId) return { directions: [], roomIds: [fromId] };
  if (!graph.rooms[fromId] || !graph.rooms[toId]) return null;

  const visited = new Set<string>([fromId]);
  const queue: { roomId: string; path: { dir: Direction; roomId: string }[] }[] = [
    { roomId: fromId, path: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const room = graph.rooms[current.roomId];
    if (!room) continue;

    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (!targetId || visited.has(targetId)) continue;
      const newPath = [...current.path, { dir: dir as Direction, roomId: targetId }];

      if (targetId === toId) {
        return {
          directions: newPath.map((s) => s.dir),
          roomIds: [fromId, ...newPath.map((s) => s.roomId)],
        };
      }

      visited.add(targetId);
      queue.push({ roomId: targetId, path: newPath });
    }
  }

  return null; // No path found
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface SerializedMapGraph {
  rooms: Record<string, MapRoom>;
  currentRoomId: string | null;
}

export function serializeGraph(graph: MapGraph): SerializedMapGraph {
  return { rooms: graph.rooms, currentRoomId: graph.currentRoomId };
}

export function deserializeGraph(data: SerializedMapGraph): MapGraph {
  return { rooms: data.rooms ?? {}, currentRoomId: data.currentRoomId ?? null };
}
