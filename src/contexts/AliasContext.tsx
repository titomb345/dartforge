import { createContext, useContext } from 'react';
import type { Alias, AliasId, AliasMatchMode, AliasScope } from '../types/alias';

export interface AliasState {
  characterAliases: Record<AliasId, Alias>;
  globalAliases: Record<AliasId, Alias>;
  mergedAliases: Alias[];
  enableSpeedwalk: boolean;
  setEnableSpeedwalk: (value: boolean) => void;
  createAlias: (
    partial: { pattern: string; matchMode: AliasMatchMode; body: string; group: string },
    scope: AliasScope
  ) => AliasId;
  updateAlias: (
    id: AliasId,
    updates: Partial<Omit<Alias, 'id' | 'createdAt'>>,
    scope: AliasScope
  ) => void;
  deleteAlias: (id: AliasId, scope: AliasScope) => void;
  toggleAlias: (id: AliasId, scope: AliasScope) => void;
  duplicateAlias: (id: AliasId, scope: AliasScope) => AliasId | null;
}

const AliasContext = createContext<AliasState | null>(null);

export const AliasProvider = AliasContext.Provider;

export function useAliasContext(): AliasState {
  const ctx = useContext(AliasContext);
  if (!ctx) throw new Error('useAliasContext must be used within an AliasProvider');
  return ctx;
}
