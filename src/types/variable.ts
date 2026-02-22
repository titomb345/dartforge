/** Unique variable identifier */
export type VariableId = string;

/** Variable scope — character-specific or shared across all characters */
export type VariableScope = 'character' | 'global';

/** A user-defined variable for expansion in commands, aliases, and triggers */
export interface Variable {
  id: VariableId;
  /** Variable name (used as $name in expansion) */
  name: string;
  /** The value to substitute */
  value: string;
  /** Whether this variable is active for expansion */
  enabled: boolean;
  /** When this variable was created (ISO string) */
  createdAt: string;
  /** When this variable was last modified (ISO string) */
  updatedAt: string;
}
