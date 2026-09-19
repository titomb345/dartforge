/**
 * Auto-Powercast — charge a focus, then discharge it into a powercast.
 *
 * Loop:
 *   1. `channel <power> <item>` a set number of times, pausing between each
 *   2. `discharge <item>` to pull the stored power back into your aura
 *   3. `set mind to isolated` so the aura doesn't leak away
 *   4. `/powercast <modifier>`
 *   5. `set mind to open`, back to step 1
 *
 * Only channels the MUD confirms ("You channel power to ...") are counted.
 * "You have no aura." just waits and tries again; "You cannot channel to ..."
 * stops the loop since the item is wrong or not in hand.
 *
 * Instantiate once via useRef (same pattern as AutoCaster). Not a React hook.
 */

export type AutoPowercastPhase = 'idle' | 'channelling' | 'casting';

/** Per-character config — survives stop/start and app restarts. */
export interface AutoPowercastConfig {
  /** Focus item to channel into and discharge. Empty = not set up yet. */
  item: string;
  /** Adjustment passed to /powercast (e.g. -5). */
  modifier: number;
  /** Seconds to wait between channels. */
  delaySec: number;
  /** Power per channel. */
  channelPower: number;
  /** Channels to store before discharging and casting. */
  channelCount: number;
}

export interface AutoPowercastState extends AutoPowercastConfig {
  active: boolean;
  phase: AutoPowercastPhase;
  cycleCount: number;
  channelsDone: number;
}

export const DEFAULT_POWERCAST_CONFIG: AutoPowercastConfig = {
  item: '',
  modifier: 0,
  delaySec: 5,
  channelPower: 1,
  channelCount: 10,
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
    modifier:
      typeof raw?.modifier === 'number' && Number.isFinite(raw.modifier)
        ? Math.trunc(raw.modifier)
        : d.modifier,
    delaySec: num(raw?.delaySec, d.delaySec, 0),
    channelPower: num(raw?.channelPower, d.channelPower, 1),
    channelCount: num(raw?.channelCount, d.channelCount, 1),
  };
}

/** The item name echoed back isn't always what was typed, so match the stem only. */
const CHANNEL_OK = /You channel (?:some )?power to /;
const CHANNEL_NO_AURA = 'You have no aura.';
const CHANNEL_REFUSED = /You cannot channel to /;
const PRACTICE_DONE = 'You finish practicing';
const UNCONSCIOUS = 'You fall unconscious!';
const CONCENTRATION_BROKEN = 'Your concentration is broken';

export class AutoPowercast {
  private _active = false;
  private _phase: AutoPowercastPhase = 'idle';
  private _cycleCount = 0;
  private _channelsDone = 0;
  /** True between sending a channel and seeing the MUD's answer to it. */
  private _awaitingChannel = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
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
      ...this._config,
    };
  }

  getConfig(): AutoPowercastConfig {
    return { ...this._config };
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
    echo: (msg: string) => void
  ): void {
    if (this._active) this._cleanup();

    this._active = true;
    this._cycleCount = 0;
    this._sendFn = send;
    this._executeFn = execute;
    this._echoFn = echo;

    const c = this._config;
    echo(
      `[Autopowercast: ${c.channelCount} x channel ${c.channelPower} ${c.item}, ${c.delaySec}s apart, then /powercast ${formatModifier(c.modifier)} — starting]`
    );
    this._beginChannelling();
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

    if (this._phase === 'channelling' && this._awaitingChannel) {
      if (CHANNEL_OK.test(stripped)) {
        this._awaitingChannel = false;
        this._channelsDone++;
        this._onChange();
        if (this._channelsDone >= this._config.channelCount) {
          this._dischargeAndCast();
        } else {
          this._scheduleChannel();
        }
      } else if (stripped.includes(CHANNEL_NO_AURA)) {
        // Nothing to give yet — wait out the delay and try again
        this._awaitingChannel = false;
        this._scheduleChannel();
      } else if (CHANNEL_REFUSED.test(stripped)) {
        this._abort(`cannot channel to "${this._config.item}". Is it in your hands?`);
      }
      return;
    }

    if (this._phase === 'casting') {
      if (stripped.includes(PRACTICE_DONE)) {
        this._cycleCount++;
        this._beginChannelling();
      } else if (stripped.includes(CONCENTRATION_BROKEN)) {
        this._abort('concentration broken (your mind is still isolated)');
      }
    }
  }

  /** Reset on disconnect. */
  reset(): void {
    this._cleanup();
    this._onChange();
  }

  /** Open the mind and start a fresh round of channels. */
  private _beginChannelling(): void {
    this._phase = 'channelling';
    this._channelsDone = 0;
    this._onChange();
    this._sendFn?.('set mind to open');
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

  private _dischargeAndCast(): void {
    this._phase = 'casting';
    this._onChange();
    const c = this._config;
    this._echoFn?.(`[Autopowercast: ${this._channelsDone} channels stored — discharging]`);
    this._sendFn?.(`discharge ${c.item}`);
    this._sendFn?.('set mind to isolated');
    this._executeFn?.(`/powercast ${c.modifier}`);
  }

  private _abort(reason: string): void {
    const fn = this._echoFn;
    this._cleanup();
    this._onChange();
    fn?.(`[Autopowercast: stopped — ${reason}]`);
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _cleanup(): void {
    this._clearTimer();
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._channelsDone = 0;
    this._awaitingChannel = false;
    this._sendFn = null;
    this._executeFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }
}

/** "+3" / "-5" / "0" — how the modifier reads in echoes. */
export function formatModifier(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
