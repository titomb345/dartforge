/**
 * Auto-Refresh — cast refresh_other on a list of targets at full concentration.
 *
 * Passively watches MUD output for concentration recovery (BEBT). When it
 * arrives, casts refresh_other on each target in turn, waiting for one cast to
 * resolve before sending the next so they never interrupt each other. Then
 * waits for concentration to drop and recover before going again.
 *
 * A target that isn't around resolves instantly ("No such target around") and
 * the loop simply moves on to the next one.
 *
 * Instantiate once via useRef (same pattern as AutoCaster). Not a React hook.
 */

import { matchConcentrationLine } from './concentrationPatterns';
import { matchesUnblock } from './actionBlockerPatterns';

export type AutoRefreshPhase = 'idle' | 'waiting-bebt' | 'casting';

export interface RefreshTarget {
  name: string;
  /** Per-target power override; null = use the shared power. */
  power: number | null;
}

/** Per-character config — survives stop/start and app restarts. */
export interface AutoRefreshConfig {
  targets: RefreshTarget[];
  power: number;
}

export interface AutoRefreshState extends AutoRefreshConfig {
  active: boolean;
  phase: AutoRefreshPhase;
  cycleCount: number;
  /** Target currently being refreshed (casting phase only). */
  currentTarget: string | null;
}

export const MAX_REFRESH_TARGETS = 4;

export const DEFAULT_REFRESH_CONFIG: AutoRefreshConfig = {
  targets: [],
  power: 100,
};

/** Turn whatever was saved (or nothing) into a valid config. */
export function sanitizeRefreshConfig(
  raw: Partial<AutoRefreshConfig> | null | undefined
): AutoRefreshConfig {
  const validPower = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 1;
  const targets: RefreshTarget[] = [];
  if (Array.isArray(raw?.targets)) {
    for (const t of raw.targets) {
      if (typeof t?.name !== 'string' || !t.name.trim()) continue;
      targets.push({
        name: t.name.trim(),
        power: validPower(t.power) ? Math.floor(t.power) : null,
      });
    }
  }
  return {
    targets: targets.slice(0, MAX_REFRESH_TARGETS),
    power: validPower(raw?.power) ? Math.floor(raw.power) : DEFAULT_REFRESH_CONFIG.power,
  };
}

const SPELL = 'refresh_other';
const UNCONSCIOUS = 'You fall unconscious!';
/**
 * Safety net: if no line resolving the cast shows up in this long, move on to
 * the next target rather than stalling the loop forever (ms).
 */
const CAST_TIMEOUT = 60_000;

export class AutoRefresh {
  private _active = false;
  private _phase: AutoRefreshPhase = 'idle';
  private _cycleCount = 0;
  /** True when ready to fire on next BEBT. Set false after firing, re-armed on non-BEBT. */
  private _armed = true;
  /** Targets left to cast on this round (snapshot, so edits apply next round). */
  private _queue: RefreshTarget[] = [];
  private _current: RefreshTarget | null = null;
  private _castTimer: ReturnType<typeof setTimeout> | null = null;
  /** Blocker-aware send — sets the cast block and logs like any user command. */
  private _sendFn: ((cmd: string) => Promise<void>) | null = null;
  private _echoFn: ((msg: string) => void) | null = null;

  // Per-character config (survives stop/cleanup)
  private _targets: RefreshTarget[] = [];
  private _power = DEFAULT_REFRESH_CONFIG.power;

  /** Callback invoked whenever state changes — wire to React setState. */
  onChange: (() => void) | null = null;
  /** Callback invoked when the per-character config is edited — wire to persistence. */
  onConfigChange: ((config: AutoRefreshConfig) => void) | null = null;

  get active(): boolean {
    return this._active;
  }

  getState(): AutoRefreshState {
    return {
      active: this._active,
      phase: this._phase,
      cycleCount: this._cycleCount,
      currentTarget: this._current?.name ?? null,
      ...this.getConfig(),
    };
  }

  getConfig(): AutoRefreshConfig {
    return { targets: this._targets.map((t) => ({ ...t })), power: this._power };
  }

  /** Apply a character's config silently (loading from disk / swapping characters). */
  configure(config: AutoRefreshConfig): void {
    this._targets = config.targets.slice(0, MAX_REFRESH_TARGETS).map((t) => ({ ...t }));
    this._power = Math.max(1, config.power);
    this._onChange();
  }

