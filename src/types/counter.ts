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

  /** Epoch ms when current period began */
  periodStartAt: number | null;
  /** Imps counted since periodStartAt */
  impsInCurrentPeriod: number;
}

export interface CounterStore {
  counters: ImproveCounter[];
  activeCounterId: string | null;
  periodLengthMinutes: number;
}
