/**
 * Auto-Conc — Auto-execute commands on full concentration (BEBT).
 *
 * Passively watches MUD output for concentration recovery messages and
 * executes a user-configured action string through the full command
 * pipeline (alias expansion, /spam, /delay, /echo, /var, semicolons).
 *
 * Single-shot re-arm: fires once on BEBT, then waits for conc to drop
 * below BEBT before re-arming. No polling — relies on natural MUD messages.
 *
 * Instantiate once via useRef (same pattern as AutoCaster). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';

export type AutoConcPhase =
  | 'idle'
  | 'waiting-bebt'
  | 'executing';

export interface AutoConcState {
  active: boolean;
  action: string | null;
  phase: AutoConcPhase;
  cycleCount: number;
}

const UNCONSCIOUS = 'You fall unconscious!';

export class AutoConc {
  private _active = false;
  private _action: string | null = null;
  private _phase: AutoConcPhase = 'idle';
  private _cycleCount = 0;
  /** True when ready to fire on next BEBT. Set false after firing, re-armed on non-BEBT. */
  private _armed = true;
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

  /** Start the auto-conc loop. Sends one `conc` to get initial state. */
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
    this._armed = true;
    this._executeFn = execute;
    this._echoFn = echo;
    this._phase = 'waiting-bebt';
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
   * Passively watches for concentration messages — no polling.
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

    // Concentration detection — active in waiting-bebt phase
    if (this._phase === 'waiting-bebt') {
      const match = matchConcentrationLine(stripped);
      if (!match) return;

      if (match.level.key === 'bebt' && this._armed) {
        // BEBT and armed — fire the action, disarm until conc drops
        this._armed = false;
        this._phase = 'executing';
        this._onChange();
        this._echoFn?.(`[Autoconc: ${this._action}]`);

        this._executeFn?.(this._action!).then(() => {
          if (!this._active) return;
          this._cycleCount++;
          this._phase = 'waiting-bebt';
          this._onChange();
        });
      } else if (match.level.key !== 'bebt') {
        // Not BEBT — re-arm so we fire on next recovery
        this._armed = true;
        this._onChange();
      }
      // BEBT but not armed — just ignore, wait for conc to drop naturally
    }
  }

  /** Reset on disconnect. */
  reset(): void {
    this._cleanup();
    this._onChange();
  }

  private _cleanup(): void {
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._armed = true;
    this._executeFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
