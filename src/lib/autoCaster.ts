/**
 * Auto-Caster — Automated spell practice loop.
 *
 * Automates the cast cycle for spell practice in DartMUD.
 * Passively watches MUD output for concentration recovery and cast outcomes.
 * Power auto-adjusts to find the sweet spot. No polling — relies on natural
 * MUD concentration messages.
 *
 * Power semantics: higher power = easier. Casts are judged in batches
 * (default 4): once a batch is done, enough successes make the next batch
 * harder (power down), too few make it easier (power up), and anything in
 * between leaves it alone. A batch of 1 with thresholds 1/0 is the old
 * every-cast behavior.
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

export type CasterPhase = 'idle' | 'checking-conc' | 'waiting-bebt' | 'casting';

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
  batchSize: number;
  harderAt: number;
  easierAt: number;
  /** Casts finished in the current batch. */
  batchCasts: number;
  /** Successes in the current batch. */
  batchSuccesses: number;
}

/**
 * Tuning that belongs to a character rather than to a single run: the power
 * steps, the weight item/container/steps and the batch rule. Strength and
 * aptitude decide these, so they survive stop/start and app restarts and are
 * persisted per character by useAutoCasterConfig.
 */
export interface AutoCasterConfig {
  adjustUp: number;
  adjustDown: number;
  weightItem: string;
  weightContainer: string | null;
  weightAdjustUp: number;
  weightAdjustDown: number;
  /** Casts per batch. Power/weight only change when a batch completes. */
  batchSize: number;
  /** This many successes or more in a batch make the next one harder. */
  harderAt: number;
  /** This many successes or fewer in a batch make the next one easier. */
  easierAt: number;
}

export const DEFAULT_CASTER_CONFIG: AutoCasterConfig = {
  adjustUp: 20,
  adjustDown: 10,
  weightItem: 'tallow',
  weightContainer: 'bin',
  weightAdjustUp: 10,
  weightAdjustDown: 5,
  batchSize: 4,
  harderAt: 3,
  easierAt: 1,
};

/** True when the three batch numbers form a usable rule. */
export function isValidBatchRule(batchSize: number, harderAt: number, easierAt: number): boolean {
  return (
    Number.isInteger(batchSize) &&
    Number.isInteger(harderAt) &&
    Number.isInteger(easierAt) &&
    batchSize >= 1 &&
    harderAt >= 1 &&
    harderAt <= batchSize &&
    easierAt >= 0 &&
    easierAt < harderAt
  );
}

/** Plain-words summary of a batch rule, for the start echo and /autocast status. */
export function describeBatchRule(batchSize: number, harderAt: number, easierAt: number): string {
  if (batchSize === 1) return 'every cast: success = harder, fail = easier';
  const harder = harderAt === batchSize ? `all ${batchSize}` : `${harderAt}+`;
  const easier = easierAt === 0 ? '0' : `${easierAt} or fewer`;
  const holds = harderAt - easierAt > 1 ? ', anything else = hold' : '';
  return `every ${batchSize} casts: ${harder} succeed = harder, ${easier} = easier${holds}`;
}

/** MUD line that always appears when a practice cast finishes. */
const PRACTICE_DONE = 'You finish practicing';
/** MUD line that follows PRACTICE_DONE only on a successful outcome. */
const PRACTICE_SUCCESS = 'You think you would have succeeded';
const UNCONSCIOUS = 'You fall unconscious!';
const CONCENTRATION_BROKEN = 'Your concentration is broken';

