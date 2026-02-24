import { createContext, useContext } from 'react';
import type { WhoSnapshot } from '../lib/whoPatterns';

export interface WhoState {
  snapshot: WhoSnapshot | null;
  refresh: () => void;
}

const WhoContext = createContext<WhoState | null>(null);

export const WhoProvider = WhoContext.Provider;

export function useWhoContext(): WhoState {
  const ctx = useContext(WhoContext);
  if (!ctx) throw new Error('useWhoContext must be used within a WhoProvider');
  return ctx;
}
