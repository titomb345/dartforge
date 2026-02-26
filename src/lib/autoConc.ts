/**
 * Auto-Conc — Auto-execute commands on full concentration (BEBT).
 *
 * Watches for "bright-eyed and bushy-tailed" concentration status and
 * executes a user-configured action string through the full command
 * pipeline (alias expansion, /spam, /delay, /echo, /var, semicolons).
 *
 * Simpler than AutoCaster/AutoInscriber — no power adjustment or
 * spell-specific logic. Just: check conc → if BEBT → execute action → repeat.
 *
 * Instantiate once via useRef (same pattern as AutoCaster). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';

export type AutoConcPhase =
  | 'idle'
  | 'checking-conc'
  | 'waiting-bebt'
  | 'executing';

export interface AutoConcState {
  active: boolean;
  action: string | null;
  phase: AutoConcPhase;
  cycleCount: number;
}

const UNCONSCIOUS = 'You fall unconscious!';
/** Delay before re-checking conc when not at BEBT (ms). */
const BEBT_RETRY_DELAY = 2000;
/** Delay after action execution before re-checking conc (ms). */
const POST_ACTION_DELAY = 2000;

export class AutoConc {
  private _active = false;
  private _action: string | null = null;
  private _phase: AutoConcPhase = 'idle';
  private _cycleCount = 0;
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  /** Direct send — bypasses blocker. Used for `conc`. */
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  /** Full pipeline — alias expansion + executeCommands. Used for the action. */
  private _executeFn: ((action: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;

  get active(): boolean {
    return this._active;
  }
  get action(): string | null {
    return this._action;
  }
  get phase(): AutoConcPhase {
    return this._phase;
  }

  getState(): AutoConcState {
    return {
      active: this._active,
      action: this._action,
      phase: this._phase,
      cycleCount: this._cycleCount,
    };
  }

  /** Set the action string (called when loading from persisted settings). */
  setAction(action: string): void {
    this._action = action || null;
  }

  /** Start the auto-conc loop. */
  start(
    action: string,
    send: (cmd: string) => Promise<void>,
    execute: (action: string) => Promise<void>,
    echo: (msg: string) => void
  ): void {
    // Stop any existing loop first
    if (this._active) this._cleanup();

    this._active = true;
    this._action = action;
    this._cycleCount = 0;
    this._sendFn = send;
    this._executeFn = execute;
    this._echoFn = echo;
    this._phase = 'checking-conc';
    this._onChange();

    echo(`[Autoconc: ${action} — starting]`);
    send('conc');
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    this._cleanup();
    this._onChange();
    fn?.(`[Autoconc: stopped after ${cycles} cycle${cycles !== 1 ? 's' : ''}]`);
  }

  /**
   * Process a server output line. Called from onLine in OutputFilter.
   * Drives the state machine based on MUD responses.
   */
  processServerLine(stripped: string): void {
    if (!this._active) return;

    // Auto-stop on unconscious
    if (stripped.includes(UNCONSCIOUS)) {
      const fn = this._echoFn;
      this._cleanup();
      this._onChange();
      fn?.('[Autoconc: stopped — you fell unconscious]');
      return;
    }

    // Concentration detection — active in checking-conc / waiting-bebt phases
    if (this._phase === 'checking-conc' || this._phase === 'waiting-bebt') {
      const match = matchConcentrationLine(stripped);
      if (!match) return;

      if (match.level.key === 'bebt') {
        // Concentration is ready — execute action
        this._phase = 'executing';
        this._onChange();
        this._echoFn?.(`[Autoconc: ${this._action}]`);

        // Execute through full pipeline, then re-check after delay
        this._executeFn?.(this._action!).then(() => {
          if (!this._active) return;
          this._cycleCount++;
          this._onChange();
          this._delayedConc(POST_ACTION_DELAY);
        });
      } else if (this._phase === 'checking-conc') {
        // Not BEBT — wait and retry
        this._phase = 'waiting-bebt';
        this._onChange();
        this._delayedSend('conc', BEBT_RETRY_DELAY);
      }
    }
  }

  /** Reset on disconnect. */
  reset(): void {
    this._cleanup();
    this._onChange();
  }

  private _delayedSend(cmd: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (this._active) this._sendFn?.(cmd);
    }, delayMs);
    this._timers.add(timer);
  }

  private _delayedConc(delayMs: number): void {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (this._active) {
        this._phase = 'checking-conc';
        this._onChange();
        this._sendFn?.('conc');
      }
    }, delayMs);
    this._timers.add(timer);
  }

  private _cleanup(): void {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._sendFn = null;
    this._executeFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
