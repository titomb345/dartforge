/** Unique trigger identifier */
export type TriggerId = string;

/** How the trigger pattern is matched against MUD output lines */
export type TriggerMatchMode = 'substring' | 'exact' | 'regex';

/** Trigger scope — character-specific or shared across all characters */
export type TriggerScope = 'character' | 'global';

/** An individual trigger definition */
export interface Trigger {
  id: TriggerId;
  /** The pattern to match against incoming MUD output lines (ANSI-stripped) */
  pattern: string;
  /** How pattern is matched against output lines */
  matchMode: TriggerMatchMode;
  /** The response body. Supports $0, $1–$9, $line, $me, ;, /delay, /echo */
  body: string;
  /** Whether this trigger is active */
  enabled: boolean;
  /** User-assigned group for organization */
  group: string;
  /** Cooldown in milliseconds before this trigger can fire again (0 = no cooldown) */
  cooldownMs: number;
  /** Suppress the matched line from terminal output */
  gag: boolean;
  /** Optional highlight color for matched line (ANSI color code, e.g. "33" for yellow) */
  highlight: string | null;
  /** Play a sound alert when this trigger fires */
  soundAlert: boolean;
  /** When this trigger was created (ISO string) */
  createdAt: string;
  /** When this trigger was last modified (ISO string) */
  updatedAt: string;
}

/** Result of a trigger match — used by the trigger engine */
export interface TriggerMatch {
  trigger: Trigger;
  /** The full ANSI-stripped line that matched */
  line: string;
  /** The original line with ANSI codes intact */
  rawLine: string;
  /** Captured groups: $0 = matched text (or full line for exact), $1–$9 from regex */
  captures: string[];
}
