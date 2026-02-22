import { createContext, useContext } from 'react';
import type { AllocState } from '../hooks/useAllocations';

const AllocContext = createContext<AllocState | null>(null);

export const AllocProvider = AllocContext.Provider;

export function useAllocContext(): AllocState {
  const ctx = useContext(AllocContext);
  if (!ctx) throw new Error('useAllocContext must be used within an AllocProvider');
  return ctx;
}