/** Minimum power floor. */
const MIN_POWER = 50;
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
  // Per-character config (see AutoCasterConfig) — survives stop/cleanup
  private _adjustUp = DEFAULT_CASTER_CONFIG.adjustUp;
  private _adjustDown = DEFAULT_CASTER_CONFIG.adjustDown;
  private _successCount = 0;
  private _failCount = 0;
  private _batchSize = DEFAULT_CASTER_CONFIG.batchSize;
  private _harderAt = DEFAULT_CASTER_CONFIG.harderAt;
  private _easierAt = DEFAULT_CASTER_CONFIG.easierAt;
  private _batchCasts = 0;
  private _batchSuccesses = 0;
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

  // Weight mode — per-character config (survives stop/cleanup)
  private _weightItem: string = DEFAULT_CASTER_CONFIG.weightItem;
  private _weightContainer: string | null = DEFAULT_CASTER_CONFIG.weightContainer;
  private _weightAdjustUp = DEFAULT_CASTER_CONFIG.weightAdjustUp;
  private _weightAdjustDown = DEFAULT_CASTER_CONFIG.weightAdjustDown;

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;
  /** Callback invoked when the per-character config is edited — wire to persistence. */
  onConfigChange: ((config: AutoCasterConfig) => void) | null = null;

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
      batchSize: this._batchSize,
      harderAt: this._harderAt,
      easierAt: this._easierAt,
      batchCasts: this._batchCasts,
      batchSuccesses: this._batchSuccesses,
    };
  }

  getConfig(): AutoCasterConfig {
    return {
      adjustUp: this._adjustUp,
      adjustDown: this._adjustDown,
      weightItem: this._weightItem,
      weightContainer: this._weightContainer,
      weightAdjustUp: this._weightAdjustUp,
      weightAdjustDown: this._weightAdjustDown,
      batchSize: this._batchSize,
      harderAt: this._harderAt,
      easierAt: this._easierAt,
    };
  }

  /**
   * Apply a character's config silently (loading from disk / swapping
   * characters). Does not fire onConfigChange.
   */
  configure(config: AutoCasterConfig): void {
    this._adjustUp = Math.max(1, config.adjustUp);
    this._adjustDown = Math.max(1, config.adjustDown);
    this._weightItem = config.weightItem;
    const c = config.weightContainer;
    this._weightContainer = c && c !== 'null' ? c : null;
    this._weightAdjustUp = Math.max(1, config.weightAdjustUp);
    this._weightAdjustDown = Math.max(1, config.weightAdjustDown);
    const ok = isValidBatchRule(config.batchSize, config.harderAt, config.easierAt);
    const rule = ok ? config : DEFAULT_CASTER_CONFIG;
    this._batchSize = rule.batchSize;
    this._harderAt = rule.harderAt;
    this._easierAt = rule.easierAt;
    this._resetBatch();
    this._onChange();
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
    this._resetBatch();
    this._isCasting = false;
    this._sendFn = send;
    this._echoFn = echo;
    this._blockFn = block;
    this._queueSendFn = queueSend;
    this._phase = 'checking-conc';
    this._onChange();

    const argsStr = args ? ` ${args}` : '';
    echo(`[Autocast: ${spell} @${power}${argsStr} — starting]`);
    echo(`[Autocast: ${describeBatchRule(this._batchSize, this._harderAt, this._easierAt)}]`);
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

  /**
   * Adjust power mid-loop. Casts already made in the current batch were at
   * the old power, so they don't count toward judging the new one.
   */
  setPower(power: number, echo: (msg: string) => void): void {
    this._power = Math.max(power, MIN_POWER);
    const restarted = this._batchCasts > 0;
    this._resetBatch();
    this._onChange();
    echo(`[Autocast: power adjusted to @${this._power}${restarted ? ', batch restarted' : ''}]`);
  }

  /** Set the batch rule (caller validates with isValidBatchRule). Restarts the current batch. */
  setBatch(
    batchSize: number,
    harderAt: number,
    easierAt: number,
    echo: (msg: string) => void
  ): void {
    this._batchSize = batchSize;
    this._harderAt = harderAt;
    this._easierAt = easierAt;
    this._resetBatch();
    this._onConfigChange();
    echo(`[Autocast: ${describeBatchRule(batchSize, harderAt, easierAt)}]`);
  }

  /** Set power adjustment amounts. */
  setAdjust(up: number, down: number, echo: (msg: string) => void): void {
    this._adjustUp = Math.max(1, up);
    this._adjustDown = Math.max(1, down);
    this._onConfigChange();
    echo(`[Autocast: power adjust up=${this._adjustUp}, down=${this._adjustDown}]`);
  }

  /** Set weight item name. */
  setWeightItem(item: string, echo: (msg: string) => void): void {
    this._weightItem = item;
    this._onConfigChange();
    echo(`[Autocast: weight item set to "${item}"]`);
  }

  /** Set weight container name (null = ground, no container). */
  setWeightContainer(container: string | null, echo: (msg: string) => void): void {
    this._weightContainer = container;
    this._onConfigChange();
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
    this._onConfigChange();
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
        this._sendFn?.(this._weightCmd('put', carried));
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
      } else {
        // Not BEBT — wait passively for recovery
        this._phase = 'waiting-bebt';
        this._onChange();
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
    this._recordCast(true);
  }

  private _handleFail(): void {
    this._recordCast(false);
  }

  /**
   * Count a cast toward the current batch. Difficulty only changes once the
   * batch is full: enough successes make it harder, few enough make it
   * easier, anything in between holds.
   */
  private _recordCast(success: boolean): void {
    this._cycleCount++;
    this._batchCasts++;
    if (success) {
      this._successCount++;
      this._batchSuccesses++;
    } else {
      this._failCount++;
    }

    const outcome = success ? 'success' : 'fail';
    // A batch of one reads like the old per-cast messages.
    const label =
      this._batchSize === 1
        ? outcome
        : `${outcome} (cast ${this._batchCasts} of ${this._batchSize}, ${this._batchSuccesses} succeeded)`;

    if (this._batchCasts >= this._batchSize) {
      const successes = this._batchSuccesses;
      this._resetBatch();
      if (successes >= this._harderAt) this._makeHarder(label);
      else if (successes <= this._easierAt) this._makeEasier(label);
      else this._echoFn?.(`[Autocast: ${label}, holding ${this._difficultyText()}]`);
    } else {
      this._echoFn?.(`[Autocast: ${label}]`);
    }

    this._phase = 'waiting-bebt';
    this._onChange();
  }

  /** Lower power, or take more weight once power is at the floor. */
  private _makeHarder(label: string): void {
    if (this._weightMode) {
      this._carriedWeight += this._weightAdjustUp;
      this._sendFn?.(this._weightCmd('take', this._weightAdjustUp));
      this._echoFn?.(
        `[Autocast: ${label}, take ${this._weightAdjustUp} ${this._weightItem} (carrying ${this._carriedWeight})]`
      );
      return;
    }

    const newPower = Math.max((this._power ?? MIN_POWER) - this._adjustDown, MIN_POWER);

    if (newPower === MIN_POWER && this._power === MIN_POWER && this._weightItem) {
      // Power already at floor and weight configured — enter weight mode
      this._weightMode = true;
      this._carriedWeight = this._weightAdjustUp;
      this._sendFn?.(this._weightCmd('take', this._weightAdjustUp));
      this._echoFn?.(
        `[Autocast: ${label}, entering weight mode, take ${this._weightAdjustUp} ${this._weightItem} (carrying ${this._carriedWeight})]`
      );
    } else {
      this._power = newPower;
      this._echoFn?.(`[Autocast: ${label}, power → @${this._power}]`);
    }
  }

  /** Put weight back, or raise power once no weight is carried. */
  private _makeEasier(label: string): void {
    if (this._weightMode) {
      const actualDrop = Math.min(this._weightAdjustDown, this._carriedWeight);
      this._carriedWeight -= actualDrop;

      if (actualDrop > 0) {
        this._sendFn?.(this._weightCmd('put', actualDrop));
      }

      if (this._carriedWeight <= 0) {
        this._weightMode = false;
        this._carriedWeight = 0;
        this._echoFn?.(
          `[Autocast: ${label}, put ${actualDrop} ${this._weightItem}, exiting weight mode → power @${this._power}]`
        );
      } else {
        this._echoFn?.(
          `[Autocast: ${label}, put ${actualDrop} ${this._weightItem} (carrying ${this._carriedWeight})]`
        );
      }
      return;
    }

    this._power = (this._power ?? MIN_POWER) + this._adjustUp;
    this._echoFn?.(`[Autocast: ${label}, power → @${this._power}]`);
  }

  /** Current difficulty, for the "holding" message. */
  private _difficultyText(): string {
    return this._weightMode
      ? `@${this._power} carrying ${this._carriedWeight} ${this._weightItem}`
      : `@${this._power}`;
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

  private _resetBatch(): void {
    this._batchCasts = 0;
    this._batchSuccesses = 0;
  }

  private _cancelOutcomeTimer(): void {
    if (this._outcomeTimer) {
      clearTimeout(this._outcomeTimer);
      this._timers.delete(this._outcomeTimer);
      this._outcomeTimer = null;
    }
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
    this._resetBatch();
    this._isCasting = false;
    // Only run state resets. The per-character config (power steps, weight
    // item/container/steps, batch rule) is deliberately left alone so a fresh /autocast
    // picks up where the last one left off.
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

  private _onConfigChange(): void {
    this._onChange();
    this.onConfigChange?.(this.getConfig());
  }
}
