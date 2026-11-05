/**
 * Auto-Powercast — charge a focus, then discharge it into a powercast.
 *
 * Loop:
 *   1. Open the mind and wait until concentration is full again, and, if you
 *      told it which aura level is your normal full, until your aura is back
 *      there too. Channelling and powercasting both spend concentration and
 *      aura, so going straight back to channelling wastes the round. Both
 *      readings come from the status bar's own trackers; the MUD announces
 *      changes to each, so nothing is ever asked for.
 *   2. `channel <power> <item>` a set number of times, pausing between each.
 *      The focus can stay in a container for this.
 *   3. Wait for concentration again (not aura, since channelling is what
 *      spends it), so the powercast has something behind it.
 *   4. Take the focus out of its container (discharging is the one step that
 *      needs it in hand) and `discharge <item>`. Only once the MUD says power
 *      came out: `set mind to isolated`, put the focus back, then
 *      `/powercast <modifier>`.
 *   5. Back to step 1.
 *
 * Every wait starts with a short settling pause before the readings are
 * trusted. The MUD reports what an action cost a moment after the action
 * ends: "You finish practicing." comes first and the concentration drop
 * about two seconds later. Reading the status bar the instant a cast ends
 * sees the old, full values and skips the wait altogether.
 *
 * Channels: only ones the MUD confirms ("You channel power to ...") are
 * counted. Running out of aura partway through a round waits for some to
 * come back and carries on with the same round. A channel that stores
 * nothing ("None of the power got outside your head.") is tried again, up to
 * a limit. "You cannot channel to ..." stops the loop since the item name
 * must be wrong, and so does a channel or discharge that gets no answer the
 * loop recognizes, so it says what happened instead of hanging.
 *
 * A round that fails (the focus was empty, aura too weak, concentration
 * broken, the spell fizzles) does not stop the loop. It opens the mind,
 * waits for recovery and starts a fresh round of channels. Three failures in
 * a row stops it, since something is wrong that waiting won't fix.
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

/**
 * What the loop does once the wait is over: start a round of channels, cast
 * what's stored, or carry on with a round that ran out of aura.
 */
export type AutoPowercastNext = 'channel' | 'cast' | 'resume';

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
/** The game says "You appear to have no aura."; the shorter form is accepted too. */
const CHANNEL_NO_AURA = /You (?:appear to )?have no aura\./;
/** The channel went off but nothing was stored. The next try usually works. */
const CHANNEL_LOST = /None of the power got outside your head\./;
const CHANNEL_REFUSED = /You cannot channel to /;
const UNCONSCIOUS = 'You fall unconscious!';

/** The discharge gave you the stored power ("You feel some power enter you."). */
const DISCHARGE_OK = /You feel .*power enter you/;
/** The focus had nothing in it. */
const DISCHARGE_EMPTY = /You feel nothing\./;

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

/** Give up after this many rounds in a row come back failed. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Give up after this many channels in a row store nothing. */
const MAX_LOST_CHANNELS = 8;

/**
 * How long every wait holds before trusting the status bar (ms). The MUD
 * reports a cast's cost about two seconds after the cast ends, and almost
 * always within four (1,314 of 1,320 practice casts in the logs).
 */
const SETTLE_MS = 5_000;

/** Shortest gap before trying a channel again, so a zero delay can't flood the MUD (ms). */
const MIN_RETRY_MS = 5_000;

/** Out of aura with no news of it coming back: try a channel anyway after this long (ms). */
const AURA_RETRY_MS = 60_000;

/** A channel or discharge the MUD hasn't answered by now isn't going to be (ms). */
const REPLY_TIMEOUT = 60_000;

/** Safety net so a powercast that never answers can't stall the loop (ms). */
const CAST_TIMEOUT = 120_000;

