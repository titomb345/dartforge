/**
 * Auto-Inscriber — Automated inscription practice loop.
 *
 * Automates the inscribe→invoke cycle for spell practice in DartMUD.
 * Passively watches MUD output for concentration recovery, inscription
 * completion, and invocation results. No polling — relies on natural
 * MUD concentration messages.
 *
 * Activates the ActionBlocker during interruptible phases (inscribing,
 * invoking) to prevent accidental user input from breaking concentration.
 *
 * Instantiate once via useRef (same pattern as ActionBlocker). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';

export type InscriberPhase =
  | 'idle'
  | 'waiting-bebt'
  | 'inscribing'
  | 'invoking';

export interface AutoInscriberState {
  active: boolean;
  spell: string | null;
  power: number | null;
  phase: InscriberPhase;
  cycleCount: number;
}

const INSCRIPTION_COMPLETE = 'You have written a';
const INVOCATION_COMPLETE = 'the spell fades from your scroll';
const UNCONSCIOUS = 'You fall unconscious!';
const CONCENTRATION_BROKEN = 'Your concentration is broken';

/** Delay before sending invoke after inscription completes (ms). */
const INVOKE_DELAY = 700;

export class AutoInscriber {
  private _active = false;
  private _spell: string | null = null;
  private _power: number | null = null;
  private _phase: InscriberPhase = 'idle';
  private _cycleCount = 0;
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;
  private _blockFn: ((key: string, label: string) => void) | null = null;

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
    echo: (msg: string) => void,
    block: (key: string, label: string) => void
  ): void {
    // Stop any existing loop first
    if (this._active) this._cleanup();

    this._active = true;
    this._spell = spell;
    this._power = power;
    this._cycleCount = 0;
    this._sendFn = send;
    this._echoFn = echo;
    this._blockFn = block;
    this._phase = 'waiting-bebt';
    this._onChange();

    echo(`[Autoinscribe: ${spell} @${power} — starting]`);
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
    this._power = Math.max(power, 100);
    this._onChange();
    echo(`[Autoinscribe: power adjusted to @${this._power}]`);
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

    // Concentration broken — stop loop during interruptible phases
    if (
      (this._phase === 'inscribing' || this._phase === 'invoking') &&
      stripped.includes(CONCENTRATION_BROKEN)
    ) {
      const fn = this._echoFn;
      this._cleanup();
      this._onChange();
      fn?.('[Autoinscribe: stopped — concentration broken]');
      return;
    }

    switch (this._phase) {
      case 'waiting-bebt': {
        const match = matchConcentrationLine(stripped);
        if (!match) return;

        if (match.level.key === 'bebt') {
          // Concentration is ready — inscribe
          this._phase = 'inscribing';
          this._onChange();
          this._blockFn?.('inscribe', 'Autoinscribing');
          const cmd = `inscribe ${this._spell} ${this._power}`;
          this._echoFn?.(`[Autoinscribe: ${cmd}]`);
          this._sendFn?.(cmd);
        }
        // Not BEBT — wait passively for recovery
        break;
      }

      case 'inscribing': {
        if (stripped.startsWith(INSCRIPTION_COMPLETE)) {
          this._phase = 'invoking';
          this._onChange();
          // Block for the invoke — the blocker auto-unblocked on
          // inscription complete, so re-activate for the invoke phase.
          this._delayedBlockAndSend(
            `invoke ${this._spell} !`,
            INVOKE_DELAY,
            'invoke',
            'Autoinscribing'
          );
        }
        break;
      }

      case 'invoking': {
        if (stripped.includes(INVOCATION_COMPLETE)) {
          this._cycleCount++;
          this._phase = 'waiting-bebt';
          this._onChange();
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

  /** Activate blocking then send a command after a delay. */
  private _delayedBlockAndSend(
    cmd: string,
    delayMs: number,
    blockKey: string,
    blockLabel: string
  ): void {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (this._active) {
        this._blockFn?.(blockKey, blockLabel);
        this._sendFn?.(cmd);
      }
    }, delayMs);
    this._timers.add(timer);
  }

  private _cleanup(): void {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    // NOTE: we intentionally do NOT force-unblock here. The blocker's
    // auto-unblock in onLine handles it when the MUD action resolves.
    this._active = false;
    this._spell = null;
    this._power = null;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._sendFn = null;
    this._echoFn = null;
    this._blockFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
