/**
 * Auto-Powercast — charge a focus, then discharge it into a powercast.
 *
 * Loop:
 *   1. Open the mind and wait until concentration is full again — and, if you
 *      told it which aura level is your normal full, until your aura is back
 *      there too. Channelling and powercasting both spend concentration and
 *      aura, so going straight back to channelling wastes the round. Both
 *      readings come from the status bar's own trackers; the MUD announces
 *      changes to each, so nothing is ever asked for.
 *   2. `channel <power> <item>` a set number of times, pausing between each.
 *      The focus can stay in a container for this.
 *   3. Wait for concentration again (not aura — channelling is what spends
 *      it), so the powercast has something behind it and the stored charge
 *      isn't thrown away.
 *   4. Take the focus out of its container, since discharging is the one step
 *      that needs it in hand: `discharge <item>`, `set mind to isolated`, put
 *      the focus back, then `/powercast <modifier>`.
 *   5. Back to step 1.
 *
 * Only channels the MUD confirms ("You channel power to ...") are counted.
 * "You have no aura." just waits and tries again; "You cannot channel to ..."
 * stops the loop since the item name must be wrong.
 *
 * A powercast that fails (aura too weak, concentration broken, the spell
 * fizzles) does not stop the loop — it opens the mind, waits for recovery and
 * starts a fresh round of channels. Three failures in a row stops it, since
 * something is wrong that waiting won't fix.
 *
 * Instantiate once via useRef (same pattern as AutoCaster). Not a React hook.
 */

import type { ConcentrationLevel } from './concentrationPatterns';
import { findAuraLevel, type AuraLevel } from './auraPatterns';

/**
 * The status bar's live concentration and aura, read straight out of the
 * trackers that draw the vitals pills. The MUD announces both whenever they
 * change, so these are current without anyone asking for them.
 */
export interface Vitals {
  conc: ConcentrationLevel | null;
  aura: AuraLevel | null;
}

export type AutoPowercastPhase = 'idle' | 'waiting' | 'channelling' | 'casting';

/** What the loop does once concentration (and aura) are back. */
export type AutoPowercastNext = 'channel' | 'cast';

/** Per-character config — survives stop/start and app restarts. */
export interface AutoPowercastConfig {
  /** Focus item to channel into and discharge. Empty = not set up yet. */
  item: string;
  /** Container the focus lives in. Empty = it's already in hand or worn. */
  container: string;
  /** Adjustment passed to /powercast (e.g. -5). */
  modifier: number;
  /** Seconds to wait between channels. */
  delaySec: number;
  /** Power per channel. */
  channelPower: number;
  /** Channels to store before discharging and casting. */
  channelCount: number;
  /** Aura level key to wait for before channelling. Null = don't check aura. */
  auraTarget: string | null;
}

export interface AutoPowercastState extends AutoPowercastConfig {
  active: boolean;
  phase: AutoPowercastPhase;
  cycleCount: number;
  channelsDone: number;
  /** During the waiting phase, what comes next once recovery is done. */
  waitingFor: AutoPowercastNext | null;
}

export const DEFAULT_POWERCAST_CONFIG: AutoPowercastConfig = {
  item: '',
  container: '',
  modifier: 0,
  delaySec: 5,
  channelPower: 1,
  channelCount: 10,
  auraTarget: null,
};

