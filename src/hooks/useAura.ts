import { useState, useCallback } from 'react';
import type { AuraMatch, AuraLevel } from '../lib/auraPatterns';

export function useAura() {
  const [aura, setAura] = useState<AuraLevel | null>(null);

  const updateAura = useCallback((match: AuraMatch) => {
    setAura(match.level);
  }, []);

  const clearAura = useCallback(() => {
    setAura(null);
  }, []);

  return { aura, updateAura, clearAura };
}
