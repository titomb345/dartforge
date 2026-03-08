/** Unique alias identifier */
export type AliasId = string;

/** How the alias pattern is matched against user input */
export type AliasMatchMode = 'exact' | 'prefix' | 'regex';

/** Alias scope — character-specific or shared across all characters */
export type AliasScope = 'character' | 'global';

/** Whether the alias body is plain text expansion or JavaScript */
export type AliasBodyMode = 'text' | 'script';

/** An individual alias definition */
export interface Alias {
  id: AliasId;
  /** Display label (used by enableAlias/disableAlias for lookup) */
  name?: string;
  /** The trigger pattern — what the user types */
  pattern: string;
  /** How pattern is matched: exact word, prefix (allows arguments), or regex */
  matchMode: AliasMatchMode;
  /** The expansion body. Supports $1, $2, $*, ;, /delay, /echo, etc. */
  body: string;
  /** Body interpretation mode: 'text' (default) or 'script' (JavaScript) */
  bodyMode?: AliasBodyMode;
  /** Whether this alias is active */
  enabled: boolean;
  /** User-assigned group for organization */
  group: string;
  /** When this alias was created (ISO string) */
  createdAt: string;
  /** When this alias was last modified (ISO string) */
  updatedAt: string;
}

/** A single command after expansion, possibly with special directives */
export type ExpandedCommand =
  | { type: 'send'; text: string }
  | { type: 'delay'; ms: number }
  | { type: 'echo'; text: string }
  | { type: 'spam'; count: number; command: string }
  | { type: 'var'; name: string; value: string; scope: 'character' | 'global' }
  | { type: 'convert'; args: string }
  | { type: 'error'; message: string };

/** Result of expanding a single user command through the alias engine */
export interface ExpansionResult {
  /** The commands to send, in order */
  commands: ExpandedCommand[];
}
