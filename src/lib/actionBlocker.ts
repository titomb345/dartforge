/**
 * Action Blocker — Command queueing engine for channeled actions.
 *
 * Prevents accidental interruption of DartMUD channeled actions (cast, study,
 * hunt, etc.) by intercepting outgoing commands during the action and queueing
 * them for release when the action completes.
 *
 * Instantiate once via useRef (same pattern as OutputFilter). Not a React hook.
 */

import { isBlocker, matchesUnblock, type BlockCategory } from './actionBlockerPatterns';

export interface ActionBlockerState {
  blocked: boolean;
  blockType: string | null;
  blockLabel: string | null;
  queueLength: number;
}

export class ActionBlocker {
  private _blocked = false;
  private _blockType: string | null = null;
  private _blockLabel: string | null = null;
  private _queue: string[] = [];

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;

  get blocked(): boolean {
    return this._blocked;
  }
  get blockType(): string | null {
    return this._blockType;
  }
  get blockLabel(): string | null {
    return this._blockLabel;
  }
  get queueLength(): number {
    return this._queue.length;
  }

  getState(): ActionBlockerState {
    return {
      blocked: this._blocked,
      blockType: this._blockType,
      blockLabel: this._blockLabel,
      queueLength: this._queue.length,
    };
  }

  /** Check if an outgoing command should activate blocking. */
  shouldBlock(command: string): BlockCategory | null {
    return isBlocker(command);
  }

  /** Activate blocking for a command category. */
  block(category: BlockCategory): void {
    this._blocked = true;
    this._blockType = category.key;
    this._blockLabel = category.label;
    this._onChange();
  }

  /** Add a command to the queue (called when blocked). */
  enqueue(command: string): void {
    this._queue.push(command);
    this._onChange();
  }

  /**
   * Check a server output line for unblock triggers.
   * Returns true if the line matched (caller should then call flush()).
   */
  processServerLine(stripped: string): boolean {
    if (!this._blocked) return false;
    return matchesUnblock(stripped, this._blockType);
  }

  /**
   * Flush the queue after an unblock event.
   *
   * Returns the commands to send. If a queued command is itself a blocker,
   * it's included in toSend but the blocker re-enters blocked state with
   * remaining commands still queued (chain-aware flush).
   */
  flush(): { toSend: string[]; reblocked: boolean } {
    const toSend: string[] = [];
    let reblocked = false;

    this._blocked = false;
    this._blockType = null;
    this._blockLabel = null;

    while (this._queue.length > 0) {
      const cmd = this._queue.shift()!;
      const cat = isBlocker(cmd);
      toSend.push(cmd);

      if (cat) {
        // This queued command is itself a blocker — re-block
        this._blocked = true;
        this._blockType = cat.key;
        this._blockLabel = cat.label;
        reblocked = true;
        break;
      }
    }

    if (!reblocked) {
      this._queue = [];
    }

    this._onChange();
    return { toSend, reblocked };
  }

  /** Force-unblock (manual /unblock). Returns all queued commands to send. */
  forceUnblock(): string[] {
    const queued = [...this._queue];
    this._blocked = false;
    this._blockType = null;
    this._blockLabel = null;
    this._queue = [];
    this._onChange();
    return queued;
  }

  /** Reset on disconnect. */
  reset(): void {
    this._blocked = false;
    this._blockType = null;
    this._blockLabel = null;
    this._queue = [];
    this._onChange();
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