export class AutoPowercast {
  private _active = false;
  private _phase: AutoPowercastPhase = 'idle';
  private _cycleCount = 0;
  private _channelsDone = 0;
  /** True between sending a channel and seeing the MUD's answer to it. */
  private _awaitingChannel = false;
  /** True between sending the discharge and seeing the MUD's answer to it. */
  private _awaitingDischarge = false;
  /** True for the first moments of a wait, while the readings may still be stale. */
  private _settling = false;
  /** Set once "out of aura" has been echoed, so a long wait only says it once. */
  private _auraOutNoted = false;
  /** During the waiting phase, what to do once recovery finishes. */
  private _waitingFor: AutoPowercastNext | null = null;
  /** How many rounds in a row have come back failed. */
  private _failures = 0;
  /** How many channels in a row have stored nothing. */
  private _lostChannels = 0;
  /** The next step: the settling pause, the gap between channels, an aura retry. */
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** Gives up on a channel, discharge or powercast the MUD never answers. */
  private _replyTimer: ReturnType<typeof setTimeout> | null = null;
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
    this._lostChannels = 0;
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
    const wasCasting = this._phase === 'casting' && !this._awaitingDischarge;
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
      // the recovery the moment the MUD announces it. Not while settling,
      // though: the readings may still be from before the last action.
      if (!this._settling) this._recovered();
      return;
    }

    if (this._phase === 'channelling') {
      if (this._awaitingChannel) this._channelReply(stripped);
      return;
    }

    if (this._phase === 'casting') {
      if (this._awaitingDischarge) {
        if (DISCHARGE_OK.test(stripped)) this._castCharge();
        else if (DISCHARGE_EMPTY.test(stripped)) this._dischargeEmpty();
        return;
      }
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
      if (failure) this._roundFailed(failure.reason, true);
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
   * Hold until concentration is full again (and aura, if a level is set), or
   * for a round that ran out of aura, until there is some aura to give.
   * `openMind` sends `set mind to open` first — needed after a powercast,
   * both to let the aura refill and to get concentration moving.
   */
  private _beginWait(next: AutoPowercastNext, openMind: boolean): void {
    this._clearTimers();
    this._phase = 'waiting';
    this._waitingFor = next;
    this._awaitingChannel = false;
    this._awaitingDischarge = false;
    this._settling = true;
    this._onChange();

    if (openMind) this._sendFn?.('set mind to open');

    // Nothing has been read since connecting — one `conc` gets things moving.
    // After that both readings arrive on their own as they change.
    if (!this._vitalsFn?.().conc) this._sendFn?.('conc');

    // The cost of whatever just finished is reported a moment later, so give
    // it time to land. A line may never come, so a timer ends the pause.
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._active || this._phase !== 'waiting') return;
      this._settling = false;
      if (this._recovered()) return;
      this._announceWait(next);
      if (next === 'resume') {
        // In case the aura comes back without the MUD saying so.
        this._timer = setTimeout(() => {
          this._timer = null;
          if (this._active && this._phase === 'waiting' && this._waitingFor === 'resume') {
            this._waitingFor = null;
            this._continueChannelling();
          }
        }, AURA_RETRY_MS);
      }
    }, SETTLE_MS);
  }

  private _announceWait(next: AutoPowercastNext): void {
    // Running out of aura is echoed as it happens, not here.
    if (next === 'resume') return;
    const level = next === 'channel' ? this.auraLevel : null;
    const what = level ? `full concentration and ${auraPhrase(level.label)}` : 'full concentration';
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
    if (next === 'resume') {
      // Partway through a round: carry on as soon as there is any aura to give.
      if (!aura || aura.key === 'none') return false;
    } else {
      if (conc?.key !== 'bebt') return false;
      // The aura only gates a round of channels. Channelling is what draws on
      // it, and by discharge time it's been spent on the focus by design.
      if (next === 'channel' && !this._auraMeetsTarget(aura)) return false;
    }

    this._clearTimer();
    this._waitingFor = null;
    if (next === 'cast') this._discharge();
    else if (next === 'channel') this._beginChannelling();
    else this._continueChannelling();
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
    this._channelsDone = 0;
    this._lostChannels = 0;
    this._auraOutNoted = false;
    this._continueChannelling();
  }

  /** Send the next channel of the current round. */
  private _continueChannelling(): void {
    this._phase = 'channelling';
    this._onChange();
    // The focus can stay in its container for this — only the discharge needs
    // it in hand.
    this._sendChannel();
  }

  private _sendChannel(): void {
    const cmd = `channel ${this._config.channelPower} ${this._config.item}`;
    this._awaitingChannel = true;
    this._sendFn?.(cmd);
    this._startReplyTimer(REPLY_TIMEOUT, () =>
      this._abort(`"${cmd}" got no reply that DartForge recognizes`)
    );
  }

  private _channelReply(line: string): void {
    if (CHANNEL_OK.test(line)) {
      this._channelAnswered();
      this._lostChannels = 0;
      this._auraOutNoted = false;
      this._channelsDone++;
      this._onChange();
      if (this._channelsDone >= this._config.channelCount) {
        // Charged up. Let concentration come back before spending it.
        this._beginWait('cast', false);
      } else {
        this._scheduleChannel(this._config.delaySec * 1000);
      }
    } else if (CHANNEL_NO_AURA.test(line)) {
      // Keep what's stored and carry on with this round once some aura is back.
      this._channelAnswered();
      if (!this._auraOutNoted) {
        this._auraOutNoted = true;
        this._echoFn?.(
          `[Autopowercast: out of aura with ${this._channelsDone} of ${this._config.channelCount} channels stored, waiting for it to come back]`
        );
      }
      this._beginWait('resume', false);
    } else if (CHANNEL_LOST.test(line)) {
      this._channelAnswered();
      this._lostChannels++;
      if (this._lostChannels >= MAX_LOST_CHANNELS) {
        this._abort(
          `${this._lostChannels} channels in a row stored nothing ("None of the power got outside your head.")`
        );
        return;
      }
      this._scheduleChannel(Math.max(this._config.delaySec * 1000, MIN_RETRY_MS));
    } else if (CHANNEL_REFUSED.test(line)) {
      this._abort(`cannot channel to "${this._config.item}". Is that the right item name?`);
    }
  }

  private _channelAnswered(): void {
    this._awaitingChannel = false;
    this._clearReplyTimer();
  }

  private _scheduleChannel(ms: number): void {
    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._active && this._phase === 'channelling') this._sendChannel();
    }, ms);
  }

  // ---------------------------------------------------------------------------
  // Discharge and cast
  // ---------------------------------------------------------------------------

  /** Discharge the focus, then wait to hear whether any power came out. */
  private _discharge(): void {
    this._phase = 'casting';
    this._awaitingDischarge = true;
    this._onChange();
    const c = this._config;
    this._echoFn?.(`[Autopowercast: ${this._channelsDone} channels stored, discharging]`);
    // Discharging is the only step that needs the focus in hand.
    if (c.container) this._sendFn?.(`take ${c.item} from ${c.container}`);
    this._sendFn?.(`discharge ${c.item}`);
    this._startReplyTimer(REPLY_TIMEOUT, () => {
      // If the take worked, don't leave the focus in hand.
      this._putFocusBack();
      const where = c.container ? `in ${c.container}` : 'in your hands';
      this._abort(
        `"discharge ${c.item}" got no reply that DartForge recognizes. Is the focus ${where}?`
      );
    });
  }

  /** The discharge worked: isolate, put the focus away and cast. */
  private _castCharge(): void {
    this._awaitingDischarge = false;
    this._clearReplyTimer();
    this._sendFn?.('set mind to isolated');
    this._putFocusBack();
    this._executeFn?.(`/powercast ${this._config.modifier}`);
    this._startReplyTimer(CAST_TIMEOUT, () => this._roundFailed('it never came back', true));
  }

  /** The focus had nothing in it, so there's nothing to cast with. */
  private _dischargeEmpty(): void {
    this._awaitingDischarge = false;
    this._clearReplyTimer();
    this._putFocusBack();
    this._roundFailed('the focus was empty when discharged', false);
  }

  private _putFocusBack(): void {
    const c = this._config;
    if (c.container) this._sendFn?.(`put ${c.item} in ${c.container}`);
  }

  /**
   * A round ended without a powercast. Recover and go again.
   * `isolated` says whether the mind was isolated for the cast.
   */
  private _roundFailed(reason: string, isolated: boolean): void {
    this._failures++;
    if (this._failures >= MAX_CONSECUTIVE_FAILURES) {
      this._abort(
        `${reason}, and that's ${this._failures} powercasts in a row${isolated ? ' (your mind is still isolated)' : ''}`
      );
      return;
    }
    this._echoFn?.(
      `[Autopowercast: powercast failed, ${reason}. Recovering and channelling again]`
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

  private _startReplyTimer(ms: number, onTimeout: () => void): void {
    this._clearReplyTimer();
    this._replyTimer = setTimeout(() => {
      this._replyTimer = null;
      if (this._active) onTimeout();
    }, ms);
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _clearReplyTimer(): void {
    if (this._replyTimer) {
      clearTimeout(this._replyTimer);
      this._replyTimer = null;
    }
  }

  private _clearTimers(): void {
    this._clearTimer();
    this._clearReplyTimer();
  }

  private _cleanup(): void {
    this._clearTimers();
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._channelsDone = 0;
    this._awaitingChannel = false;
    this._awaitingDischarge = false;
    this._settling = false;
    this._auraOutNoted = false;
    this._waitingFor = null;
    this._failures = 0;
    this._lostChannels = 0;
    this._sendFn = null;
    this._executeFn = null;
    this._echoFn = null;
    this._vitalsFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}

/** "a violet aura" / "an intense violet aura", lowercased, for echoes and tooltips. */
export function auraPhrase(label: string): string {
  const name = label.toLowerCase();
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name} aura`;
}

/** "+3" / "-5" / "0" — how the modifier reads in echoes. */
export function formatModifier(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