/** Turn whatever was saved (or nothing) into a valid config. */
export function sanitizePowercastConfig(
  raw: Partial<AutoPowercastConfig> | null | undefined
): AutoPowercastConfig {
  const d = DEFAULT_POWERCAST_CONFIG;
  const num = (v: unknown, fallback: number, min: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
  return {
    item: typeof raw?.item === 'string' ? raw.item.trim() : d.item,
    container: typeof raw?.container === 'string' ? raw.container.trim() : d.container,
    modifier:
      typeof raw?.modifier === 'number' && Number.isFinite(raw.modifier)
        ? Math.trunc(raw.modifier)
        : d.modifier,
    delaySec: num(raw?.delaySec, d.delaySec, 0),
    channelPower: num(raw?.channelPower, d.channelPower, 1),
    channelCount: num(raw?.channelCount, d.channelCount, 1),
    auraTarget:
      typeof raw?.auraTarget === 'string' ? (findAuraLevel(raw.auraTarget)?.key ?? null) : null,
  };
}

/** The item name echoed back isn't always what was typed, so match the stem only. */
const CHANNEL_OK = /You channel (?:some )?power to /;
const CHANNEL_NO_AURA = 'You have no aura.';
const CHANNEL_REFUSED = /You cannot channel to /;
const UNCONSCIOUS = 'You fall unconscious!';

/** The powercast went through (the practice cast always ends on this line). */
const CAST_DONE = /You finish practicing\./;

/**
 * Ways the powercast can come back without casting. Each one is recoverable —
 * open the mind, let things come back, channel a fresh round.
 */
const CAST_FAILURES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Your aura is too weak/, reason: 'your aura was too weak' },
  { pattern: /Your concentration is (?:broken|disrupted)/, reason: 'your concentration broke' },
  { pattern: /The spell critically fails/, reason: 'the spell critically failed' },
  { pattern: /The spell fails/, reason: 'the spell failed' },
  { pattern: /You fail(?:ed)? (?:at casting|to cast) the spell/, reason: 'the cast failed' },
  {
    pattern: /The power of the spell is snatched from your/,
    reason: 'the power was snatched away',
  },
  { pattern: /You must have mispronounced a lot/, reason: 'the incantation came out wrong' },
];

/** Ways the powercast can come back that waiting will never fix. */
const CAST_FATAL: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /You don't know such a spell/, reason: "you don't know lirrin's glow" },
  { pattern: /Perhaps you should learn that spell more/, reason: 'you need more practice first' },
];

/** Give up after this many powercasts in a row come back failed. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Safety net so a powercast that never answers can't stall the loop (ms). */
const CAST_TIMEOUT = 120_000;

