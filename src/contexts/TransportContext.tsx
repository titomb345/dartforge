import { createContext, useContext } from 'react';
import type { MudTransport } from '../lib/transport';

const TransportContext = createContext<MudTransport | null>(null);

export function useTransport(): MudTransport {
  const ctx = useContext(TransportContext);
  if (!ctx) throw new Error('useTransport must be used within TransportProvider');
  return ctx;
}

export const TransportProvider = TransportContext.Provider;
