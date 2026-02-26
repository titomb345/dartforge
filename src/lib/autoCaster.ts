/**
 * Auto-Caster — Automated spell practice loop.
 *
 * Automates the cast→conc cycle for spell practice in DartMUD.
 * Message-driven state machine: detects MUD output patterns and sends
 * the next command in the loop. Power auto-adjusts to find the sweet spot.
 *
 * Power semantics: higher power = easier. On fail, power goes up (easier).
 * On success ("would have succeeded"), power goes down (harder).
 *
 * Weight mode: when power bottoms out at MIN_POWER and a weight item is
 * configured, the caster switches to picking up / putting back weight
 * to adjust difficulty instead of changing power.
 *
 * Activates the ActionBlocker during the casting phase to prevent accidental
 * user input from breaking concentration.
 *
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
  weightMode: boolean;
  weightItem: string;
  weightContainer: string | null;
  weightAdjustUp: number;
  weightAdjustDown: number;
  carriedWeight: number;
}

/** MUD line that always appears when a practice cast finishes. */
const PRACTICE_DONE = 'You finish practicing';
/** MUD line that follows PRACTICE_DONE only on a successful outcome. */
const PRACTICE_SUCCESS = 'You think you would have succeeded';
const UNCONSCIOUS = 'You fall unconscious!';
const CONCENTRATION_BROKEN = 'Your concentration is broken';

/** Minimum power floor. */
const MIN_POWER = 50;
/** Delay before re-checking conc when not at BEBT (ms). */
const BEBT_RETRY_DELAY = 2000;
/**
 * How long to wait after "You finish practicing" for the potential
 * "You think you would have succeeded" line before declaring a fail (ms).
 */
const OUTCOME_WAIT = 300;

export class AutoCaster {
  private _active = false;
  private _spell: string | null = null;
  private _power: number | null = null;
  private _args: string | null = null;
  private _phase: CasterPhase = 'idle';
  private _cycleCount = 0;
  private _adjustUp = 20;
  private _adjustDown = 10;
  private _successCount = 0;
  private _failCount = 0;
  private _isCasting = false;
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;
  private _blockFn: ((key: string, label: string) => void) | null = null;
  /** Blocker-aware send — queues behind active blocking actions. */
  private _queueSendFn: ((cmd: string) => Promise<void>) | null = null;

  /**
   * Timer for the outcome decision window. When "You finish practicing"
   * arrives, we wait OUTCOME_WAIT ms for "You think you would have
   * succeeded" before declaring a fail.
   */
  private _outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  // Weight mode — runtime state (resets on stop/cleanup)
  private _weightMode = false;
  private _carriedWeight = 0;