export class AutoPowercast {
  private _active = false;
  private _phase: AutoPowercastPhase = 'idle';
  private _cycleCount = 0;
  private _channelsDone = 0;
  /** True between sending a channel and seeing the MUD's answer to it. */
  private _awaitingChannel = false;
  /** During the waiting phase, what to do once recovery finishes. */
  private _waitingFor: AutoPowercastNext | null = null;
  /** How many powercasts in a row have come back failed. */
  private _failures = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _castTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reads the status bar's live concentration and aura. */
  private _vitalsFn: (() => Vitals) | null = null;
  /** Blocker-aware send — queues behind any action already in progress. */
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  /** Full pipeline — used to run /powercast. */
  private _executeFn: ((action: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;

  // Per-character config (survives stop/cleanup)
  private _config: AutoPowercastConfig = { ...DEFAULT_POWERCAST_CONFIG };

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;
  /** Callback invoked when the per-character config is edited — wire to persistence. */
  onConfigChange: ((config: AutoPowercastConfig) => void) | null = null;

  get active(): boolean {
    return this._active;
  }

  getState(): AutoPowercastState {
    return {
      active: this._active,
      phase: this._phase,
      cycleCount: this._cycleCount,
      channelsDone: this._channelsDone,
      waitingFor: this._waitingFor,
      ...this._config,
    };
  }

  getConfig(): AutoPowercastConfig {
    return { ...this._config };
  }

  /** The aura level being waited for, if any. */
  get auraLevel(): AuraLevel | null {
    return this._config.auraTarget ? findAuraLevel(this._config.auraTarget) : null;
  }

  /** Apply a character's config silently (loading from disk / swapping characters). */
  configure(config: AutoPowercastConfig): void {
    this._config = { ...config };
    this._onChange();
  }

  /** Edit part of the config. Takes effect on the next channel / cycle. */
  updateConfig(patch: Partial<AutoPowercastConfig>): void {
    this._config = { ...this._config, ...patch };
    this._onChange();
    this.onConfigChange?.(this.getConfig());
  }

  /** Start the loop. */
  start(
    send: (cmd: string) => Promise<void>,
    execute: (action: string) => Promise<void>,
    echo: (msg: string) => void,
    vitals: () => Vitals
  ): void {
    if (this._active) this._cleanup();

    this._active = true;
    this._cycleCount = 0;
    this._failures = 0;
    this._sendFn = send;
    this._executeFn = execute;
    this._echoFn = echo;
    this._vitalsFn = vitals;

    const c = this._config;
    const held = c.container ? `, out of ${c.container} to discharge` : '';
    echo(
      `[Autopowercast: ${c.channelCount} x channel ${c.channelPower} ${c.item}, ${c.delaySec}s apart, then /powercast ${formatModifier(c.modifier)}${held} — starting]`
    );
    this._beginWait('channel', true);
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    const wasCasting = this._phase === 'casting';
    this._cleanup();
    this._onChange();
    fn?.(
      `[Autopowercast: stopped after ${cycles} powercast${cycles !== 1 ? 's' : ''}${wasCasting ? ' (your mind is still isolated)' : ''}]`
    );
  }

  /** Process a server output line. Called from onLine in OutputFilter. */
  processServerLine(stripped: string): void {
    if (!this._active) return;

    if (stripped.includes(UNCONSCIOUS)) {
      this._abort('you fell unconscious');
      return;
    }

    if (this._phase === 'waiting') {
      // The vitals trackers read this same line before we do, so this picks up
      // the recovery the moment the MUD announces it.
      this._recovered();
      return;
    }

    if (this._phase === 'channelling' && this._awaitingChannel) {
      if (CHANNEL_OK.test(stripped)) {
        this._awaitingChannel = false;
        this._channelsDone++;
        this._onChange();
        if (this._channelsDone >= this._config.channelCount) {
          // Charged up. Let concentration come back before spending it.
          this._beginWait('cast', false);
        } else {
          this._scheduleChannel();
        }
      } else if (stripped.includes(CHANNEL_NO_AURA)) {
        // Nothing to give yet — wait out the delay and try again
        this._awaitingChannel = false;
        this._scheduleChannel();
      } else if (CHANNEL_REFUSED.test(stripped)) {
        this._abort(`cannot channel to "${this._config.item}". Is that the right item name?`);
      }
      return;
    }

    if (this._phase === 'casting') {
      const fatal = CAST_FATAL.find((f) => f.pattern.test(stripped));
      if (fatal) {
        this._abort(`${fatal.reason} (your mind is still isolated)`);
        return;
      }
      if (CAST_DONE.test(stripped)) {
        this._cycleCount++;
        this._failures = 0;
        this._beginWait('channel', true);
        return;
      }
      const failure = CAST_FAILURES.find((f) => f.pattern.test(stripped));
      if (failure) this._castFailed(failure.reason);
    }
  }

  /** Reset on disconnect. */
  reset(): void {
    this._cleanup();
    this._onChange();
  }

  // ---------------------------------------------------------------------------
  // Recovery wait — full concentration, and full aura when one is configured
  // ---------------------------------------------------------------------------

  /**
   * Hold until concentration is full again (and aura, if a level is set).
   * `openMind` sends `set mind to open` first — needed after a powercast,
   * both to let the aura refill and to get concentration moving.
   */
  private _beginWait(next: AutoPowercastNext, openMind: boolean): void {
    this._clearTimer();
    this._clearCastTimer();
    this._phase = 'waiting';
    this._waitingFor = next;
    this._awaitingChannel = false;
    this._onChange();

    if (openMind) this._sendFn?.('set mind to open');

    // Nothing has been read since connecting — one `conc` gets things moving.
    // After that both readings arrive on their own as they change.
    if (!this._vitalsFn?.().conc) this._sendFn?.('conc');
    else if (this._recovered()) return; // already good to go, no wait to report

    const level = next === 'channel' ? this.auraLevel : null;
    const what = level
      ? `full concentration and a ${level.label.toLowerCase()} aura`
      : 'full concentration';
    const then = next === 'channel' ? 'channelling' : 'the powercast';
    this._echoFn?.(`[Autopowercast: waiting for ${what} before ${then}]`);
  }

  /**
   * Move on if concentration (and aura, before a round of channels) are back.
   * Returns true when the wait is over.
   */
  private _recovered(): boolean {
    const next = this._waitingFor;
    if (!next) return false;
    const { conc, aura } = this._vitalsFn?.() ?? { conc: null, aura: null };
    if (conc?.key !== 'bebt') return false;
    // The aura only gates a round of channels. Channelling is what draws on
    // it, and by discharge time it's been spent on the focus by design.
    if (next === 'channel' && !this._auraMeetsTarget(aura)) return false;

    this._waitingFor = null;
    if (next === 'cast') this._dischargeAndCast();
    else this._beginChannelling();
    return true;
  }

  private _auraMeetsTarget(level: AuraLevel | null): boolean {
    const target = this.auraLevel;
    if (!target) return true;
    return level ? level.severity <= target.severity : false;
  }

  // ---------------------------------------------------------------------------
  // Channelling
  // ---------------------------------------------------------------------------

  private _beginChannelling(): void {
    this._phase = 'channelling';
    this._channelsDone = 0;
    this._onChange();
    // The focus can stay in its container for this — only the discharge needs
    // it in hand.
    this._sendChannel();
  }

  private _sendChannel(): void {
    this._awaitingChannel = true;
    this._sendFn?.(`channel ${this._config.channelPower} ${this._config.item}`);
  }

  private _scheduleChannel(): void {
    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._active && this._phase === 'channelling') this._sendChannel();
    }, this._config.delaySec * 1000);
  }

  // ---------------------------------------------------------------------------
  // Discharge and cast
  // ---------------------------------------------------------------------------

  private _dischargeAndCast(): void {
    this._phase = 'casting';
    this._onChange();
    const c = this._config;
    this._echoFn?.(`[Autopowercast: ${this._channelsDone} channels stored — discharging]`);
    // Discharging is the only step that needs the focus in hand.
    if (c.container) this._sendFn?.(`take ${c.item} from ${c.container}`);
    this._sendFn?.(`discharge ${c.item}`);
    this._sendFn?.('set mind to isolated');
    if (c.container) this._sendFn?.(`put ${c.item} in ${c.container}`);
    this._executeFn?.(`/powercast ${c.modifier}`);

    this._clearCastTimer();
    this._castTimer = setTimeout(() => {
      this._castTimer = null;
      if (this._active && this._phase === 'casting') this._castFailed('it never came back');
    }, CAST_TIMEOUT);
  }

  /** A powercast came back without casting. Recover and go again. */
  private _castFailed(reason: string): void {
    this._failures++;
    if (this._failures >= MAX_CONSECUTIVE_FAILURES) {
      this._abort(
        `${reason}, and that's ${this._failures} powercasts in a row (your mind is still isolated)`
      );
      return;
    }
    this._echoFn?.(
      `[Autopowercast: powercast failed — ${reason}. Recovering and channelling again]`
    );
    this._beginWait('channel', true);
  }

  private _abort(reason: string): void {
    const fn = this._echoFn;
    this._cleanup();
    this._onChange();
    fn?.(`[Autopowercast: stopped — ${reason}]`);
  }

  // ---------------------------------------------------------------------------
  // Timers / teardown
  // ---------------------------------------------------------------------------

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _clearCastTimer(): void {
    if (this._castTimer) {
      clearTimeout(this._castTimer);
      this._castTimer = null;
    }
  }

  private _cleanup(): void {
    this._clearTimer();
    this._clearCastTimer();
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._channelsDone = 0;
    this._awaitingChannel = false;
    this._waitingFor = null;
    this._failures = 0;
    this._sendFn = null;
    this._executeFn = null;
    this._echoFn = null;
    this._vitalsFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}

/** "+3" / "-5" / "0" — how the modifier reads in echoes. */
export function formatModifier(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
