import { useState, useCallback } from 'react';
import type { ConcentrationMatch, ConcentrationLevel } from '../lib/concentrationPatterns';

export function useConcentration() {
  const [concentration, setConcentration] = useState<ConcentrationLevel | null>(null);

  const updateConcentration = useCallback((match: ConcentrationMatch) => {
    setConcentration(match.level);
  }, []);

  const clearConcentration = useCallback(() => {
    setConcentration(null);
  }, []);

  return { concentration, updateConcentration, clearConcentration };
}
