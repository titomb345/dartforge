/** Unique timer identifier */
export type TimerId = string;

/** Timer scope — character-specific or shared across all characters */
export type TimerScope = 'character' | 'global';

/** Whether the timer body is plain text expansion or JavaScript */
export type TimerBodyMode = 'text' | 'script';

/** An individual timer definition */
export interface Timer {
  id: TimerId;
  /** Display name for this timer */
  name: string;
  /** The command body to execute. Supports $me, $Me, ;, /delay, /echo, /spam, /var, etc. */
  body: string;
  /** Body interpretation mode: 'text' (default) or 'script' (JavaScript) */
  bodyMode?: TimerBodyMode;
  /** Interval in seconds between firings */
  intervalSeconds: number;
  /** Whether this timer is active */
  enabled: boolean;
  /** Whether to show this timer's badge in the command input status area (default true) */
  showInStatusBar?: boolean;
  /** User-assigned group for organization */
  group: string;
  /** When this timer was created (ISO string) */
  createdAt: string;
  /** When this timer was last modified (ISO string) */
  updatedAt: string;
}