  /** Add a target, or update its power override if already listed. */
  addTarget(name: string, power: number | null, echo: (msg: string) => void): void {
    const existing = this._targets.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.power = power;
    } else if (this._targets.length >= MAX_REFRESH_TARGETS) {
      echo(`[Autorefresh: list is full (${MAX_REFRESH_TARGETS} targets max)]`);
      return;
    } else {
      this._targets.push({ name, power });
    }
    this._onConfigChange();
    echo(`[Autorefresh: targets → ${this._describeTargets()}]`);
  }

  removeTarget(name: string, echo: (msg: string) => void): void {
    const before = this._targets.length;
    this._targets = this._targets.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
    if (this._targets.length === before) {
      echo(`[Autorefresh: "${name}" is not on the list]`);
      return;
    }
    this._onConfigChange();
    echo(`[Autorefresh: targets → ${this._describeTargets()}]`);
  }

  clearTargets(echo: (msg: string) => void): void {
    this._targets = [];
    this._onConfigChange();
    echo('[Autorefresh: target list cleared]');
  }

  setPower(power: number, echo: (msg: string) => void): void {
    this._power = Math.max(1, power);
    this._onConfigChange();
    echo(`[Autorefresh: power set to @${this._power}]`);
  }

  /** Start the loop. Sends one `conc` to get initial state. */
  start(send: (cmd: string) => Promise<void>, echo: (msg: string) => void): void {
    if (this._active) this._cleanup();

    this._active = true;
    this._cycleCount = 0;
    this._armed = true;
    this._sendFn = send;
    this._echoFn = echo;
    this._phase = 'waiting-bebt';
    this._onChange();

    echo(`[Autorefresh: ${this._describeTargets()} — starting]`);
    send('conc');
  }

  /** Stop the loop. */
  stop(echo?: (msg: string) => void): void {
    const fn = echo ?? this._echoFn;
    const cycles = this._cycleCount;
    this._cleanup();
    this._onChange();
    fn?.(`[Autorefresh: stopped after ${cycles} round${cycles !== 1 ? 's' : ''}]`);
  }

  /** Process a server output line. Called from onLine in OutputFilter. */
  processServerLine(stripped: string): void {
    if (!this._active) return;

    if (stripped.includes(UNCONSCIOUS)) {
      const fn = this._echoFn;
      this._cleanup();
      this._onChange();
      fn?.('[Autorefresh: stopped — you fell unconscious]');
      return;
    }

    if (this._phase === 'casting') {
      // Any line that resolves a cast (success, fail, no such target, broken
      // concentration) frees us up for the next target.
      if (matchesUnblock(stripped, 'cast')) this._castNext();
      return;
    }

    if (this._phase === 'waiting-bebt') {
      const match = matchConcentrationLine(stripped);
      if (!match) return;

      if (match.level.key !== 'bebt') {
        this._armed = true;
      } else if (this._armed) {
        if (this._targets.length === 0) return;
        this._armed = false;
        this._queue = this._targets.map((t) => ({ ...t }));
        this._castNext();
      }
    }
  }

  /** Reset on disconnect. */
  reset(): void {
    this._cleanup();
    this._onChange();
  }

  /** Cast on the next queued target, or finish the round if none are left. */
  private _castNext(): void {
    this._clearCastTimer();
    const next = this._queue.shift() ?? null;
    this._current = next;

    if (!next) {
      this._cycleCount++;
      this._phase = 'waiting-bebt';
      this._onChange();
      return;
    }

    this._phase = 'casting';
    this._onChange();
    const cmd = `cast ${SPELL} @${next.power ?? this._power} ${next.name}`;
    this._echoFn?.(`[Autorefresh: ${cmd}]`);
    this._sendFn?.(cmd);
    this._castTimer = setTimeout(() => {
      this._castTimer = null;
      if (this._active && this._phase === 'casting') this._castNext();
    }, CAST_TIMEOUT);
  }

  private _describeTargets(): string {
    if (this._targets.length === 0) return 'none';
    return this._targets.map((t) => `${t.name} @${t.power ?? this._power}`).join(', ');
  }

  private _clearCastTimer(): void {
    if (this._castTimer) {
      clearTimeout(this._castTimer);
      this._castTimer = null;
    }
  }

  private _cleanup(): void {
    this._clearCastTimer();
    this._active = false;
    this._phase = 'idle';
    this._cycleCount = 0;
    this._armed = true;
    this._queue = [];
    this._current = null;
    this._sendFn = null;
    this._echoFn = null;
  }

  private _onChange(): void {
    this.onChange?.();
  }

  private _onConfigChange(): void {
    this._onChange();
    this.onConfigChange?.(this.getConfig());
  }
}
