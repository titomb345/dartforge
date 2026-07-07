import { createContext, useContext } from 'react';
import type { LoadoutState } from '../lib/loadout';

export interface LoadoutContextValue {
  state: LoadoutState;
  /** Sends `equip held` to re-sync held items */
  refreshHands: () => void;
  /** Sends `x me` to re-sync everything (hands, worn, limb health) */
  refreshFull: () => void;
}

const LoadoutContext = createContext<LoadoutContextValue | null>(null);

export const LoadoutProvider = LoadoutContext.Provider;

export function useLoadoutContext(): LoadoutContextValue {
  const ctx = useContext(LoadoutContext);
  if (!ctx) throw new Error('useLoadoutContext must be used within a LoadoutProvider');
  return ctx;
}
