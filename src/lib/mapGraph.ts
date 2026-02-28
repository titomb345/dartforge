/**
 * Map graph — hex-only rooms, edges, coordinate assignment, pathfinding,
 * and terrain fingerprint indexing for position verification.
 */

import {
  type HexCoord,
  type Direction,
  applyDirection,
  coordKey,
  oppositeDirection,
  COMPASS_DIRECTIONS,
} from './hexUtils';
import type { HexTerrainType } from './hexTerrainPatterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapRoom {
  id: string;
  coords: HexCoord;
  terrain: HexTerrainType;
  description: string;
  landmarks: string[];
  exits: Partial<Record<Direction, string>>; // direction → target room id
  notes: string;
  lastVisited: number;
  visitCount: number;
  /** Terrain fingerprint from hex art (null for rooms discovered without survey) */
  fingerprint: string | null;
}

export interface MapGraph {
  rooms: Record<string, MapRoom>;
  currentRoomId: string | null;
}

// ---------------------------------------------------------------------------
// Fingerprint index — in-memory acceleration structure for position lookup
// ---------------------------------------------------------------------------

export interface FingerprintIndex {
  /** Full fingerprint string → room ID */
  exact: Map<string, string>;
  /** 1-ring prefix → set of room IDs (for ring-agnostic matching) */
  prefix: Map<string, Set<string>>;
}

export interface FingerprintMatch {
  roomId: string;
  matchType: 'exact' | 'prefix';
}

/**
 * Extract the 1-ring prefix from any fingerprint.
 * "plains:woods,hills,water,plains,mountains,desert" → same (already 1-ring)
 * "plains:woods,hills,...:ring2_data" → "plains:woods,hills,..."
 * "plains" (0-ring) → null (not enough data for matching)
 */