  // Weight mode — persistent config (survives stop/cleanup)
  private _weightItem: string = 'tallow';
  private _weightContainer: string | null = 'bin';
  private _weightAdjustUp = 10;
  private _weightAdjustDown = 5;

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
      weightMode: this._weightMode,
      weightItem: this._weightItem,
      weightContainer: this._weightContainer,
      weightAdjustUp: this._weightAdjustUp,
      weightAdjustDown: this._weightAdjustDown,
      carriedWeight: this._carriedWeight,
    };
  }

  /** Configure weight settings silently (for loading from persisted settings). */
  configureWeight(
    item: string,
    container: string | null,
    adjustUp: number,
    adjustDown: number
  ): void {
    this._weightItem = item;
    this._weightContainer = container && container !== 'null' ? container : null;
    this._weightAdjustUp = Math.max(1, adjustUp);
    this._weightAdjustDown = Math.max(1, adjustDown);
  }

  /** Start the auto-cast loop. */
  start(
    spell: string,
    power: number,
    args: string | null,
    send: (cmd: string) => Promise<void>,
    echo: (msg: string) => void,
    block: (key: string, label: string) => void,
    queueSend: (cmd: string) => Promise<void>
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
    this._blockFn = block;
    this._queueSendFn = queueSend;
    this._phase = 'checking-conc';
    this._onChange();

    const argsStr = args ? ` ${args}` : '';
    echo(`[Autocast: ${spell} @${power}${argsStr} — starting]`);
    if (this._weightItem) {
      echo(
        `[Autocast: weight → ${this._weightItem}${this._weightContainer ? ` from ${this._weightContainer}` : ''} (take ${this._weightAdjustUp} / put ${this._weightAdjustDown})]`
      );
    }
    send('conc');
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    const successes = this._successCount;
    const fails = this._failCount;
    const wasWeightMode = this._weightMode;
    const carried = this._carriedWeight;

    // Put back all carried weight — use blocker-aware send so it queues
    // behind any in-progress cast instead of interrupting it.
    const weightCmd = wasWeightMode && carried > 0 ? this._weightCmd('put', carried) : null;
    const queueSend = this._queueSendFn;

    this._cleanup();
    this._onChange();

    // Send weight return after cleanup — goes through blocker, so it
    // queues behind any in-progress cast and fires when the cast resolves.
    if (weightCmd) queueSend?.(weightCmd);

    let msg = `[Autocast: stopped after ${cycles} cycle${cycles !== 1 ? 's' : ''} — ${successes} success, ${fails} fail`;
    if (wasWeightMode && carried > 0) {
      msg += ` | returned ${carried} ${this._weightItem}`;
    }
    msg += ']';
    fn?.(msg);
  }

  /** Adjust power mid-loop. */
  setPower(power: number, echo: (msg: string) => void): void {
    this._power = Math.max(power, MIN_POWER);
    this._onChange();
    echo(`[Autocast: power adjusted to @${this._power}]`);
  }

  /** Set power adjustment amounts. */
  setAdjust(up: number, down: number, echo: (msg: string) => void): void {
    this._adjustUp = up;
    this._adjustDown = down;
    this._onChange();
    echo(`[Autocast: power adjust up=${up}, down=${down}]`);
  }

  /** Set weight item name. */
  setWeightItem(item: string, echo: (msg: string) => void): void {
    this._weightItem = item;
    this._onChange();
    echo(`[Autocast: weight item set to "${item}"]`);
  }

  /** Set weight container name (null = ground, no container). */
  setWeightContainer(container: string | null, echo: (msg: string) => void): void {
    this._weightContainer = container;
    this._onChange();
    echo(
      container
        ? `[Autocast: weight container set to "${container}"]`
        : '[Autocast: weight container cleared (ground)]'
    );
  }

  /** Force-set the carried weight amount. */
  setCarriedWeight(amount: number, echo: (msg: string) => void): void {
    this._carriedWeight = Math.max(0, amount);
    this._onChange();
    echo(`[Autocast: carried weight set to ${this._carriedWeight}]`);
  }

  /** Set weight adjustment amounts. */
  setWeightAdjust(up: number, down: number, echo: (msg: string) => void): void {
    this._weightAdjustUp = Math.max(1, up);
    this._weightAdjustDown = Math.max(1, down);
    this._onChange();
    echo(`[Autocast: weight adjust take=${this._weightAdjustUp}, put=${this._weightAdjustDown}]`);
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
      const wasWeightMode = this._weightMode;
      const carried = this._carriedWeight;

      // Put back carried weight before stopping
      if (wasWeightMode && carried > 0 && this._weightItem) {
        this._sendFn?.(
          this._weightCmd('put', carried)
        );
      }

      this._cleanup();
      this._onChange();
      let msg = '[Autocast: stopped — you fell unconscious';
      if (wasWeightMode && carried > 0) {
        msg += ` | returned ${carried} ${this._weightItem}`;
      }
      msg += ']';
      fn?.(msg);
      return;
    }

    // Concentration broken — stop loop during casting phase
    if (this._phase === 'casting' && stripped.includes(CONCENTRATION_BROKEN)) {
      const fn = this._echoFn;
      this._cancelOutcomeTimer();
      this._cleanup();
      this._onChange();
      fn?.('[Autocast: stopped — concentration broken]');
      return;
    }

    // Cast outcome detection — active in 'casting' phase
    if (this._phase === 'casting') {
      // Success — check first. The success message may arrive on the same
      // line as PRACTICE_DONE, or on a subsequent line within OUTCOME_WAIT.
      if (stripped.includes(PRACTICE_SUCCESS)) {
        this._cancelOutcomeTimer();
        this._isCasting = false;
        this._handleSuccess();
        return;
      }

      // Practice done — wait briefly for the potential success message
      // before declaring a fail. The MUD sends "You finish practicing."
      // first, then "You think you would have succeeded." on a separate line.
      if (this._isCasting && stripped.includes(PRACTICE_DONE)) {
        this._isCasting = false;
        this._outcomeTimer = setTimeout(() => {
          this._timers.delete(this._outcomeTimer!);
          this._outcomeTimer = null;
          if (this._active) this._handleFail();
        }, OUTCOME_WAIT);
        this._timers.add(this._outcomeTimer);
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
        this._blockFn?.('cast', 'Autocasting');
        const argsStr = this._args ? ` ${this._args}` : '';
        const cmd = `cast ! ${this._spell} @${this._power}${argsStr}`;
        this._echoFn?.(`[Autocast: ${cmd}]`);
        this._sendFn?.(cmd);
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
    this._cancelOutcomeTimer();
    this._cleanup();
    this._onChange();
  }

  // ---------------------------------------------------------------------------
  // Outcome handlers
  // ---------------------------------------------------------------------------

  private _handleSuccess(): void {
    this._cycleCount++;
    this._successCount++;

    if (this._weightMode) {
      // Weight mode success — take more weight (harder)
      this._carriedWeight += this._weightAdjustUp;
      this._sendFn?.(
        this._weightCmd('take', this._weightAdjustUp)
      );
      this._echoFn?.(
        `[Autocast: success — take ${this._weightAdjustUp} ${this._weightItem} (carrying ${this._carriedWeight})]`
      );
    } else {
      // Power mode success — decrease power (harder)
      const newPower = Math.max(
        (this._power ?? MIN_POWER) - this._adjustDown,
        MIN_POWER
      );

      if (newPower === MIN_POWER && this._power === MIN_POWER && this._weightItem) {
        // Power already at floor and weight configured — enter weight mode
        this._weightMode = true;
        this._carriedWeight = this._weightAdjustUp;
        this._sendFn?.(
          this._weightCmd('take', this._weightAdjustUp)
        );
        this._echoFn?.(
          `[Autocast: success — entering weight mode, take ${this._weightAdjustUp} ${this._weightItem} (carrying ${this._carriedWeight})]`
        );
      } else {
        this._power = newPower;
        this._echoFn?.(`[Autocast: success — power → @${this._power}]`);
      }
    }

    this._phase = 'checking-conc';
    this._onChange();
    this._sendFn?.('conc');
  }

  private _handleFail(): void {
    this._cycleCount++;
    this._failCount++;

    if (this._weightMode) {
      // Weight mode fail — put some weight back (easier)
      const actualDrop = Math.min(this._weightAdjustDown, this._carriedWeight);
      this._carriedWeight -= actualDrop;

      if (actualDrop > 0) {
        this._sendFn?.(
          this._weightCmd('put', actualDrop)
        );
      }

      if (this._carriedWeight <= 0) {
        this._weightMode = false;
        this._carriedWeight = 0;
        this._echoFn?.(
          `[Autocast: fail — put ${actualDrop} ${this._weightItem}, exiting weight mode → power @${this._power}]`
        );
      } else {
        this._echoFn?.(
          `[Autocast: fail — put ${actualDrop} ${this._weightItem} (carrying ${this._carriedWeight})]`
        );
      }
    } else {
      // Power mode fail — increase power (easier)
      this._power = (this._power ?? MIN_POWER) + this._adjustUp;
      this._echoFn?.(`[Autocast: fail — power → @${this._power}]`);
    }

    this._phase = 'checking-conc';
    this._onChange();
    this._sendFn?.('conc');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Build a take/put/drop command based on container config. */
  private _weightCmd(verb: 'take' | 'put', amount: number): string {
    if (this._weightContainer) {
      const prep = verb === 'take' ? 'from' : 'in';
      return `${verb} ${amount} ${this._weightItem} ${prep} ${this._weightContainer}`;
    }
    // No container — take from ground, drop to ground
    const action = verb === 'put' ? 'drop' : 'take';
    return `${action} ${amount} ${this._weightItem}`;
  }

  private _cancelOutcomeTimer(): void {
    if (this._outcomeTimer) {
      clearTimeout(this._outcomeTimer);
      this._timers.delete(this._outcomeTimer);
      this._outcomeTimer = null;
    }
  }

  private _delayedSend(cmd: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (this._active) this._sendFn?.(cmd);
    }, delayMs);
    this._timers.add(timer);
  }

  private _cleanup(): void {
    this._cancelOutcomeTimer();
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    // NOTE: we intentionally do NOT force-unblock here. The blocker's
    // auto-unblock in onLine handles it when the MUD action resolves.
    this._active = false;
    this._spell = null;
    this._power = null;
    this._args = null;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._successCount = 0;
    this._failCount = 0;
    this._isCasting = false;
    this._adjustUp = 20;
    this._adjustDown = 10;
    // Weight runtime state resets; config (_weightItem, _weightContainer,
    // _weightAdjustUp, _weightAdjustDown) persists across start/stop cycles.
    this._weightMode = false;
    this._carriedWeight = 0;
    this._sendFn = null;
    this._echoFn = null;
    this._blockFn = null;
    this._queueSendFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}
