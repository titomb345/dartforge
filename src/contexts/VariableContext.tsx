import { createContext, useContext } from 'react';
import type { Variable, VariableId, VariableScope } from '../types/variable';

export interface VariableState {
  characterVariables: Record<VariableId, Variable>;
  globalVariables: Record<VariableId, Variable>;
  mergedVariables: Variable[];
  createVariable: (
    partial: { name: string; value: string },
    scope: VariableScope,
  ) => VariableId;
  updateVariable: (
    id: VariableId,
    updates: Partial<Omit<Variable, 'id' | 'createdAt'>>,
    scope: VariableScope,
  ) => void;
  deleteVariable: (id: VariableId, scope: VariableScope) => void;
  toggleVariable: (id: VariableId, scope: VariableScope) => void;
  setVariable: (name: string, value: string, scope: VariableScope) => void;
  deleteVariableByName: (name: string) => boolean;
}

const VariableContext = createContext<VariableState | null>(null);

export const VariableProvider = VariableContext.Provider;

export function useVariableContext(): VariableState {
  const ctx = useContext(VariableContext);
  if (!ctx) throw new Error('useVariableContext must be used within a VariableProvider');
  return ctx;
}