function extractOneRingPrefix(fingerprint: string): string | null {
  const parts = fingerprint.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Build a fingerprint index from all rooms in a graph.
 * Called once on load, then maintained incrementally.
 */
export function buildFingerprintIndex(graph: MapGraph): FingerprintIndex {
  const exact = new Map<string, string>();
  const prefix = new Map<string, Set<string>>();

  for (const room of Object.values(graph.rooms)) {
    if (room.fingerprint) {
      indexFingerprint({ exact, prefix }, room.fingerprint, room.id);
    }
  }

  return { exact, prefix };
}

/**
 * Add a single fingerprint to the index.
 */
export function indexFingerprint(
  index: FingerprintIndex,
  fingerprint: string,
  roomId: string
): void {
  index.exact.set(fingerprint, roomId);

  const oneRingPrefix = extractOneRingPrefix(fingerprint);
  if (oneRingPrefix) {
    const set = index.prefix.get(oneRingPrefix) ?? new Set();
    set.add(roomId);
    index.prefix.set(oneRingPrefix, set);
  }
}

/**
 * Remove a room's fingerprint from the index.
 */
export function deindexFingerprint(
  index: FingerprintIndex,
  fingerprint: string,
  roomId: string
): void {
  if (index.exact.get(fingerprint) === roomId) {
    index.exact.delete(fingerprint);
  }

  const oneRingPrefix = extractOneRingPrefix(fingerprint);
  if (oneRingPrefix) {
    const set = index.prefix.get(oneRingPrefix);
    if (set) {
      set.delete(roomId);
      if (set.size === 0) index.prefix.delete(oneRingPrefix);
    }
  }
}

/**
 * Look up a fingerprint in the index.
 * Tries exact match first, then falls back to 1-ring prefix match.
 * Returns null if no match or ambiguous (multiple rooms share same prefix).
 */
export function lookupFingerprint(
  index: FingerprintIndex,
  fingerprint: string
): FingerprintMatch | null {
  // Exact match
  const exactMatch = index.exact.get(fingerprint);
  if (exactMatch) {
    return { roomId: exactMatch, matchType: 'exact' };
  }

  // 1-ring prefix match (handles cross-ring: 2-ring query vs stored 1-ring)
  const oneRingPrefix = extractOneRingPrefix(fingerprint);
  if (oneRingPrefix) {
    // Check if the prefix itself is stored as an exact fingerprint
    const prefixExact = index.exact.get(oneRingPrefix);
    if (prefixExact) {
      return { roomId: prefixExact, matchType: 'prefix' };
    }

    // Check prefix index for rooms sharing this 1-ring pattern
    const prefixMatches = index.prefix.get(oneRingPrefix);
    if (prefixMatches && prefixMatches.size === 1) {
      return { roomId: [...prefixMatches][0], matchType: 'prefix' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Room identity
// ---------------------------------------------------------------------------

/**
 * Generate a stable room ID from hex coordinates.
 */
export function makeHexRoomId(q: number, r: number): string {
  return `hex:${q},${r}`;
}

// ---------------------------------------------------------------------------
// Graph operations
// ---------------------------------------------------------------------------

export function createGraph(): MapGraph {
  return { rooms: {}, currentRoomId: null };
}

/**
 * Add or update a room in the graph. If the room already exists,
 * updates lastVisited, visitCount, terrain, and description.
 * Auto-populates all 6 hex directions as potential exits.
 */
export function upsertRoom(
  graph: MapGraph,
  id: string,
  coords: HexCoord,
  terrain: HexTerrainType,
  description: string,
  landmarks: string[],
  fingerprint?: string | null
): MapRoom {
  const existing = graph.rooms[id];
  if (existing) {
    existing.lastVisited = Date.now();
    existing.visitCount += 1;
    existing.terrain = terrain;
    existing.description = description;
    if (landmarks.length > 0) {
      existing.landmarks = landmarks;
    }
    // Update fingerprint — prefer longer fingerprints (more rings = more specific)
    if (fingerprint) {
      if (!existing.fingerprint || fingerprint.length > existing.fingerprint.length) {
        existing.fingerprint = fingerprint;
      }
    }
    // Ensure all 6 directions exist as potential exits
    for (const dir of COMPASS_DIRECTIONS) {
      if (!(dir in existing.exits)) {
        existing.exits[dir] = undefined as unknown as string;
      }
    }
    return existing;
  }

  const room: MapRoom = {
    id,
    coords,
    terrain,
    description,
    landmarks,
    exits: {},
    notes: '',
    lastVisited: Date.now(),
    visitCount: 1,
    fingerprint: fingerprint ?? null,
  };
  // Initialize all 6 hex directions as potential exits
  for (const dir of COMPASS_DIRECTIONS) {
    room.exits[dir] = undefined as unknown as string;
  }
  graph.rooms[id] = room;
  return room;
}

/**
 * Link two rooms by direction. Sets the edge from→to and
 * the reverse edge to→from.
 */
export function linkRooms(
  graph: MapGraph,
  fromId: string,
  toId: string,
  direction: Direction
): void {
  const from = graph.rooms[fromId];
  const to = graph.rooms[toId];
  if (!from || !to) return;

  from.exits[direction] = toId;
  to.exits[oppositeDirection(direction)] = fromId;
}

// ---------------------------------------------------------------------------
// Coordinate assignment
// ---------------------------------------------------------------------------

/**
 * Compute new coordinates from a source room and movement direction.
 * If a room already exists at the target coordinates, returns its ID as collision.
 */
export function assignCoords(
  graph: MapGraph,
  fromRoom: MapRoom,
  direction: Direction
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

  return null;
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
  const rooms = data.rooms ?? {};

  // Detect old-format map data (pre-hex-only). Old rooms use hash-based IDs,
  // new rooms use "hex:q,r" format. If any room ID doesn't start with "hex:",
  // discard all data and start fresh.
  const roomIds = Object.keys(rooms);
  if (roomIds.length > 0 && roomIds.some((id) => !id.startsWith('hex:'))) {
    return { rooms: {}, currentRoomId: null };
  }

  // Backfill fingerprint field for pre-fingerprint rooms
  for (const room of Object.values(rooms)) {
    if (!('fingerprint' in room)) {
      (room as MapRoom).fingerprint = null;
    }
  }

  return { rooms, currentRoomId: data.currentRoomId ?? null };
}
