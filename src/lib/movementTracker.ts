/**
 * Movement tracker — detects direction commands and tracks pending movement.
 *
 * The flow:
 * 1. User sends a command → check if it's a direction
 * 2. If direction, record as "pending movement"
 * 3. When a room is parsed, the pending movement links the previous room to the new one
 * 4. If movement fails ("no exit in that direction"), clear pending movement
 */

import { type Direction, parseDirection } from './hexUtils';

export interface PendingMovement {
  direction: Direction;
  fromRoomId: string;
  timestamp: number;
}

export class MovementTracker {
  private pending: PendingMovement | null = null;
  private currentRoomId: string | null = null;

  /** Maximum age (ms) before a pending movement is considered stale */
  private static MAX_AGE = 10_000;

  /**
   * Call when a command is sent to the MUD. Returns true if it was a direction.
   */
  trackCommand(command: string): boolean {
    const trimmed = command.trim().toLowerCase();

    // Single-word direction commands
    const dir = parseDirection(trimmed);
    if (dir && this.currentRoomId) {
      this.pending = {
        direction: dir,
        fromRoomId: this.currentRoomId,
        timestamp: Date.now(),
      };
      return true;
    }

    // "look" command — not a movement, but we need to know about it
    // so the room parser doesn't create a false link
    if (trimmed === 'look' || trimmed === 'l') {
      this.pending = null;
    }

    return false;
  }

  /**
   * Call when a room is successfully parsed.
   * Returns the pending movement if there was one (so the caller can link rooms).
   */
  onRoomParsed(newRoomId: string): PendingMovement | null {
    const movement = this.consumePending();
    this.currentRoomId = newRoomId;
    return movement;
  }

  /**
   * Call when movement fails (e.g. "no exit in that direction").
   */
  onMoveFailed(): void {
    this.pending = null;
  }

  /**
   * Set the current room without consuming any pending movement.
   * Used when loading persisted state or on initial room display.
   */
  setCurrentRoom(roomId: string): void {
    this.currentRoomId = roomId;
  }

  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  private consumePending(): PendingMovement | null {
    if (!this.pending) return null;

    // Check if the pending movement is too old
    if (Date.now() - this.pending.timestamp > MovementTracker.MAX_AGE) {
      this.pending = null;
      return null;
    }

    const movement = this.pending;
    this.pending = null;
    return movement;
  }
}
