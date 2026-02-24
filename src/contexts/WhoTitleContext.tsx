import { createContext, useContext } from 'react';
import type { WhoTitleId, WhoTitleMapping } from '../types/whoTitleMap';

export interface WhoTitleState {
  mappings: Record<WhoTitleId, WhoTitleMapping>;
  sortedMappings: WhoTitleMapping[];
  createMapping: (whoTitle: string, playerName: string, confirmed: boolean) => WhoTitleId;
  updateMapping: (id: WhoTitleId, updates: Partial<Omit<WhoTitleMapping, 'id'>>) => void;
  deleteMapping: (id: WhoTitleId) => void;
  resolveTitle: (whoTitle: string) => WhoTitleMapping | null;
}

const WhoTitleContext = createContext<WhoTitleState | null>(null);

export const WhoTitleProvider = WhoTitleContext.Provider;

export function useWhoTitleContext(): WhoTitleState {
  const ctx = useContext(WhoTitleContext);
  if (!ctx) throw new Error('useWhoTitleContext must be used within a WhoTitleProvider');
  return ctx;
}
