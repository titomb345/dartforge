/**
 * Auto-Caster — Automated spell practice loop.
 *
 * Automates the cast→conc cycle for spell practice in DartMUD.
 * Message-driven state machine: detects MUD output patterns and sends
 * the next command in the loop. Power auto-adjusts to find the sweet spot.
 *
 * Power semantics: higher power = easier. On fail, power goes up (easier).
 * On success ("would have succeeded"), power goes down (harder).
 * Ported from DartMudlet's scripts_casting.lua.
 *
 * Instantiate once via useRef (same pattern as AutoInscriber). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';

export type CasterPhase =
  | 'idle'
  | 'checking-conc'
  | 'waiting-bebt'
  | 'casting';

export interface AutoCasterState {
  active: boolean;
  spell: string | null;
  power: number | null;
  args: string | null;
  phase: CasterPhase;
  cycleCount: number;
  adjustUp: number;
  adjustDown: number;
  successCount: number;
  failCount: number;
}

const PRACTICE_FAIL = 'You finish practicing';
const PRACTICE_SUCCESS = 'You think you would have succeeded';
const UNCONSCIOUS = 'You fall unconscious!';

/** Minimum power floor. */
const MIN_POWER = 50;
/** Delay before re-checking conc when not at BEBT (ms). */
const BEBT_RETRY_DELAY = 2000;

export class AutoCaster {
  private _active = false;
  private _spell: string | null = null;
  private _power: number | null = null;
  private _args: string | null = null;
  private _phase: CasterPhase = 'idle';
  private _cycleCount = 0;
  private _adjustUp = 10;
  private _adjustDown = 10;
  private _successCount = 0;
  private _failCount = 0;
  private _isCasting = false;
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
  get phase(): CasterPhase {
    return this._phase;
  }
  get cycleCount(): number {
    return this._cycleCount;
  }

  getState(): AutoCasterState {
    return {
      active: this._active,
      spell: this._spell,
      power: this._power,
      args: this._args,
      phase: this._phase,
      cycleCount: this._cycleCount,
      adjustUp: this._adjustUp,
      adjustDown: this._adjustDown,
      successCount: this._successCount,
      failCount: this._failCount,
    };
  }

  /** Start the auto-cast loop. */
  start(
    spell: string,
    power: number,
    args: string | null,
    send: (cmd: string) => Promise<void>,
    echo: (msg: string) => void
  ): void {
    // Stop any existing loop first
    if (this._active) this._cleanup();

    this._active = true;
    this._spell = spell;
    this._power = power;
    this._args = args;
    this._cycleCount = 0;
    this._successCount = 0;
    this._failCount = 0;
    this._isCasting = false;
    this._sendFn = send;
    this._echoFn = echo;
    this._phase = 'checking-conc';
    this._onChange();

    const argsStr = args ? ` ${args}` : '';
    echo(`[Autocast: ${spell} @ power ${power}${argsStr} — starting]`);
    send('conc');
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    const successes = this._successCount;
    const fails = this._failCount;
    this._cleanup();
    this._onChange();
    fn?.(
      `[Autocast: stopped after ${cycles} cycle${cycles !== 1 ? 's' : ''} — ${successes} success, ${fails} fail]`
    );
  }

  /** Adjust power mid-loop. */
  setPower(power: number, echo: (msg: string) => void): void {
    this._power = Math.max(power, MIN_POWER);
    this._onChange();
    echo(`[Autocast: power adjusted to ${this._power}]`);
  }

  /** Set power adjustment amounts. */
  setAdjust(up: number, down: number, echo: (msg: string) => void): void {
    this._adjustUp = up;
    this._adjustDown = down;
    this._onChange();
    echo(`[Autocast: adjust up=${up}, down=${down}]`);
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
      fn?.('[Autocast: stopped — you fell unconscious]');
      return;
    }

    // Cast outcome detection — active in 'casting' phase when _isCasting is true
    if (this._phase === 'casting' && this._isCasting) {
      if (stripped.includes(PRACTICE_FAIL)) {
        // Fail — increase power (more power = easier)
        this._isCasting = false;
        this._cycleCount++;
        this._failCount++;
        this._power = (this._power ?? MIN_POWER) + this._adjustUp;
        this._echoFn?.(`[Autocast: fail — power → ${this._power}]`);
        this._phase = 'checking-conc';
        this._onChange();
        this._sendFn?.('conc');
        return;
      }

      if (stripped.includes(PRACTICE_SUCCESS)) {
        // Success — decrease power (less power = harder)
        this._isCasting = false;
        this._cycleCount++;
        this._successCount++;
        this._power = Math.max(
          (this._power ?? MIN_POWER) - (this._adjustUp + this._adjustDown),
          MIN_POWER
        );
        this._echoFn?.(`[Autocast: success — power → ${this._power}]`);
        this._phase = 'checking-conc';
        this._onChange();
        this._sendFn?.('conc');
        return;
      }
    }

    // Concentration detection — active in checking-conc / waiting-bebt phases
    if (this._phase === 'checking-conc' || this._phase === 'waiting-bebt') {
      const match = matchConcentrationLine(stripped);
      if (!match) return;

      if (match.level.key === 'bebt') {
        // Concentration is ready — cast
        this._phase = 'casting';
        this._isCasting = true;
        this._onChange();
        const argsStr = this._args ? ` ${this._args}` : '';
        this._sendFn?.(`cast ! ${this._spell} @${this._power}${argsStr}`);
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

  private _cleanup(): void {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    this._active = false;
    this._spell = null;
    this._power = null;
    this._args = null;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._successCount = 0;
    this._failCount = 0;
    this._isCasting = false;
    this._adjustUp = 10;
    this._adjustDown = 10;
    this._sendFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
