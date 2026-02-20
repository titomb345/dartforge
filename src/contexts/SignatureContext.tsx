import { createContext, useContext } from 'react';
import type { SignatureId, SignatureMapping } from '../types/signatureMap';
import type { SignatureResolution } from '../hooks/useSignatureMappings';

export interface SignatureState {
  mappings: Record<SignatureId, SignatureMapping>;
  sortedMappings: SignatureMapping[];
  createMapping: (signature: string, playerName: string) => SignatureId;
  updateMapping: (id: SignatureId, updates: Partial<Omit<SignatureMapping, 'id'>>) => void;
  deleteMapping: (id: SignatureId) => void;
  resolveSignature: (messageBody: string) => SignatureResolution | null;
}

const SignatureContext = createContext<SignatureState | null>(null);

export const SignatureProvider = SignatureContext.Provider;

export function useSignatureContext(): SignatureState {
  const ctx = useContext(SignatureContext);
  if (!ctx) throw new Error('useSignatureContext must be used within a SignatureProvider');
  return ctx;
}
