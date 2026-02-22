/**
 * Movement tracker — detects hex direction commands and tracks pending movement.
 *
 * Only tracks the 6 hex directions: n, s, ne, nw, se, sw.
 * All other commands (enter, back, look, etc.) are ignored.
 *
 * Flow:
 * 1. User sends a command → check if it's a hex direction
 * 2. If hex direction, record as "pending movement"
 * 3. When a hex room is parsed, the pending movement links the previous room to the new one
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
   * Call when a command is sent to the MUD.
   * Only records hex direction commands; ignores everything else.
   */
  trackCommand(command: string): boolean {
    const trimmed = command.trim().toLowerCase();

    // Only single-word hex direction commands
    const dir = parseDirection(trimmed);
    if (dir && this.currentRoomId) {
      this.pending = {
        direction: dir,
        fromRoomId: this.currentRoomId,
        timestamp: Date.now(),
      };
      return true;
    }

    return false;
  }

  /**
   * Call when a hex room is successfully parsed.
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
