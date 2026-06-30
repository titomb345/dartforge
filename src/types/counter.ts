export type CounterStatus = 'stopped' | 'running' | 'paused';

export interface ImproveCounter {
  id: string;
  name: string;
  status: CounterStatus;
  skills: Record<string, number>;
  totalImps: number;

  /** ISO timestamp when counter was first started (metadata only) */
  startedAt: string | null;
  /** Frozen elapsed ms — updated on pause, stop, and periodic save */
  accumulatedMs: number;
  /** Epoch ms when counter was last started/resumed (null when not running) */
  lastResumedAt: number | null;

  /**
   * Active elapsed-ms mark at which the current period window began. Measured
   * in the same active-time domain as `accumulatedMs` (NOT wall-clock), so the
   * period freezes whenever the counter isn't running — pausing, sleeping, or
   * closing the app never advances it. `null` when there is no live period.
   */
  periodStartActiveMs: number | null;
  /** Imps counted since the current period began */
  impsInCurrentPeriod: number;
  /** Whether the counter is archived (hidden from main view) */
  archived?: boolean;
  /** Display order for drag-and-drop reordering (lower = first) */
  order?: number;
}

export interface CounterStore {
  counters: ImproveCounter[];
  activeCounterId: string | null;
  periodLengthMinutes: number;
}
