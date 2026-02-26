/**
 * Auto-Inscriber — Automated inscription practice loop.
 *
 * Automates the inscribe→invoke cycle for spell practice in DartMUD.
 * Message-driven state machine: detects MUD output patterns and sends
 * the next command in the loop.
 *
 * Instantiate once via useRef (same pattern as ActionBlocker). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';

export type InscriberPhase =
  | 'idle'
  | 'checking-conc'
  | 'waiting-bebt'
  | 'inscribing'
  | 'invoking'
  | 'cooldown';

export interface AutoInscriberState {
  active: boolean;
  spell: string | null;
  power: number | null;
  phase: InscriberPhase;
  cycleCount: number;
}

const INSCRIPTION_COMPLETE = 'You have written a';
const INVOCATION_COMPLETE = 'As you finish reading, the last words disappear.';
const UNCONSCIOUS = 'You fall unconscious!';

/** Delay before sending invoke after inscription completes (ms). */
const INVOKE_DELAY = 700;
/** Delay before re-checking conc after invocation completes (ms). */
const CONC_DELAY = 300;
/** Delay before re-checking conc when not at BEBT (ms). */
const BEBT_RETRY_DELAY = 2000;

export class AutoInscriber {
  private _active = false;
  private _spell: string | null = null;
  private _power: number | null = null;
  private _phase: InscriberPhase = 'idle';
  private _cycleCount = 0;
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;

  get active(): boolean {
    return this._active;
  }
  get spell(): string | null {
    return this._spell;
  }
  get power(): number | null {
    return this._power;
  }
  get phase(): InscriberPhase {
    return this._phase;
  }
  get cycleCount(): number {
    return this._cycleCount;
  }

  getState(): AutoInscriberState {
    return {
      active: this._active,
      spell: this._spell,
      power: this._power,
      phase: this._phase,
      cycleCount: this._cycleCount,
    };
  }

  /** Start the auto-inscribe loop. */
  start(
    spell: string,
    power: number,
    send: (cmd: string) => Promise<void>,
    echo: (msg: string) => void
  ): void {
    // Stop any existing loop first
    if (this._active) this._cleanup();

    this._active = true;
    this._spell = spell;
    this._power = power;
    this._cycleCount = 0;
    this._sendFn = send;
    this._echoFn = echo;
    this._phase = 'checking-conc';
    this._onChange();

    echo(`[Autoinscribe: ${spell} @ power ${power} — starting]`);
    send('conc');
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    this._cleanup();
    this._onChange();
    fn?.(`[Autoinscribe: stopped after ${cycles} cycle${cycles !== 1 ? 's' : ''}]`);
  }

  /** Adjust power mid-loop. */
  setPower(power: number, echo: (msg: string) => void): void {
    this._power = power;
    this._onChange();
    echo(`[Autoinscribe: power adjusted to ${power}]`);
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
      fn?.('[Autoinscribe: stopped — you fell unconscious]');
      return;
    }

    switch (this._phase) {
      case 'checking-conc':
      case 'waiting-bebt': {
        const match = matchConcentrationLine(stripped);
        if (!match) return;

        if (match.level.key === 'bebt') {
          // Concentration is ready — inscribe
          this._phase = 'inscribing';
          this._onChange();
          this._sendFn?.(`inscribe ${this._spell} ${this._power}`);
        } else if (this._phase === 'checking-conc') {
          // Not BEBT — wait and retry
          this._phase = 'waiting-bebt';
          this._onChange();
          this._delayedSend('conc', BEBT_RETRY_DELAY);
        }
        break;
      }

      case 'inscribing': {
        if (stripped.startsWith(INSCRIPTION_COMPLETE)) {
          this._phase = 'invoking';
          this._onChange();
          this._delayedSend(`invoke ${this._spell} !`, INVOKE_DELAY);
        }
        break;
      }

      case 'invoking': {
        if (stripped.includes(INVOCATION_COMPLETE)) {
          this._cycleCount++;
          this._phase = 'cooldown';
          this._onChange();
          this._delayedConc(CONC_DELAY);
        }
        break;
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
    this._spell = null;
    this._power = null;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._sendFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
